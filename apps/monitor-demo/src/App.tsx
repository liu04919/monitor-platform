import { memo, type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { REACT_PROFILER_CAPABILITY } from 'minitor-sdk/plugins'
import { BEACON_TEST_MODE, BEACON_TEST_RUN_ID, monitor, REPORT_URL } from './monitor'

type TestStatus = 'idle' | 'running' | 'done' | 'failed'

type BoundaryFallbackProps = {
  error: { payload?: { exception?: { message?: string } } } | null
}
type BoundaryProps = { children: ReactNode; Fallback: ComponentType<BoundaryFallbackProps> }
type ProfilerProps = { id: string; children: ReactNode; disabled?: boolean }

const ErrorBoundary = monitor.getCapability<ComponentType<BoundaryProps>>('error:react-boundary')
const MonitorProfiler = monitor.getCapability<ComponentType<ProfilerProps>>(REACT_PROFILER_CAPABILITY)

const scenarios = [
  { id: 'fetch', index: '01', category: '网络性能', title: 'Fetch 请求', description: '发起成功请求，验证状态码、耗时和参数采集。' },
  { id: 'xhr', index: '02', category: '网络性能', title: 'XHR 请求', description: '使用 XMLHttpRequest 验证传统 Ajax 拦截。' },
  { id: 'stream', index: '03', category: 'AI 性能', title: 'AI 流式响应', description: '采集 TTFB、TTFT、Chunk 数量与间隔。' },
  { id: 'custom', index: '04', category: '用户行为', title: '自定义事件', description: '调用 Behavior 能力，验证业务自定义埋点。' },
  { id: 'route', index: '05', category: '用户行为', title: '路由切换', description: '触发 pushState，记录来源、去向和停留时间。' },
  { id: 'longtask', index: '06', category: '页面性能', title: '主线程长任务', description: '阻塞约 180ms，验证 Long Task 与 RAF 卡顿。' },
  { id: 'js', index: '07', category: '错误采集', title: 'JavaScript 错误', description: '抛出全局运行时错误并采集源码位置和堆栈。' },
  { id: 'promise', index: '08', category: '错误采集', title: 'Promise 错误', description: '制造未处理拒绝并采集堆栈与行为轨迹。' },
  { id: 'resource', index: '09', category: '错误采集', title: '资源加载错误', description: '加载不存在的图片，验证资源错误定位。' },
] as const

type ScenarioId = (typeof scenarios)[number]['id']

function sleep(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

function runXhr() {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', `/api/demo/success?transport=xhr&at=${Date.now()}`)
    xhr.onload = () => resolve()
    xhr.onerror = () => reject(new Error('XHR 请求失败'))
    xhr.send()
  })
}

async function consumeStream() {
  const response = await fetch('/api/demo/chat?scenario=demo')
  if (!response.body) throw new Error('浏览器不支持 ReadableStream')
  const reader = response.body.getReader()
  while (!(await reader.read()).done) {
    // 完整消费响应体，SDK 才能计算流结束时间和 Chunk 指标。
  }
}

function blockMainThread() {
  const start = performance.now()
  while (performance.now() - start < 180) {
    Math.sqrt(Math.random() * 10_000)
  }
}

function MissingResource() {
  const image = document.createElement('img')
  image.alt = ''
  image.hidden = true
  image.src = `/api/demo/assets/not-found-${Date.now()}.png`
  document.body.append(image)
  setTimeout(() => image.remove(), 2_000)
}

function Bomb(): never {
  throw new Error('React ErrorBoundary 测试错误')
}

function BoundaryFallback({ error }: BoundaryFallbackProps) {
  return (
    <div className="boundary-fallback">
      <strong>React 错误已捕获</strong>
      <span>{error?.payload?.exception?.message || '等待 SDK 上报错误详情'}</span>
    </div>
  )
}

function ScenarioIcon({ id }: { id: ScenarioId }) {
  const icons: Record<ScenarioId, string> = { fetch: '↗', xhr: '⇄', stream: '≈', custom: '✦', route: '⌁', longtask: '◴', js: '×', promise: '!', resource: '◇' }
  return <span className="scenario-icon" aria-hidden="true">{icons[id]}</span>
}

