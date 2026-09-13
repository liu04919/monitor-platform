import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { build } from 'tsup'
import { testWhiteScreen } from './white-screen.browser.mjs'
import { testHeartbeat } from './heartbeat.browser.mjs'
import { testStutter } from './stutter.browser.mjs'

await build({
  entry: ['tests/browser-entry.ts'],
  format: ['esm'],
  outDir: 'dist/browser-tests',
  dts: false,
  clean: true,
  config: false,
  noExternal: [/.*/],
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const requests = []
const errors = []
const root = resolve('dist/browser-tests')
const server = createServer(async (request, response) => {
  try {
    if (request.url.startsWith('/collect-')) {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push({ path: request.url, body: JSON.parse(body) })
      const firstHeartbeatRetry =
        request.url === '/collect-heartbeat-retry' &&
        requests.filter((item) => item.path === request.url).length === 1
      response.writeHead(firstHeartbeatRetry ? 500 : 202).end()
    } else if (new URL(request.url, 'http://localhost').pathname === '/business') {
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('business body')
    } else if (request.url === '/missing-error.png') {
      response.writeHead(404).end()
    } else if (request.url.endsWith('.js')) {
      const file = resolve(root, `.${request.url}`)
      if (!file.startsWith(root + sep)) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await readFile(file))
    } else {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><title>SDK browser regression</title><script type="module">window.sdk = await import("/browser-entry.js")</script>',
        )
    }
  } catch (error) {
    errors.push(error)
    response.writeHead(500).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.MONITOR_BROWSER_CHANNEL || undefined,
  })
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error))
  await page.goto(origin)
  await page.waitForFunction(() => window.sdk)
  await page.evaluate(() => {
    window.makeEvent = (id) => ({
      schemaVersion: 2,
      eventId: id,
      timestamp: Date.now(),
      pageUrl: location.href,
      category: 'error',
      eventType: 'js_error',
      level: 'error',
      breadcrumbs: [],
      payload: {
        exception: { name: 'Error', message: id, stack: [] },
        mechanism: { type: 'window.onerror', handled: false },
      },
    })
    window.startMonitor = (id, withFetch = false) => {
      let ctx
      const monitor = window.sdk.createMonitor({
        url: `${location.origin}/collect-${id}`,
        appId: id,
        projectName: id,
        publicKey: `key-${id}`,
        reportSuccess() {
          throw new Error('callback must stay isolated')
        },
        plugins: [
          {
            name: 'capture',
            setup(value) {
              ctx = value
            },
          },
          ...(withFetch ? [window.sdk.fetchPlugin] : []),
        ],
      })
      return { monitor, report: (eventId) => ctx.report(window.makeEvent(eventId)) }
    }
    window.a = window.startMonitor('a', true)
    window.b = window.startMonitor('b', true)
  })
  const body = await page.evaluate(async () => {
    const response = await fetch('/business')
    window.a.report('manual-a')
    window.b.report('manual-b')
    await Promise.all([window.a.monitor.flush(), window.b.monitor.flush()])
    return response.text()
  })
  assert.equal(body, 'business body')
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.path, `/collect-${request.body.app.id}`)
    assert.equal(request.body.events.length, 2)
    assert(request.body.events.some((event) => event.eventId === `manual-${request.body.app.id}`))
  }
  console.log(
    'PASS: production bundle / two instances / business Fetch / callbacks / no recursive telemetry',
  )

  await context.setOffline(true)
  await page.evaluate(async () => {
    window.a.report('offline-reload')
    await window.a.monitor.flush()
    window.a.monitor.destroy()
    window.b.monitor.destroy()
  })
  const queued = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('monitor-sdk')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const read = db.transaction('reportQueue').objectStore('reportQueue').getAll()
          read.onsuccess = () => {
            db.close()
            resolve(read.result)
          }
        }
      }),
  )
  assert.equal(queued.length, 1)
  const queuedBatch = JSON.parse(queued[0].body)
  await context.setOffline(false)
  await page.reload()
  await page.waitForFunction(() => window.sdk)
  await page.evaluate(() => {
    window.recovered = window.sdk.createMonitor({
      url: `${location.origin}/collect-a`,
      appId: 'a',
      projectName: 'a',
      publicKey: 'key-a',
    })
  })
  for (let i = 0; i < 60 && !requests.some((r) => r.body.batchId === queuedBatch.batchId); i++)
    await delay(100)
  assert(requests.some((r) => r.body.batchId === queuedBatch.batchId))
  console.log('PASS: real IndexedDB / offline / reload / stable batchId recovery')

  await page.evaluate(async () => {
    await window.recovered.flush()
    window.recovered.destroy()
    let ctx
    window.exitMonitor = window.sdk.createMonitor({
      url: `${location.origin}/collect-exit`,
      appId: 'exit',
      projectName: 'exit',
      publicKey: 'key-exit',
      plugins: [
        {
          name: 'exit-event',
          setup(value) {
            ctx = value
          },
        },
      ],
    })
    await window.exitMonitor.flush()
    ctx.report({
      schemaVersion: 2,
      eventId: 'actual-navigation',
      timestamp: Date.now(),
      pageUrl: location.href,
      category: 'performance',
      eventType: 'http_request',
      payload: { name: 'test', value: 1, unit: 'ms', attributes: {} },
    })
  })
  await page.goto(`${origin}/done`)
  for (let i = 0; i < 30 && !requests.some((r) => r.path === '/collect-exit'); i++) await delay(100)
  const exit = requests.find((r) => r.path === '/collect-exit')
  assert(exit)
  assert.equal(exit.body.sendType, 'beacon')
  assert.equal(exit.body.events[0].eventId, 'actual-navigation')
  console.log('PASS: real navigation / sendBeacon received by collector')
  await page.waitForFunction(() => window.sdk)
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => false })
    let ctx
    window.fallbackMonitor = window.sdk.createMonitor({
      url: `${location.origin}/collect-fallback`,
      appId: 'fallback',
      projectName: 'fallback',
      publicKey: 'key-fallback',
      plugins: [
        {
          name: 'fallback-event',
          setup(value) {
            ctx = value
          },
        },
      ],
    })
    await window.fallbackMonitor.flush()
    ctx.report({
      schemaVersion: 2,
      eventId: 'actual-keepalive',
      timestamp: Date.now(),
      pageUrl: location.href,
      category: 'performance',
      eventType: 'http_request',
      payload: { name: 'test', value: 1, unit: 'ms', attributes: {} },
    })
  })
  await page.goto(`${origin}/finished`)
  for (let i = 0; i < 30 && !requests.some((r) => r.path === '/collect-fallback'); i++)
    await delay(100)
  const fallback = requests.find((r) => r.path === '/collect-fallback')
  assert(fallback)
  assert.equal(fallback.body.sendType, 'fetch')
  assert.equal(fallback.body.events[0].eventId, 'actual-keepalive')
  console.log('PASS: real navigation / Beacon refused / Fetch keepalive received')
  await page.waitForFunction(() => window.sdk)
  const behaviorResult = await page.evaluate(async () => {
    const originalPush = history.pushState
    const originalReplace = history.replaceState
    const originalFetch = fetch
    const historyEvents = []
    const onHistory = (event) => historyEvents.push({ type: event.type, path: location.pathname })
    window.addEventListener('pushstate', onHistory)
    window.addEventListener('replacestate', onHistory)
    let ctx
    const monitor = window.sdk.createMonitor({
      url: `${location.origin}/collect-behavior`,
      appId: 'behavior',
      projectName: 'behavior',
      publicKey: 'key-behavior',
      plugins: [
        {
          name: 'capture',
          setup(value) {
            ctx = value
          },
        },
        ...window.sdk.behaviorPlugins(),
        window.sdk.fetchPlugin,
        window.sdk.xhrPlugin,
        window.sdk.jsErrorPlugin(),
      ],
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    await monitor.flush()
    const noReplay = ctx.getReplayData() === ''
    history.replaceState({ stateOnly: true }, '', location.href)
    history.pushState(null, '', '/behavior-route?token=secret')
    location.hash = '#/settings'
    await new Promise((resolve) => setTimeout(resolve, 30))
    document.body.innerHTML =
      '<button data-monitor-id="save"><span>private-button-text</span><svg><path /></svg></button><div id="plain"></div><section data-monitor-ignore><button>ignored</button></section>'
    document.querySelector('span').click()
    document
      .querySelector('path')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    document.querySelector('#plain').textContent = 'x'.repeat(10000)
    document.querySelector('#plain').click()
    document.querySelector('section button').click()
    const host = document.createElement('div')
    host.setAttribute('data-monitor-id', 'shadow-host')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML =
      '<button data-monitor-id="inner-button"><span>private-shadow-text</span></button>'
    shadow.querySelector('span').click()
    await fetch('/business?token=secret')
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/business?token=secret')
      xhr.onload = resolve
      xhr.onerror = reject
      xhr.send('password=secret')
    })
    monitor.addBreadcrumb({
      category: 'custom',
      message: 'project_saved',
      data: { source: 'browser-test' },
    })
    monitor.track('project_saved', { source: 'browser-test' })
    const breadcrumbs = ctx.getBreadcrumbs()
    const error = new Error('behavior regression error')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    // 错误已经取得 DONE 时的 HTTP 轨迹；让随后到来的 loadend 也完成性能事件汇总。
    await new Promise((resolve) => setTimeout(resolve, 0))
    await monitor.flush()
    monitor.destroy()
    history.pushState(null, '', '/after-destroy')
    history.replaceState(null, '', '/after-destroy-replace')
    window.removeEventListener('pushstate', onHistory)
    window.removeEventListener('replacestate', onHistory)
    document.querySelector('span').click()
    monitor.track('after_destroy')
    monitor.addBreadcrumb({ category: 'custom', message: 'after_destroy' })
    return {
      breadcrumbs,
      historyEvents,
      noReplay,
      afterDestroy: ctx.getBreadcrumbs(),
      restored:
        history.pushState === originalPush &&
        history.replaceState === originalReplace &&
        fetch === originalFetch,
    }
  })
  const behaviorEvents = requests
    .filter((r) => r.path === '/collect-behavior')
    .flatMap((r) => r.body.events)
  assert.equal(behaviorResult.noReplay, true)
  assert.equal(behaviorResult.restored, true)
  assert.deepEqual(behaviorResult.historyEvents, [
    { type: 'replacestate', path: '/finished' },
    { type: 'pushstate', path: '/behavior-route' },
  ])
  assert.deepEqual(behaviorResult.afterDestroy, [])
  assert.equal(behaviorEvents.filter((e) => e.eventType === 'page_view').length, 3)
  assert.equal(behaviorEvents.filter((e) => e.eventType === 'route_change').length, 2)
  const clicks = behaviorEvents.filter((e) => e.eventType === 'click')
  assert.equal(clicks.length, 4)
  assert.deepEqual(
    clicks.map((event) => event.payload.data.tagName),
    ['SPAN', 'path', 'DIV', 'DIV'],
  )
  assert.equal(clicks[0].payload.data.monitorId, undefined)
  assert.match(clicks[0].payload.data.path, /span:nth-of-type\(1\)$/)
  assert.match(clicks[1].payload.data.path, /path:nth-of-type\(1\)$/)
  assert.equal(clicks[3].payload.data.monitorId, 'shadow-host')
  for (const click of clicks) assert.equal(click.payload.data.textContent, undefined)
  assert.deepEqual(
    behaviorResult.breadcrumbs.map((b) => b.category),
    ['navigation', 'navigation', 'click', 'click', 'click', 'click', 'http', 'http', 'custom'],
  )
  assert(!JSON.stringify(behaviorResult.breadcrumbs).includes('secret'))
  const errorEvent = behaviorEvents.find((e) => e.eventType === 'js_error')
  assert(errorEvent)
  assert.deepEqual(errorEvent.breadcrumbs, behaviorResult.breadcrumbs)
  assert(!errorEvent.replayData)
  assert.equal(behaviorEvents.filter((e) => e.eventType === 'custom').length, 1)
  assert.equal(behaviorEvents.filter((e) => e.eventType === 'http_request').length, 2)
  console.log(
    'PASS: navigation / hash dedup / event.target click / Fetch+XHR breadcrumbs / custom API / error context / cleanup',
  )
  assert.deepEqual(errors, [])
  await context.close()

  const errorContext = await browser.newContext()
  try {
    const errorPage = await errorContext.newPage()
    const expectedPageErrors = []
    errorPage.on('pageerror', (error) => expectedPageErrors.push(error.message))
    await errorPage.goto(origin)
    await errorPage.waitForFunction(() => window.sdk)
    await errorPage.evaluate(async () => {
      window.errorMonitor = window.sdk.createMonitor({
        url: `${location.origin}/collect-errors`,
        appId: 'errors',
        projectName: 'errors',
        publicKey: 'key-errors',
        plugins: [window.sdk.jsErrorPlugin(), window.sdk.jsErrorPlugin()],
      })
      window.errorMonitor.addBreadcrumb({ category: 'custom', message: 'before-native-errors' })
      await window.errorMonitor.flush()
      setTimeout(() => {
        throw new TypeError('native js plugin probe')
      }, 0)
      void Promise.reject(new Error('native promise plugin probe'))
      const image = document.createElement('img')
      const failed = new Promise((resolve) =>
        image.addEventListener('error', resolve, { once: true }),
      )
      image.src = '/missing-error.png'
      document.body.append(image)
      await failed
      // 受限脚本的浏览器策略不在此测试中复现，仅验证收到该事件后的分类。
      window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }))
    })
    await errorPage.waitForTimeout(100)
    await errorPage.evaluate(() => window.errorMonitor.flush())
    const nativeEvents = requests
      .filter((r) => r.path === '/collect-errors')
      .flatMap((r) => r.body.events)
    assert.deepEqual(nativeEvents.map((event) => event.eventType).sort(), [
      'cors_error',
      'js_error',
      'resource_error',
      'unhandled_rejection',
    ])
    assert.deepEqual(expectedPageErrors.sort(), [
      'native js plugin probe',
      'native promise plugin probe',
    ])
    assert.equal(
      nativeEvents.find((event) => event.eventType === 'js_error').payload.exception.name,
      'TypeError',
    )
    assert(
      nativeEvents.find((event) => event.eventType === 'js_error').payload.exception.stack.length >
        0,
    )
    assert.equal(
      nativeEvents.find((event) => event.eventType === 'unhandled_rejection').payload.exception
        .message,
      'native promise plugin probe',
    )
    assert.equal(
      nativeEvents.find((event) => event.eventType === 'resource_error').payload.resource.url,
      `${origin}/missing-error.png`,
    )
    for (const event of nativeEvents) {
      assert.equal(event.breadcrumbs[0].message, 'before-native-errors')
      assert.equal(event.replayData, undefined)
    }
    const countBeforeDestroy = nativeEvents.length
    await errorPage.evaluate(async () => {
      window.errorMonitor.destroy()
      window.dispatchEvent(new ErrorEvent('error', { message: 'after-error-plugin-destroy' }))
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: 'after-destroy',
        }),
      )
      await window.errorMonitor.flush()
    })
    await errorPage.waitForTimeout(1100)
    assert.equal(
      requests.filter((r) => r.path === '/collect-errors').flatMap((r) => r.body.events).length,
      countBeforeDestroy,
    )
    console.log(
      'PASS: native JS / native Promise rejection / non-bubbling resource error / restricted-script classification / plugin dedup / cleanup',
    )
  } finally {
    await errorContext.close()
  }
  await testWhiteScreen(browser, origin, requests)
  await testStutter(browser, origin, requests)
  await testHeartbeat(browser, origin, requests)
} catch (error) {
  for (const browserError of errors) console.error(browserError)
  throw error
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
