import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '@/app/router'
import { monitorTheme } from '@/app/theme'
import { useAdminStore } from '@/store/adminStore'

const eventSummary = {
  batchId: 'batch-1',
  sendType: 'fetch',
  eventId: 'event-1',
  category: 'error',
  eventType: 'js_error',
  timestamp: 1_787_068_800_000,
  pageUrl: 'https://example.com/profile',
  userId: 'user-1',
  level: 'error',
  message: 'Cannot read profile',
  receivedAt: 1_787_068_800_100,
} as const

const issueSummary = {
  id: 'issue-1',
  title: 'Cannot read profile',
  eventType: 'js_error',
  exceptionType: 'TypeError',
  eventCount: 3,
  affectedUsers: 2,
  firstSeen: 1_787_068_700_000,
  lastSeen: 1_787_068_800_000,
  latestEventId: 'event-1',
  latestPageUrl: 'https://example.com/profile',
} as const

const primaryProjectId = '11111111-1111-4111-8111-111111111111'
const secondProjectId = '22222222-2222-4222-8222-222222222222'
const createdProjectId = '33333333-3333-4333-8333-333333333333'

function successfulFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  const projectId = url.includes(secondProjectId) ? secondProjectId : primaryProjectId
  if (init?.method === 'DELETE' && url.endsWith('/auth/logout')) {
    return Promise.resolve({ ok: true, status: 204 } as Response)
  }

  const updateBody = init?.method === 'PATCH' && init.body
    ? JSON.parse(String(init.body)) as { name: string; enabled: boolean }
    : undefined
  const data = url.endsWith('/auth/me') || url.endsWith('/auth/login') || url.endsWith('/auth/register')
    ? { id: 'user-1', email: 'user@example.com', createdAt: 1_787_068_600_000 }
    : init?.method === 'POST' && url.endsWith('/projects')
    ? {
        id: createdProjectId,
        name: 'Created Project',
        enabled: true,
        createdAt: 1_787_068_900_000,
        publicKey: 'pk_created',
      }
    : init?.method === 'POST' && url.endsWith(`/projects/${projectId}/public-key/rotate`)
    ? {
        id: projectId,
        name: projectId === secondProjectId ? 'Project Two' : 'Monitor Local',
        enabled: true,
        createdAt: 1_787_068_800_000,
        publicKey: 'pk_rotated',
      }
    : init?.method === 'PATCH' && url.endsWith(`/projects/${projectId}`)
    ? {
        id: projectId,
        name: updateBody?.name || 'Monitor Local',
        enabled: updateBody?.enabled ?? true,
        createdAt: 1_787_068_800_000,
        publicKey: projectId === secondProjectId ? 'pk_project_two' : 'pk_monitor_local',
      }
    : url.endsWith('/projects')
    ? {
        projects: [
          { id: primaryProjectId, name: 'Monitor Local', enabled: true, createdAt: 1_787_068_700_000 },
          { id: secondProjectId, name: 'Project Two', enabled: true, createdAt: 1_787_068_800_000 },
        ],
      }
    : url.endsWith(`/projects/${projectId}`)
    ? {
        id: projectId,
        name: projectId === secondProjectId ? 'Project Two' : 'Monitor Local',
        enabled: true,
        createdAt: 1_787_068_800_000,
        publicKey: projectId === secondProjectId ? 'pk_project_two' : 'pk_monitor_local',
      }
    : url.endsWith('/events/event-1')
    ? {
        ...eventSummary,
        schemaVersion: 2,
        projectId,
        appName: 'monitor',
        sentAt: 1_787_068_799_900,
        breadcrumbs: [],
        replayData: null,
        payload: { message: 'Cannot read profile' },
      }
    : url.includes('/issues?')
    ? { issues: [issueSummary], nextCursor: '' }
    : { events: [eventSummary], nextCursor: '' }

  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data }) } as Response)
}

function renderRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <MantineProvider theme={monitorTheme} defaultColorScheme="light" env="test">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  )
}

