import { MantineProvider } from '@mantine/core'
import { gzipSync } from 'node:zlib'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '@/app/router'
import { monitorTheme } from '@/app/theme'
import { useAdminStore } from '@/store/adminStore'
import { decodeReplay } from '@/features/replay/model/decodeReplay'

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
  id: '0123456789abcdef0123456789abcdef',
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

const issueOccurrence = {
  eventId: 'event-1',
  eventType: 'js_error',
  timestamp: 1_787_068_800_000,
  pageUrl: 'https://example.com/profile',
  userId: 'user-1',
  message: 'Cannot read profile',
  receivedAt: 1_787_068_800_100,
} as const

const primaryProjectId = '11111111-1111-4111-8111-111111111111'
const secondProjectId = '22222222-2222-4222-8222-222222222222'
const createdProjectId = '33333333-3333-4333-8333-333333333333'
const replayFixture = gzipSync(
  Buffer.from(
    JSON.stringify([
      { type: 4, timestamp: 1787068790000, data: { width: 1440, height: 900 } },
      {
        type: 2,
        timestamp: 1787068790001,
        data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } },
      },
    ]),
  ),
).toString('base64')

function successfulFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  const projectId = url.includes(secondProjectId) ? secondProjectId : primaryProjectId
  if (init?.method === 'DELETE' && url.endsWith('/auth/logout')) {
    return Promise.resolve({ ok: true, status: 204 } as Response)
  }

  const updateBody =
    init?.method === 'PATCH' && init.body
      ? (JSON.parse(String(init.body)) as { name: string; enabled: boolean })
      : undefined
  const data =
    url.endsWith('/auth/me') || url.endsWith('/auth/login') || url.endsWith('/auth/register')
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
                    {
                      id: primaryProjectId,
                      name: 'Monitor Local',
                      enabled: true,
                      createdAt: 1_787_068_700_000,
                    },
                    {
                      id: secondProjectId,
                      name: 'Project Two',
                      enabled: true,
                      createdAt: 1_787_068_800_000,
                    },
                  ],
                }
              : url.endsWith(`/projects/${projectId}`)
                ? {
                    id: projectId,
                    name: projectId === secondProjectId ? 'Project Two' : 'Monitor Local',
                    enabled: true,
                    createdAt: 1_787_068_800_000,
                    publicKey:
                      projectId === secondProjectId ? 'pk_project_two' : 'pk_monitor_local',
                  }
                : url.endsWith('/events/event-1')
                  ? {
                      ...eventSummary,
                      schemaVersion: 2,
                      projectId,
                      appName: 'monitor',
                      sentAt: 1_787_068_799_900,
                      breadcrumbs: [
                        {
                          category: 'click',
                          timestamp: 1_787_068_799_000,
                          message: '点击保存',
                          data: { selector: 'button.save' },
                        },
                      ],
                      replayData: replayFixture,
                      payload: {
                        exception: {
                          name: 'TypeError',
                          message: 'Cannot read profile',
                          stack: [
                            {
                              filename: 'https://example.com/profile.js',
                              functionName: 'ProfileCard.render',
                              line: 128,
                              column: 19,
                            },
                          ],
                        },
                        mechanism: { type: 'window.onerror', handled: false },
                      },
                    }
                  : url.includes(`/issues/${issueSummary.id}?`)
                    ? {
                        issue: issueSummary,
                        occurrences: [issueOccurrence],
                        page: 1,
                        pageSize: 30,
                        total: 1,
                      }
                    : url.includes('/issues?')
                      ? { issues: [issueSummary], page: 1, pageSize: 30, total: 1 }
                      : { events: [eventSummary], page: 1, pageSize: 30, total: 1 }

  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data }),
  } as Response)
}

function renderRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  const result = render(
    <MantineProvider theme={monitorTheme} defaultColorScheme="light" env="test">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  )
  return { ...result, router }
}

