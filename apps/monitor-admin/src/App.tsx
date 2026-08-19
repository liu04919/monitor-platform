import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { APIError, getEvent, listEvents } from './api'
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  EmptyIcon,
  EventsIcon,
  ExternalIcon,
  PulseIcon,
  RefreshIcon,
} from './icons'
import type { Breadcrumb, EventCategory, EventDetail, EventFilters, EventSummary } from './types'

const PROJECT_ID = import.meta.env.VITE_MONITOR_PROJECT_ID?.trim() || 'monitor-local'
const EMPTY_FILTERS: EventFilters = { category: '', eventType: '' }

type Route = { page: 'events' } | { page: 'detail'; eventId: string }

const categoryLabels: Record<EventCategory, string> = {
  error: '错误',
  performance: '性能',
  behavior: '行为',
  stability: '稳定性',
  ai: 'AI 性能',
}

function routeFromLocation(): Route {
  const match = window.location.pathname.match(/^\/events\/([^/]+)\/?$/)
  if (match) return { page: 'detail', eventId: decodeURIComponent(match[1]) }
  return { page: 'events' }
}

function eventPath(eventId: string) {
  return `/events/${encodeURIComponent(eventId)}`
}

function displayEventName(event: Pick<EventSummary, 'eventType'> & { message?: string }) {
  return event.message?.trim() || event.eventType.replaceAll('_', ' ')
}

function detailEventName(event: EventDetail) {
  const payloadMessage = typeof event.payload.message === 'string' ? event.payload.message.trim() : ''
  const exception = event.payload.exception
  const exceptionMessage = typeof exception === 'object' && exception !== null && 'message' in exception && typeof exception.message === 'string'
    ? exception.message.trim()
    : ''
  return event.message?.trim() || payloadMessage || exceptionMessage || event.eventType.replaceAll('_', ' ')
}

function formatTime(value: number, includeDate = true) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: includeDate ? '2-digit' : undefined,
    day: includeDate ? '2-digit' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function formatFullTime(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(date)
}

function errorMessage(error: unknown) {
  if (error instanceof APIError) return error.message
  if (error instanceof Error) return error.message
  return '发生了未知错误，请稍后重试。'
}

function navigate(path: string, onNavigate: (route: Route) => void) {
  window.history.pushState(null, '', path)
  onNavigate(routeFromLocation())
}

function AppShell({ route, onNavigate, children }: { route: Route; onNavigate: (route: Route) => void; children: ReactNode }) {
  const backToEvents = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    navigate('/events', onNavigate)
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark"><PulseIcon /></span>
          <span><strong>Monitor</strong><small>Admin</small></span>
        </div>

        <div className="project-context">
          <span>当前项目</span>
          <strong>{PROJECT_ID}</strong>
          <small>本地遥测项目</small>
        </div>

        <nav aria-label="管理端导航">
          <a className="active" href="/events" onClick={backToEvents}>
            <EventsIcon />
            <span>事件流</span>
          </a>
        </nav>

        <div className="sidebar-foot">
          <span className="connection-dot" />
          <span><strong>LOCAL ADMIN</strong><small>服务端代理鉴权</small></span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><PulseIcon /></span><strong>Monitor</strong></div>
          <nav aria-label="面包屑">
            <a href="/events" onClick={backToEvents}>事件流</a>
            {route.page === 'detail' ? <><ChevronIcon /><span>事件详情</span></> : null}
          </nav>
          <div className="project-chip"><span />{PROJECT_ID}</div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  )
}

function CategoryBadge({ category }: { category: EventCategory }) {
  return <span className={`category-badge category-${category}`}><i />{categoryLabels[category]}</span>
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((row) => (
        <div className="event-row loading-row" key={row} aria-hidden="true">
          <span className="skeleton skeleton-title" />
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton skeleton-dot" />
        </div>
      ))}
    </>
  )
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="empty-state">
      <span><EmptyIcon /></span>
      <h2>{filtered ? '没有匹配的事件' : '还没有遥测事件'}</h2>
      <p>{filtered ? '调整分类或事件类型后再试。' : '从 monitor-demo 触发场景后，事件会出现在这里。'}</p>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <span><AlertIcon /></span>
      <div><h2>事件读取失败</h2><p>{message}</p></div>
      <button type="button" onClick={onRetry}>重新加载</button>
    </div>
  )
}

function EventsPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [draftFilters, setDraftFilters] = useState<EventFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS)
  const [events, setEvents] = useState<EventSummary[]>([])
  const [nextCursor, setNextCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')

    void listEvents(PROJECT_ID, filters, '', controller.signal)
      .then((page) => {
        setEvents(page.events)
        setNextCursor(page.nextCursor)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setError(errorMessage(requestError))
        setEvents([])
        setNextCursor('')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [filters, refreshKey])

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters({ category: draftFilters.category, eventType: draftFilters.eventType.trim() })
  }

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
  }

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError('')
    try {
      const page = await listEvents(PROJECT_ID, filters, nextCursor)
      setEvents((current) => [...current, ...page.events])
      setNextCursor(page.nextCursor)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoadingMore(false)
    }
  }

  const openEvent = (event: React.MouseEvent<HTMLAnchorElement>, eventId: string) => {
    event.preventDefault()
    navigate(eventPath(eventId), onNavigate)
  }

  const hasFilters = Boolean(filters.category || filters.eventType)

  return (
    <section className="page events-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TELEMETRY EXPLORER</p>
          <h1>事件流</h1>
          <p>浏览由浏览器 SDK 上报并写入 ClickHouse 的原始事件。</p>
        </div>
        <button className="icon-button" type="button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} aria-label="刷新事件">
          <RefreshIcon />
        </button>
      </div>

      <form className="filter-bar" onSubmit={applyFilters}>
        <label>
          <span>事件分类</span>
          <select value={draftFilters.category} onChange={(event) => setDraftFilters((current) => ({ ...current, category: event.target.value as EventCategory | '' }))}>
            <option value="">全部分类</option>
            <option value="error">错误</option>
            <option value="performance">性能</option>
            <option value="behavior">行为</option>
            <option value="stability">稳定性</option>
            <option value="ai">AI 性能</option>
          </select>
        </label>
        <label className="event-type-filter">
          <span>事件类型</span>
          <input value={draftFilters.eventType} onChange={(event) => setDraftFilters((current) => ({ ...current, eventType: event.target.value }))} placeholder="例如 js_error" />
        </label>
        <button className="primary-button" type="submit">应用筛选</button>
        {hasFilters ? <button className="text-button" type="button" onClick={clearFilters}>清除</button> : null}
      </form>

      <div className="event-panel">
        <div className="event-table-header event-row" aria-hidden="true">
          <span>事件</span><span>分类</span><span>事件类型</span><span>用户</span><span>发生时间</span><span>传输</span>
        </div>

        {loading ? <LoadingRows /> : null}
        {!loading && error && events.length === 0 ? <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} /> : null}
        {!loading && !error && events.length === 0 ? <EmptyState filtered={hasFilters} /> : null}

        {!loading ? events.map((item) => (
          <article className="event-row event-item" key={item.eventId}>
            <div className="event-identity">
              <span className={`event-severity severity-${item.category}`}><AlertIcon /></span>
              <div>
                <a href={eventPath(item.eventId)} onClick={(event) => openEvent(event, item.eventId)}>{displayEventName(item)}</a>
                <span title={item.pageUrl}>{item.pageUrl || '未记录页面地址'}</span>
              </div>
            </div>
            <div><CategoryBadge category={item.category} /></div>
            <code className="event-type">{item.eventType}</code>
            <span className="muted-cell">{item.userId || '匿名'}</span>
            <time dateTime={new Date(item.timestamp).toISOString()}>{formatTime(item.timestamp)}</time>
            <div className="transport-cell"><span className={`transport transport-${item.sendType}`}>{item.sendType}</span><a href={eventPath(item.eventId)} onClick={(event) => openEvent(event, item.eventId)} aria-label={`查看 ${displayEventName(item)} 详情`}><ChevronIcon /></a></div>
          </article>
        )) : null}

        {!loading && events.length > 0 ? (
          <footer className="table-footer">
            <span>已加载 <strong>{events.length}</strong> 条事件</span>
            {nextCursor ? <button type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? '加载中…' : '加载更多'}<ChevronIcon /></button> : <span>已经到底了</span>}
          </footer>
        ) : null}
      </div>

      {error && events.length > 0 ? <div className="inline-error" role="alert"><AlertIcon />{error}<button type="button" onClick={loadMore}>重试</button></div> : null}
    </section>
  )
}

function DetailSkeleton() {
  return (
    <div className="detail-skeleton" aria-hidden="true">
      <span className="skeleton detail-title-skeleton" />
      <div className="summary-card"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
      <div className="code-card"><span className="skeleton" /></div>
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timeout.current), [])

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.clearTimeout(timeout.current)
    timeout.current = window.setTimeout(() => setCopied(false), 1600)
  }

  return <button className="copy-button" type="button" onClick={copy}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? '已复制' : '复制'}</button>
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  const formatted = JSON.stringify(value, null, 2)
  return (
    <section className="detail-card code-card">
      <header><h2>{title}</h2><CopyButton value={formatted} /></header>
      <pre><code>{formatted}</code></pre>
    </section>
  )
}

