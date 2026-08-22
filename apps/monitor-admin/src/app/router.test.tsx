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

const primaryProjectId = '11111111-1111-4111-8111-111111111111'
const secondProjectId = '22222222-2222-4222-8222-222222222222'
const createdProjectId = '33333333-3333-4333-8333-333333333333'

function successfulFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  const projectId = url.includes(`/projects/${secondProjectId}/`) ? secondProjectId : primaryProjectId
  if (init?.method === 'DELETE' && url.endsWith('/auth/logout')) {
    return Promise.resolve({ ok: true, status: 204 } as Response)
  }

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
    : url.endsWith('/projects')
    ? {
        projects: [
          { id: primaryProjectId, name: 'Monitor Local', enabled: true, createdAt: 1_787_068_700_000 },
          { id: secondProjectId, name: 'Project Two', enabled: true, createdAt: 1_787_068_800_000 },
        ],
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
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes(`/projects/${createdProjectId}/events?`))).toBe(true)
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

    expect(await screen.findByRole('heading', { name: '事件流' })).toBeInTheDocument()
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