describe('admin event routes', () => {
  it('录屏接口夹具可被当前播放器解码', () => {
    expect(decodeReplay(replayFixture).events).toHaveLength(2)
  })

  beforeEach(() => {
    useAdminStore.setState({ projectId: primaryProjectId })
    vi.restoreAllMocks()
  })

  it('展示按根因聚合的问题并进入发生记录详情', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/issues')

    expect(await screen.findByRole('heading', { name: '问题' })).toBeInTheDocument()
    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Cannot read profile' }))
    expect(await screen.findByRole('heading', { name: 'Cannot read profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '发生记录' })).toBeInTheDocument()
    expect(screen.getByText('事件数').nextElementSibling).toHaveTextContent('3')
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes(`/issues/${issueSummary.id}?`)),
    ).toBe(true)
  })

  it('问题为空时只展示当前状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/issues?')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { issues: [], page: 1, pageSize: 30, total: 0 } }),
          } as Response)
        }
        return successfulFetch(input, init)
      }),
    )
    renderRoute('/issues')

    expect(await screen.findByRole('heading', { name: '所选时段暂无问题' })).toBeInTheDocument()
    expect(screen.queryByText(/自动聚合|异常位置/)).not.toBeInTheDocument()
  })

  it('从事件列表进入由 React Router 管理的详情页', async () => {
    vi.stubGlobal('fetch', vi.fn(successfulFetch))
    renderRoute('/events')

    fireEvent.click(await screen.findByRole('link', { name: 'Cannot read profile' }))

    expect(await screen.findByRole('heading', { name: 'Cannot read profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '错误堆栈' })).toBeInTheDocument()
    expect(screen.getByText('ProfileCard.render')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/profile.js:128:19')).toBeInTheDocument()
    expect(screen.getByText('点击保存')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Payload' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Replay Data' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '原始数据' }))
    expect(await screen.findByRole('heading', { name: 'Payload' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Replay Data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '完整事件信息' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '错误堆栈' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '概览' }))
    expect(await screen.findByRole('heading', { name: '错误堆栈' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Replay Data' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('可以直接打开原始数据标签页', async () => {
    vi.stubGlobal('fetch', vi.fn(successfulFetch))
    renderRoute('/events/event-1?view=raw')

    expect(await screen.findByRole('heading', { name: 'Payload' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '原始数据' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('heading', { name: '错误堆栈' })).not.toBeInTheDocument()
  })

  it('事件为空时不展示测试环境或存储实现', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/events?')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { events: [], page: 1, pageSize: 30, total: 0 } }),
          } as Response)
        }
        return successfulFetch(input, init)
      }),
    )
    renderRoute('/events')

    expect(await screen.findByRole('heading', { name: '暂无事件' })).toBeInTheDocument()
    expect(screen.queryByText(/monitor-demo|ClickHouse/)).not.toBeInTheDocument()
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
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = String(input)
          return url.includes('category=error') && url.includes('eventType=js_error')
        }),
      ).toBe(true)
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
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes(`/projects/${secondProjectId}/events?`),
        ),
      ).toBe(true)
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
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes(`/projects/${createdProjectId}/issues?`),
        ),
      ).toBe(true)
    })
  })

  it('创建项目时由 Zod 校验名称并在输入时清除错误', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events')

    await user.click(await screen.findByRole('button', { name: '新建项目' }))
    const nameInput = screen.getByRole('textbox', { name: '项目名称' })
    await user.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByText('请输入项目名称')).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)

    await user.type(nameInput, 'test')

    expect(nameInput).toHaveFocus()
    await waitFor(() => expect(screen.queryByText('请输入项目名称')).not.toBeInTheDocument())
  })

  it('通过受保护的项目详情重新展示 SDK 配置', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(`/projects/${secondProjectId}/settings`)

    expect(await screen.findByRole('heading', { name: '项目设置' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Project Two' })).toBeInTheDocument()
    expect(screen.getByText(/publicKey: 'pk_project_two'/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制配置' })).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(`/projects/${secondProjectId}`),
      ),
    ).toBe(true)
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

  it('项目设置由 Zod 校验名称并在输入时清除错误', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(`/projects/${secondProjectId}/settings`)

    const nameInput = await screen.findByRole('textbox', { name: '项目名称' })
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('请输入项目名称')).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'PATCH')).toBe(true)

    await user.type(nameInput, 'Renamed Project')

    expect(nameInput).toHaveFocus()
    await waitFor(() => expect(screen.queryByText('请输入项目名称')).not.toBeInTheDocument())
  })

  it('确认后轮换 publicKey 并直接更新 SDK 配置缓存', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute(`/projects/${secondProjectId}/settings`)

    expect(await screen.findByText(/publicKey: 'pk_project_two'/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新生成 publicKey' }))

    expect(screen.getByText('旧 publicKey 会立即失效')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/public-key/rotate')),
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: '确认重新生成' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith(`/projects/${secondProjectId}/public-key/rotate`) &&
            init?.method === 'POST',
        ),
      ).toBe(true)
    })
    expect(await screen.findByText(/publicKey: 'pk_rotated'/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('旧 publicKey 现在无法继续上报')
  })

  it('在登录状态失效时跳转到登录页', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { code: 'UNAUTHORIZED', message: 'unauthorized' } }),
        } as Response),
      ),
    )
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
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { projects: [] } }),
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

    expect(await screen.findByRole('heading', { name: '创建你的第一个项目' })).toBeInTheDocument()
    const authCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.endsWith('/auth/register') || url.endsWith('/auth/login'))
    expect(authCalls.map((url) => url.split('/').at(-1))).toEqual(['register', 'login'])
  })

  it('无项目时只保留一个明确的创建入口', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/projects') && init?.method !== 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { projects: [] } }),
        } as Response)
      }
      return successfulFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/issues')

    expect(await screen.findByText('暂无项目')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '当前项目' })).not.toBeInTheDocument()
    const createButton = screen.getByRole('button', { name: '创建第一个项目' })
    expect(screen.getAllByRole('button', { name: /新建项目|创建第一个项目/ })).toHaveLength(1)

    await user.click(createButton)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
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
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith('/auth/logout') && init?.method === 'DELETE',
      ),
    ).toBe(true)
  })
})