const ReactLab = memo(function ReactLab() {
  const [reactBomb, setReactBomb] = useState(false)
  const [renderCount, setRenderCount] = useState(0)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('auto') !== '1') return

    const timer = window.setTimeout(() => setReactBomb(true), 3_500)
    return () => window.clearTimeout(timer)
  }, [])

  const profilerContent = (
    <div className="profiler-test">
      <div><span>React Profiler</span><strong>{renderCount}</strong><small>次状态更新</small></div>
      <button type="button" onClick={() => setRenderCount((count) => count + 1)}>触发渲染 +</button>
    </div>
  )

  return (
    <section id="react-lab" className="react-lab" aria-labelledby="reactLabTitle">
      <div className="section-heading"><div><p className="eyebrow">02 / REACT PLUGINS</p><h2 id="reactLabTitle">React 专项验证</h2></div></div>
      <div className="react-grid">
        <article>
          <span className="lab-label">PROFILER</span>
          {MonitorProfiler ? <MonitorProfiler id="demo-counter">{profilerContent}</MonitorProfiler> : profilerContent}
        </article>
        <article>
          <span className="lab-label">ERROR BOUNDARY</span>
          <div className="boundary-test">
            {ErrorBoundary ? <ErrorBoundary key={String(reactBomb)} Fallback={BoundaryFallback}>{reactBomb ? <Bomb /> : <p>组件运行正常，点击按钮触发渲染错误。</p>}</ErrorBoundary> : <p>React ErrorBoundary 能力未注册</p>}
            <button type="button" onClick={() => setReactBomb(true)}>触发 React 错误</button>
          </div>
        </article>
      </div>
    </section>
  )
})