describe('admin event routes', () => {
  beforeEach(() => {
    useAdminStore.setState({ projectId: primaryProjectId })
    vi.restoreAllMocks()
  })

  it('展示按根因聚合的问题并进入最近事件', async () => {
    vi.stubGlobal('fetch', vi.fn(successfulFetch))
    renderRoute('/issues')

    expect(await screen.findByRole('heading', { name: '问题' })).toBeInTheDocument()
    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Cannot read profile' }))
    expect(await screen.findByRole('heading', { name: 'Cannot read profile' })).toBeInTheDocument()
  })

  it('从事件列表进入由 React Router 管理的详情页', async () => {
    vi.stubGlobal('fetch', vi.fn(successfulFetch))
    renderRoute('/events')

    fireEvent.click(await screen.findByRole('link', { name: 'Cannot read profile' }))

    expect(await screen.findByRole('heading', { name: 'Cannot read profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Payload' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('把筛选条件交给 URL 和 TanStack Query', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events')

    await screen.findByRole('link', { name: 'Cannot read profile' })
    await user.click(screen.getByRole('combobox', { name: '事件分类' }))
    await user.click(await screen.findByRole('option', { name: '错误' }))
    await user.type(screen.getByRole('textbox', { name: '事件类型' }), 'js_error')
    await user.click(screen.getByRole('button', { name: '应用筛选' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = String(input)
        return url.includes('category=error') && url.includes('eventType=js_error')
      })).toBe(true)
    })
  })

  it('切换项目后使用新的项目上下文重新查询事件', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events')

    const projectSwitcher = await screen.findByRole('combobox', { name: '当前项目' })
    await user.click(projectSwitcher)
    await user.click(await screen.findByRole('option', { name: 'Project Two' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes(`/projects/${secondProjectId}/events?`))).toBe(true)
    })
    expect(useAdminStore.getState().projectId).toBe(secondProjectId)
  })

  it('创建项目后更新项目缓存、自动切换并展示 SDK 配置', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events')

    await user.click(await screen.findByRole('button', { name: '新建项目' }))
    await user.type(await screen.findByLabelText('项目名称'), 'Created Project')
    await user.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByRole('heading', { name: '项目已创建' })).toBeInTheDocument()
    expect(screen.getByText(/publicKey: 'pk_created'/)).toBeInTheDocument()
    expect(useAdminStore.getState().projectId).toBe(createdProjectId)

    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: 'Created Project',
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes(`/projects/${createdProjectId}/issues?`))).toBe(true)
    })
  })

  it('创建项目时由 Zod 在请求前校验名称', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events')

    await user.click(await screen.findByRole('button', { name: '新建项目' }))
    await user.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByText('请输入项目名称')).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })

  it('通过受保护的项目详情重新展示 SDK 配置', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(`/projects/${secondProjectId}/settings`)

    expect(await screen.findByRole('heading', { name: '项目设置' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Project Two' })).toBeInTheDocument()
    expect(screen.getByText(/publicKey: 'pk_project_two'/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制配置' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/projects/${secondProjectId}`))).toBe(true)
    await waitFor(() => expect(useAdminStore.getState().projectId).toBe(secondProjectId))
  })

  it('在项目设置页修改名称并停用 SDK 上报', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(`/projects/${secondProjectId}/settings`)

    const nameInput = await screen.findByRole('textbox', { name: '项目名称' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Project')
    await user.click(screen.getByRole('switch', { name: /允许 SDK 上报/ }))

    expect(screen.getByRole('status')).toHaveTextContent('项目将停止接收新事件')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    const updateCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(updateCall?.[0]).toBe(`/api/v1/projects/${secondProjectId}`)
    expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
      name: 'Renamed Project',
      enabled: false,
    })
    expect(await screen.findByRole('heading', { name: 'Renamed Project' })).toBeInTheDocument()
    expect(screen.getByText('已停用')).toBeInTheDocument()
    expect(screen.getByText('设置已保存')).toBeInTheDocument()
  })

  it('项目设置由 Zod 在请求前校验名称', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(`/projects/${secondProjectId}/settings`)

    const nameInput = await screen.findByRole('textbox', { name: '项目名称' })
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('请输入项目名称')).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'PATCH')).toBe(true)
  })

  it('确认后轮换 publicKey 并直接更新 SDK 配置缓存', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(`/projects/${secondProjectId}/settings`)

    expect(await screen.findByText(/publicKey: 'pk_project_two'/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新生成 publicKey' }))

    expect(screen.getByText('旧 publicKey 会立即失效')).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/public-key/rotate'))).toBe(true)
    await user.click(screen.getByRole('button', { name: '确认重新生成' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) =>
        String(input).endsWith(`/projects/${secondProjectId}/public-key/rotate`) && init?.method === 'POST',
      )).toBe(true)
    })
    expect(await screen.findByText(/publicKey: 'pk_rotated'/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('旧 publicKey 现在无法继续上报')
  })

  it('在登录状态失效时跳转到登录页', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { code: 'UNAUTHORIZED', message: 'unauthorized' } }),
    } as Response)))
    renderRoute('/events')

    expect(await screen.findByRole('heading', { name: '登录管理端' })).toBeInTheDocument()
  })

  it('登录成功后回到受保护的事件页', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/login')

    await user.type(screen.getByLabelText('邮箱'), 'user@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('heading', { name: '问题' })).toBeInTheDocument()
    const loginCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/auth/login'))
    expect(loginCall?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
  })

  it('注册成功后串行登录并进入第一个项目引导', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/projects') && init?.method !== 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { projects: [] } }) } as Response)
      }
      return successfulFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/register')

    await user.type(screen.getByLabelText('邮箱'), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.type(screen.getByLabelText('确认密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册并登录' }))

    expect(await screen.findByRole('heading', { name: '创建你的第一个项目' })).toBeInTheDocument()
    const authCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.endsWith('/auth/register') || url.endsWith('/auth/login'))
    expect(authCalls.map((url) => url.split('/').at(-1))).toEqual(['register', 'login'])
  })

  it('注册成功但 Redis 不可用时明确提示账号已经创建', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/login')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: { code: 'SESSION_UNAVAILABLE' } }),
        } as Response)
      }
      return successfulFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/register')

    await user.type(screen.getByLabelText('邮箱'), 'new@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.type(screen.getByLabelText('确认密码'), 'password123')
    await user.click(screen.getByRole('button', { name: '注册并登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('账号已经创建')
    expect(screen.getByRole('link', { name: '返回登录' })).toBeInTheDocument()
  })

  it('退出时销毁服务端 Session 并返回登录页', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events')

    await user.click(await screen.findByRole('button', { name: '退出登录' }))

    expect(await screen.findByRole('heading', { name: '登录管理端' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/auth/logout') && init?.method === 'DELETE',
    )).toBe(true)
  })
})