describe('时间范围与查询导航', () => {
  beforeEach(() => {
    useAdminStore.setState({ projectId: primaryProjectId })
    vi.restoreAllMocks()
  })

  const fixed = 'from=1787060000123&to=1787068800456&range=custom'

  it('默认区间写入 URL，刷新预设才推进窗口', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1789444800123)
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    const { router } = renderRoute('/events')
    await screen.findByText('Cannot read profile')
    const original = new URLSearchParams(router.state.location.search)
    expect(Number(original.get('to')) - Number(original.get('from'))).toBe(86400000)
    expect(original.get('to')).toBe('1789444800123')
    now.mockReturnValue(1789444805123)
    fireEvent.click(screen.getByRole('button', { name: '刷新事件' }))
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('to')).toBe('1789444805123'),
    )
    await screen.findByText('Cannot read profile')
  })

  it('翻页保持区间，选择新时间从第一页开始', async () => {
    const calls: URLSearchParams[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        if (url.pathname.endsWith('/events')) {
          calls.push(url.searchParams)
          const nextPage = url.searchParams.get('page') === '2'
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                events: [
                  {
                    ...eventSummary,
                    eventId: nextPage ? 'event-2' : 'event-1',
                    message: nextPage ? '第二页错误' : '第一页错误',
                  },
                ],
                page: nextPage ? 2 : 1,
                pageSize: 30,
                total: 31,
              },
            }),
          } as Response)
        }
        return successfulFetch(input, init)
      }),
    )
    renderRoute('/events?' + fixed + '&category=error')
    await screen.findByText('第一页错误')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('第二页错误')
    expect(calls[1].get('page')).toBe('2')
    expect(calls[1].get('from')).toBe(calls[0].get('from'))
    expect(calls[1].get('to')).toBe(calls[0].get('to'))
    fireEvent.click(screen.getByRole('button', { name: '时间范围：自定义时间' }))
    fireEvent.click(screen.getByRole('button', { name: '最近 1 小时' }))
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].get('page')).toBe('1')
    expect(calls[2].get('category')).toBe('error')
    expect(Number(calls[2].get('to')) - Number(calls[2].get('from'))).toBe(3600000)
    expect(screen.queryByText('第二页错误')).not.toBeInTheDocument()
  })

  it('事件详情切换页签再返回仍保留时间和类型筛选', async () => {
    vi.stubGlobal('fetch', vi.fn(successfulFetch))
    const { router } = renderRoute('/events?' + fixed + '&category=error&eventType=js_error')
    fireEvent.click(await screen.findByRole('link', { name: 'Cannot read profile' }))
    await screen.findByRole('heading', { name: 'Cannot read profile' })
    fireEvent.click(screen.getByRole('tab', { name: '原始数据' }))
    fireEvent.click(screen.getByRole('link', { name: '返回事件流' }))
    await screen.findByRole('heading', { name: '事件流' })
    expect(router.state.location.search).toBe('?' + fixed + '&category=error&eventType=js_error')
  })

  it('问题、发生记录、最近事件共用区间，逐级返回不丢条件', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    const { router } = renderRoute('/issues?' + fixed)
    fireEvent.click(await screen.findByRole('link', { name: 'Cannot read profile' }))
    await screen.findByRole('heading', { name: '发生记录' })
    expect(
      screen.getByRole('link', { name: 'Cannot read profile' }).getAttribute('href'),
    ).toContain(fixed)
    fireEvent.click(screen.getByRole('link', { name: '查看最近事件' }))
    await screen.findByRole('heading', { name: 'Cannot read profile' })
    fireEvent.click(screen.getByRole('link', { name: '返回问题详情' }))
    await screen.findByRole('heading', { name: '发生记录' })
    fireEvent.click(screen.getByRole('link', { name: '返回问题列表' }))
    await screen.findByRole('heading', { name: '问题' })
    expect(router.state.location.search).toBe('?' + fixed + '&page=1&pageSize=30')
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.includes('/issues')) {
        expect(url.searchParams.get('from')).toBe('1787060000123')
        expect(url.searchParams.get('to')).toBe('1787068800456')
      }
    }
  })

  it('自定义范围校验，不发送颠倒区间，应用后支持浏览器后退', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    const { router } = renderRoute('/events?' + fixed)
    await screen.findByText('Cannot read profile')
    fireEvent.click(screen.getByRole('button', { name: '时间范围：自定义时间' }))
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-09-15T12:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-09-14T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: '应用时间范围' }))
    await screen.findByText('结束时间须晚于开始时间，且不晚于 2100 年')
    expect(router.state.location.search).toBe('?' + fixed)
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-09-16T12:00' } })
    await waitFor(() =>
      expect(
        screen.queryByText('结束时间须晚于开始时间，且不晚于 2100 年'),
      ).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: '应用时间范围' }))
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('from')).toBe(
        String(new Date('2026-09-15T12:00').getTime()),
      ),
    )
    await act(() => router.navigate(-1))
    expect(router.state.location.search).toBe('?' + fixed)
  })

  it('URL 时间无效时不请求，用户重新选择后恢复', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/issues?from=200&to=100')
    await screen.findByText('时间范围无效，请重新选择')
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/issues?'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '时间范围：选择时间' }))
    fireEvent.click(screen.getByRole('button', { name: '最近 7 天' }))
    await screen.findByText('Cannot read profile')
  })
})