export function App() {
  const [statuses, setStatuses] = useState<Record<string, TestStatus>>({})
  const [reportedCount, setReportedCount] = useState(0)
  const [reportState, setReportState] = useState<'waiting' | 'success' | 'failed'>('waiting')
  const autoRan = useRef(false)
  const beaconRan = useRef(false)

  useEffect(() => {
    if (!BEACON_TEST_MODE || beaconRan.current) return
    beaconRan.current = true

    const behavior = monitor.getCapability<{ customHandler: (data: object) => void }>('behavior:instance')
    if (!behavior) throw new Error('Behavior 能力未注册，无法执行 Beacon 测试')

    behavior.customHandler({
      eventKey: `beacon_exit_${BEACON_TEST_RUN_ID}`,
      eventAction: 'page-exit',
      eventValue: { runId: BEACON_TEST_RUN_ID, transport: 'sendBeacon' },
    })

    // 完成页不加载 SDK，避免 IndexedDB 中的同一批数据立刻被 Fetch 重传。
    const completeUrl = new URL('/beacon-complete.html', window.location.origin)
    completeUrl.searchParams.set('runId', BEACON_TEST_RUN_ID)
    window.location.replace(completeUrl)
  }, [])

  useEffect(() => {
    const handleReported = (event: Event) => {
      const events = (event as CustomEvent<unknown[]>).detail
      setReportedCount((count) => count + (Array.isArray(events) ? events.length : 0))
      setReportState('success')
    }
    const handleReportFailed = () => setReportState('failed')

    window.addEventListener('monitor:reported', handleReported)
    window.addEventListener('monitor:report-failed', handleReportFailed)

    return () => {
      window.removeEventListener('monitor:reported', handleReported)
      window.removeEventListener('monitor:report-failed', handleReportFailed)
    }
  }, [])

  const execute = useCallback(async (id: ScenarioId) => {
    setStatuses((current) => ({ ...current, [id]: 'running' }))
    try {
      if (id === 'fetch') await fetch(`/api/demo/success?transport=fetch&at=${Date.now()}`)
      if (id === 'xhr') await runXhr()
      if (id === 'stream') await consumeStream()
      if (id === 'custom') {
        const behavior = monitor.getCapability<{ customHandler: (data: object) => void }>('behavior:instance')
        if (!behavior) throw new Error('Behavior 能力未注册')
        behavior.customHandler({ eventKey: 'demo_cta', eventAction: 'click', eventValue: { source: 'test-console' } })
      }
      if (id === 'route') {
        const nextRoute = `/scenario/${Date.now()}`
        window.history.pushState({ source: 'monitor-demo' }, '', nextRoute)
      }
      if (id === 'longtask') blockMainThread()
      if (id === 'js') window.setTimeout(() => { throw new Error('全局 JavaScript 测试错误') }, 0)
      if (id === 'promise') Promise.reject(new Error('未处理 Promise 测试错误'))
      if (id === 'resource') MissingResource()
      await sleep(300)
      setStatuses((current) => ({ ...current, [id]: 'done' }))
    } catch (error) {
      console.error(error)
      setStatuses((current) => ({ ...current, [id]: 'failed' }))
    }
  }, [])

  useEffect(() => {
    if (autoRan.current || new URLSearchParams(window.location.search).get('auto') !== '1') return
    autoRan.current = true
    void (async () => {
      for (const id of ['fetch', 'xhr', 'stream', 'custom', 'route', 'longtask', 'js', 'promise', 'resource'] as ScenarioId[]) {
        await execute(id)
      }

      // 自动验证用于一次性联调，等待最后一批事件发送后关闭采集，避免页面长期驻留。
      await sleep(2_000)
      monitor.destroy()
    })()
  }, [execute])

  const runAll = async () => {
    for (const scenario of scenarios) await execute(scenario.id)
  }

  const completedCount = Object.values(statuses).filter((status) => status === 'done').length

  return (
    <div className="console-shell">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-cube" aria-hidden="true"></span><span>MINITOR<span>/SDK</span></span></a>
        <nav aria-label="快捷链接"><a href="#scenarios">测试场景</a><a href="#react-lab">React 插件</a></nav>
        <div className={`server-state ${reportState === 'success' ? 'online' : ''}`}>
          <i></i>{reportState === 'success' ? 'Go ingestion 已接通' : reportState === 'failed' ? '上报失败，等待重试' : '等待首次上报'}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">BROWSER SDK / CAPABILITY LAB</p>
            <h1>把监控 SDK<br /><em>真正跑一遍。</em></h1>
            <p className="intro">当前使用仓库内 <code>minitor-sdk</code>，数据上报到本地 Go ingestion，再写入 PostgreSQL 与 ClickHouse。</p>
            <div className="hero-actions"><button className="primary" type="button" onClick={runAll}>运行全部测试 <span>→</span></button><a href="#scenarios">逐项验证</a></div>
          </div>
          <div className="signal-card" aria-label="SDK 当前状态">
            <div className="signal-visual"><span className="ring ring-one"></span><span className="ring ring-two"></span><span className="signal-core">TEST<strong>READY</strong></span></div>
            <div className="signal-meta"><span>INGESTION ENDPOINT</span><code>{REPORT_URL}</code></div>
            <div className="signal-count"><strong>{reportedCount}</strong><span>已被 Go 服务接受的事件</span></div>
          </div>
        </section>

        <section id="scenarios" className="scenarios" aria-labelledby="scenarioTitle">
          <div className="section-heading"><div><p className="eyebrow">01 / TEST MATRIX</p><h2 id="scenarioTitle">可重复的测试场景</h2></div><p>请先启动数据库和 Go 服务，再逐项触发。<br />当前完成 {completedCount} 项；右上角显示真实上报状态。</p></div>
          <div className="scenario-grid">
            {scenarios.map((scenario) => {
              const status = statuses[scenario.id] || 'idle'
              return (
                <article className={`scenario-card ${status}`} key={scenario.id}>
                  <div className="scenario-top"><span>{scenario.index}</span><ScenarioIcon id={scenario.id} /></div>
                  <p className="scenario-category">{scenario.category}</p>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.description}</p>
                  <button type="button" disabled={status === 'running'} onClick={() => execute(scenario.id)}>
                    <span>{status === 'running' ? '执行中…' : status === 'done' ? '再次运行' : status === 'failed' ? '重试' : '运行测试'}</span><b>{status === 'done' ? '✓' : '→'}</b>
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <ReactLab />
      </main>

      <footer><span>MONITOR INGESTION LAB</span><span>Browser SDK → Go → PostgreSQL → ClickHouse</span></footer>
    </div>
  )
}