function MetadataItem({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className="metadata-item"><dt>{label}</dt><dd className={mono ? 'mono' : undefined}>{children || '—'}</dd></div>
}

function BreadcrumbsPanel({ breadcrumbs }: { breadcrumbs: Breadcrumb[] }) {
  return (
    <section className="detail-card breadcrumbs-card">
      <header><div><h2>Breadcrumbs</h2><span>{breadcrumbs.length} 条轨迹</span></div></header>
      {breadcrumbs.length === 0 ? <p className="compact-empty">此事件没有携带行为轨迹。</p> : (
        <div className="breadcrumb-list">
          {breadcrumbs.map((breadcrumb, index) => (
            <article key={`${breadcrumb.timestamp}-${index}`}>
              <span className={`timeline-dot dot-${breadcrumb.category}`} />
              <time>{formatTime(breadcrumb.timestamp, false)}</time>
              <span className="breadcrumb-category">{breadcrumb.category}</span>
              <div><strong>{breadcrumb.message || '未提供描述'}</strong>{breadcrumb.data != null ? <code>{JSON.stringify(breadcrumb.data)}</code> : null}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function DetailPage({ eventId, onNavigate }: { eventId: string; onNavigate: (route: Route) => void }) {
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setDetail(null)

    void getEvent(PROJECT_ID, eventId, controller.signal)
      .then(setDetail)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setError(errorMessage(requestError))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [eventId, refreshKey])

  const goBack = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    navigate('/events', onNavigate)
  }

  if (loading) return <section className="page detail-page"><DetailSkeleton /></section>
  if (error || !detail) return <section className="page detail-page"><a className="back-link" href="/events" onClick={goBack}><ArrowLeftIcon />返回事件流</a><ErrorState message={error || '事件不存在。'} onRetry={() => setRefreshKey((key) => key + 1)} /></section>

  const replayValue = detail.replayData
  let replayDisplay: unknown = replayValue
  if (replayValue) {
    try { replayDisplay = JSON.parse(replayValue) as unknown } catch { replayDisplay = replayValue }
  }

  return (
    <section className="page detail-page">
      <a className="back-link" href="/events" onClick={goBack}><ArrowLeftIcon />返回事件流</a>

      <div className="detail-heading">
        <span className={`detail-icon severity-${detail.category}`}><AlertIcon /></span>
        <div>
          <div className="detail-badges"><CategoryBadge category={detail.category} /><span className="type-badge">{detail.eventType}</span>{detail.level ? <span className="level-badge">{detail.level}</span> : null}</div>
          <h1>{detailEventName(detail)}</h1>
          {detail.pageUrl ? <a href={detail.pageUrl} target="_blank" rel="noreferrer">{detail.pageUrl}<ExternalIcon /></a> : <span className="missing-url">未记录页面地址</span>}
        </div>
      </div>

      <section className="detail-card summary-card">
        <header><h2>事件信息</h2><span className="schema-badge">Schema v{detail.schemaVersion}</span></header>
        <dl className="metadata-grid">
          <MetadataItem label="事件 ID" mono>{detail.eventId}</MetadataItem>
          <MetadataItem label="发生时间">{formatFullTime(detail.timestamp)}</MetadataItem>
          <MetadataItem label="项目">{detail.projectId}</MetadataItem>
          <MetadataItem label="应用">{detail.appName}</MetadataItem>
          <MetadataItem label="批次 ID" mono>{detail.batchId}</MetadataItem>
          <MetadataItem label="发送时间">{formatFullTime(detail.sentAt)}</MetadataItem>
          <MetadataItem label="用户">{detail.userId || '匿名'}</MetadataItem>
          <MetadataItem label="传输方式"><span className={`transport transport-${detail.sendType}`}>{detail.sendType}</span></MetadataItem>
          <MetadataItem label="服务端接收">{formatFullTime(detail.receivedAt)}</MetadataItem>
        </dl>
      </section>

      <JsonPanel title="Payload" value={detail.payload} />

      <div className="detail-columns">
        <BreadcrumbsPanel breadcrumbs={detail.breadcrumbs} />
        <section className="detail-card context-card">
          <header><h2>原始上下文</h2></header>
          <dl>
            <MetadataItem label="Category" mono>{detail.category}</MetadataItem>
            <MetadataItem label="Event type" mono>{detail.eventType}</MetadataItem>
            <MetadataItem label="Page URL">{detail.pageUrl || '—'}</MetadataItem>
            <MetadataItem label="Level" mono>{detail.level || '—'}</MetadataItem>
          </dl>
        </section>
      </div>

      {replayValue ? <JsonPanel title="Replay Data" value={replayDisplay} /> : null}
    </section>
  )
}

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromLocation())

  useEffect(() => {
    if (window.location.pathname === '/') window.history.replaceState(null, '', '/events')
    const handlePopState = () => setRoute(routeFromLocation())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return (
    <AppShell route={route} onNavigate={setRoute}>
      {route.page === 'events'
        ? <EventsPage onNavigate={setRoute} />
        : <DetailPage eventId={route.eventId} onNavigate={setRoute} />}
    </AppShell>
  )
}
