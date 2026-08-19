import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '@/app/router'
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

function successfulFetch(input: RequestInfo | URL) {
  const url = String(input)
  const projectId = url.includes('/projects/project-two/') ? 'project-two' : 'monitor-local'
  const data = url.endsWith('/projects')
    ? {
        projects: [
          { id: 'monitor-local', name: 'Monitor Local', enabled: true, createdAt: 1_787_068_700_000 },
          { id: 'project-two', name: 'Project Two', enabled: true, createdAt: 1_787_068_800_000 },
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
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}

describe('admin event routes', () => {
  beforeEach(() => {
    useAdminStore.setState({ projectId: 'monitor-local' })
    vi.restoreAllMocks()
  })

  it('从事件列表进入由 React Router 管理的详情页', async () => {
    vi.stubGlobal('fetch', vi.fn(successfulFetch))
    renderRoute('/events')

    fireEvent.click(await screen.findByRole('link', { name: 'Cannot read profile' }))

    expect(await screen.findByRole('heading', { name: 'Cannot read profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Payload' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('把筛选条件交给 URL 和 TanStack Query', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events?category=error&eventType=js_error')

    await screen.findByRole('link', { name: 'Cannot read profile' })

    const eventRequest = fetchMock.mock.calls.find(([input]) => String(input).includes('/events?'))
    expect(String(eventRequest?.[0])).toContain('category=error')
    expect(String(eventRequest?.[0])).toContain('eventType=js_error')
  })

  it('切换项目后使用新的项目上下文重新查询事件', async () => {
    const fetchMock = vi.fn(successfulFetch)
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/events')

    await screen.findByRole('option', { name: 'Project Two' })
    const projectSwitcher = screen.getByRole('combobox', { name: '当前项目' })
    fireEvent.change(projectSwitcher, { target: { value: 'project-two' } })

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/projects/project-two/events?'))).toBe(true)
    })
    expect(useAdminStore.getState().projectId).toBe('project-two')
  })

  it('在鉴权失败时显示可重试错误状态', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { code: 'UNAUTHORIZED', message: 'unauthorized' } }),
    } as Response)))
    renderRoute('/events')

    expect(await screen.findByRole('alert')).toHaveTextContent('unauthorized')
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })
})