describe('页码分页', () => {
  const fixed = 'from=1787060000123&to=1787068800456&range=custom'

  function pagedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = new URL(String(input), 'http://localhost')
    const page = Number(url.searchParams.get('page') || 1)
    const pageSize = Number(url.searchParams.get('pageSize') || 30)
    const total = url.searchParams.has('category') ? 7 : 65
    const start = (page - 1) * pageSize
    const events = Array.from({ length: total }, (_, index) => ({
      ...eventSummary,
      eventId: index === 0 ? 'event-1' : `event-${index + 1}`,
      message: index === 0 ? 'Cannot read profile' : `测试错误 ${index + 1}`,
    })).slice(start, start + pageSize)
    const info = { page, pageSize, total }
    const data = url.pathname.endsWith('/events')
      ? { events, ...info }
      : url.pathname.endsWith('/issues')
        ? {
            issues: events.map((item) => ({
              ...issueSummary,
              id: item.eventId === 'event-1' ? issueSummary.id : item.eventId,
              title: item.message,
            })),
            ...info,
          }
        : url.pathname.endsWith('/issues/' + issueSummary.id)
          ? { issue: { ...issueSummary, eventCount: total }, occurrences: events, ...info }
          : null
    return data
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as Response)
      : successfulFetch(input, init)
  }

  beforeEach(() => {
    useAdminStore.setState({ projectId: primaryProjectId })
    vi.restoreAllMocks()
  })

  it.each(['/events', '/issues', '/issues/' + issueSummary.id])(
    '%s 可跳到末页、回到首页，且只显示当前页',
    async (path) => {
      const user = userEvent.setup()
      const fetchMock = vi.fn(pagedFetch)
      vi.stubGlobal('fetch', fetchMock)
      const { router } = renderRoute(path + '?' + fixed)
      await screen.findByRole('link', { name: '测试错误 30' })
      expect(screen.queryByRole('link', { name: '测试错误 31' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('列表分页')).toHaveTextContent('共 65 条')
      await user.clear(screen.getByLabelText('跳转页码'))
      await user.type(screen.getByLabelText('跳转页码'), '3')
      await user.click(screen.getByRole('button', { name: '跳转' }))
      await screen.findByRole('link', { name: '测试错误 65' })
      expect(screen.queryByRole('link', { name: '测试错误 30' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('列表分页')).toHaveTextContent('第 61–65 条')
      expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3')
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input), 'http://localhost')
          return url.pathname.endsWith(path) && url.searchParams.get('page') === '2'
        }),
      ).toBe(false)
      await user.click(screen.getByRole('button', { name: '第一页' }))
      await screen.findByRole('link', { name: '测试错误 30' })
      expect(new URLSearchParams(router.state.location.search).get('page')).toBe('1')
    },
  )

  it('修改每页条数或分类回到第一页，浏览器后退恢复原页', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(pagedFetch))
    const { router } = renderRoute('/events?' + fixed + '&page=3')
    await screen.findByRole('link', { name: '测试错误 65' })
    await user.click(screen.getByRole('combobox', { name: '每页条数' }))
    await user.click(screen.getByRole('option', { name: '10 条/页' }))
    await screen.findByRole('link', { name: '测试错误 10' })
    expect(screen.queryByRole('link', { name: '测试错误 11' })).not.toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('1')
    expect(new URLSearchParams(router.state.location.search).get('pageSize')).toBe('10')
    await act(async () => {
      await router.navigate(-1)
    })
    await screen.findByRole('link', { name: '测试错误 65' })
    await user.click(screen.getByRole('combobox', { name: '事件分类' }))
    await user.click(screen.getByRole('option', { name: '错误' }))
    await user.click(screen.getByRole('button', { name: '应用筛选' }))
    await screen.findByRole('link', { name: '测试错误 7' })
    expect(screen.getByLabelText('列表分页')).toHaveTextContent('共 7 条')
    expect(new URLSearchParams(router.state.location.search).get('page')).toBeNull()
  })

  it('越界页仍提供总数和回首页入口', async () => {
    vi.stubGlobal('fetch', vi.fn(pagedFetch))
    renderRoute('/events?' + fixed + '&page=99')
    await screen.findByText('当前页暂无数据')
    expect(screen.getByLabelText('列表分页')).toHaveTextContent('共 65 条')
    fireEvent.click(screen.getByRole('button', { name: '返回第一页' }))
    await screen.findByRole('link', { name: '测试错误 30' })
  })

  it('翻页失败不展示上一页的数据，重试仍请求目标页', async () => {
    let fail = true
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.endsWith('/events') && url.searchParams.get('page') === '2' && fail) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'failed' } }),
        } as Response)
      }
      return pagedFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { router } = renderRoute('/events?' + fixed)
    await screen.findByRole('link', { name: '测试错误 30' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('link', { name: '测试错误 30' })).not.toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('2')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await screen.findByRole('link', { name: '测试错误 60' })
  })

  it('事件详情往返保留当前页，Issue 列表与发生记录使用各自页码', async () => {
    vi.stubGlobal('fetch', vi.fn(pagedFetch))
    const { router } = renderRoute('/events?' + fixed + '&page=1&pageSize=10')
    fireEvent.click(await screen.findByRole('link', { name: 'Cannot read profile' }))
    await screen.findByRole('heading', { name: 'Cannot read profile' })
    fireEvent.click(screen.getByRole('link', { name: '返回事件流' }))
    await screen.findByRole('link', { name: '测试错误 10' })
    expect(router.state.location.search).toBe('?' + fixed + '&page=1&pageSize=10')

    await act(async () => {
      await router.navigate(
        '/issues/' +
          issueSummary.id +
          '?' +
          fixed +
          '&issuesPage=3&issuesPageSize=20&page=2&pageSize=10',
      )
    })
    await screen.findByRole('link', { name: '测试错误 20' })
    fireEvent.click(screen.getByRole('link', { name: '查看最近事件' }))
    await screen.findByRole('heading', { name: 'Cannot read profile' })
    fireEvent.click(screen.getByRole('link', { name: '返回问题详情' }))
    await screen.findByRole('link', { name: '测试错误 20' })
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('2')
    fireEvent.click(screen.getByRole('link', { name: '返回问题列表' }))
    await screen.findByRole('link', { name: '测试错误 60' })
    expect(new URLSearchParams(router.state.location.search).get('pageSize')).toBe('20')
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3')
    expect(new URLSearchParams(router.state.location.search).has('issuesPage')).toBe(false)
  })
})
