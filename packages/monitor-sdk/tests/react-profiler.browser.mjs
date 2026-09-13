import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// 三种 React 构建均使用真实 SDK 产物和独立 HTTP 接收端，不连接 Go 或项目数据库。
const bundles = new Map()
for (const mode of ['development', 'production', 'profiling']) {
  const result = await build({
    entryPoints: ['tests/react-profiler-entry.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    minify: mode !== 'development',
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
    },
    alias: mode === 'profiling' ? { 'react-dom/client': 'react-dom/profiling' } : {},
  })
  bundles.set(mode, result.outputFiles[0].text)
}

const requests = []
const errors = []
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path.startsWith('/collect/') && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push({ mode: path.slice('/collect/'.length), body: JSON.parse(body) })
      response.writeHead(202).end()
      return
    }
    const mode = path.slice(1).replace(/\.js$/, '')
    const bundle = bundles.get(mode)
    if (!bundle) {
      response.writeHead(404).end()
      return
    }
    if (path.endsWith('.js')) {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle)
    } else {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><title>React Profiler regression</title><div id="root"></div><script type="module" src="/${mode}.js"></script>`,
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
  for (const mode of bundles.keys()) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error))
      await page.goto(`${origin}/${mode}`)
      await page.waitForSelector('#counter')
      const canProfile = mode !== 'production'
      if (canProfile) {
        await page.waitForFunction(() => window.profilerTest.events.length === 1)
        const first = await page.evaluate(() => window.profilerTest.events[0])
        assert.equal(first.category, 'performance')
        assert.equal(first.eventType, 'react_render')
        assert.equal(first.payload.attributes.mountCount, 1)
        assert.equal(first.payload.attributes.commitCount, 1)
      } else {
        await page.waitForTimeout(300)
      }

      await page.click('#counter')
      await page.click('#counter')
      await page.click('#counter')
      assert.equal(await page.textContent('#counter'), '3')
      if (canProfile) {
        // 不要求浏览器自动化的三次点击落在同一个 120ms 窗口内。
        await page.waitForFunction(
          () =>
            window.profilerTest.events.reduce(
              (sum, event) => sum + event.payload.attributes.updateCount,
              0,
            ) === 3,
        )
        const events = await page.evaluate(() => window.profilerTest.events)
        assert.equal(
          events.reduce((sum, event) => sum + event.payload.attributes.commitCount, 0),
          4,
        )
        for (const event of events) {
          const attrs = event.payload.attributes
          assert.equal(attrs.slowRenderCount, attrs.commitCount)
          assert(attrs.windowEnd >= attrs.windowStart)
          assert(Number.isFinite(event.payload.value))
          assert(event.payload.value >= 0)
          assert(!('slowCommitCount' in attrs))
          assert(!('commitPerSecond' in attrs))
        }
        const received = requests.filter((request) => request.mode === mode)
        assert.deepEqual(
          received.flatMap((request) => request.body.events),
          events,
        )
        assert(received.every((request) => request.body.sendType === 'fetch'))
      } else {
        await page.waitForTimeout(300)
        assert.equal(await page.evaluate(() => window.profilerTest.events.length), 0)
        assert.equal(requests.filter((request) => request.mode === mode).length, 0)
      }

      const count = await page.evaluate(() => window.profilerTest.events.length)
      await page.evaluate(() => window.profilerTest.destroy())
      await page.click('#counter')
      assert.equal(await page.textContent('#counter'), '4')
      await page.waitForTimeout(300)
      assert.equal(await page.evaluate(() => window.profilerTest.events.length), count)
      await page.evaluate(() => window.profilerTest.unmount())
      console.log(
        `PASS: React ${mode} / real state updates / ${canProfile ? 'Profiler metrics over HTTP' : 'no profiling callbacks'} / destroy`,
      )
    } finally {
      await context.close()
    }
  }
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
