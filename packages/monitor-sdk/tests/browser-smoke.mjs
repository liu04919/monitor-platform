import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { build } from 'tsup'

await build({
  entry: ['tests/browser-entry.ts'],
  format: ['esm'],
  outDir: 'dist/browser-tests',
  dts: false,
  clean: true,
  config: false,
  noExternal: [/.*/],
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
      response.writeHead(202).end()
    } else if (request.url === '/business') {
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('business body')
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
  assert.deepEqual(errors, [])
  await context.close()
} catch (error) {
  for (const browserError of errors) console.error(browserError)
  throw error
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
