import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const bundle = await build({
  entryPoints: ['tests/stream-metrics-entry.ts'],
  bundle: true,
  format: 'esm',
  write: false,
})
const requests = []
const errors = []
const openResponses = new Map()
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/collect') {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    response.writeHead(202).end()
  } else if (path === '/test.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].text)
  } else if (path === '/api/redirect') {
    response.writeHead(302, { Location: '/api/json' }).end()
  } else if (path === '/api/json') {
    response
      .writeHead(200, { 'Content-Type': 'application/json', 'X-Test': 'original' })
      .end('{"answer":"你好"}')
  } else if (path === '/api/empty') {
    response.writeHead(204).end()
  } else if (path === '/api/http-error') {
    response.writeHead(503).end('service unavailable')
  } else if (path.startsWith('/api/')) {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.flushHeaders()
    openResponses.set(path, response)
    response.on('close', () => {
      if (openResponses.get(path) === response) openResponses.delete(path)
    })
  } else {
    response
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end(
        '<!doctype html><title>Stream regression</title><script type="module" src="/test.js"></script>',
      )
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser

async function run(name, test) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error))
    await page.goto(origin)
    await page.waitForFunction(() => !!window.streamTest)
    await test(page)
    await page.evaluate(() => window.streamTest.destroy())
    console.log(`PASS: stream / ${name}`)
  } finally {
    await context.close()
  }
}

const events = (page) => page.evaluate(() => window.streamTest.events)
const waitCount = async (page, count) => {
  try {
    await page.waitForFunction(
      (expected) =>
        window.streamTest.events.length >= expected || window.streamTest.dropped.length > 0,
      count,
      { timeout: 5000 },
    )
    assert.equal(
      await page.evaluate(() => window.streamTest.dropped.length),
      0,
      JSON.stringify(await page.evaluate(() => window.streamTest.dropped)),
    )
  } catch (error) {
    console.error(
      'Stream delivery state',
      JSON.stringify(
        await page.evaluate(() => ({
          events: window.streamTest.events,
          dropped: window.streamTest.dropped,
        })),
      ),
    )
    throw error
  }
}
const metric = (list) =>
  list.find((event) => event.eventType === 'stream_metric').payload.attributes

try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.MONITOR_BROWSER_CHANNEL || undefined,
  })

  await run('redirect / json / clone / response metadata', async (page) => {
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/redirect')
      const clone = response.clone()
      const meta = [response, clone].map((value) => ({
        url: value.url,
        type: value.type,
        redirected: value.redirected,
        status: value.status,
        header: value.headers.get('X-Test'),
      }))
      return { meta, content: await Promise.all([response.json(), clone.text()]) }
    })
    assert.deepEqual(
      result.meta,
      Array(2).fill({
        url: `${origin}/api/json`,
        type: 'basic',
        redirected: true,
        status: 200,
        header: 'original',
      }),
    )
    assert.deepEqual(result.content, [{ answer: '你好' }, '{"answer":"你好"}'])
    await waitCount(page, 1)
    assert.equal((await events(page)).length, 1)
    const timings = metric(await events(page))
    assert.equal(timings.success, true)
    for (const key of ['ttfb', 'ttft', 'ttlt', 'ttlb']) {
      assert(Number.isFinite(timings[key]), `${key} must be a finite number`)
    }
    assert(timings.ttfb >= 0)
    assert(timings.ttft >= timings.ttfb)
    assert(timings.ttlt >= timings.ttft)
    assert(timings.ttlb >= timings.ttlt)
  })

  await run('empty body and HTTP failure', async (page) => {
    assert.deepEqual(
      await page.evaluate(async () => [
        await (await fetch('/api/empty')).text(),
        await (await fetch('/api/http-error')).text(),
      ]),
      ['', 'service unavailable'],
    )
    await waitCount(page, 2)
    const list = await events(page)
    const empty = list.find((event) => event.payload.attributes.status === 204).payload.attributes
    assert.equal(empty.chunkCount, 0)
    assert(!('ttft' in empty))
    const failure = list.find((event) => event.payload.attributes.status === 503).payload.attributes
    assert.equal(failure.success, false)
    assert.equal(failure.endReason, 'end')
  })

  await run('unread and paused consumer never reported as stalled', async (page) => {
    await page.evaluate(async () => {
      window.response = await fetch('/api/paused')
    })
    openResponses.get('/api/paused').write('first')
    await page.waitForTimeout(450)
    assert.deepEqual(await events(page), [])
    assert.equal(await page.evaluate(() => window.response.bodyUsed), false)
    await page.evaluate(async () => {
      window.reader = window.response.body.getReader()
      await window.reader.read()
    })
    openResponses.get('/api/paused').write('second')
    await page.waitForTimeout(450)
    assert.deepEqual(await events(page), [])
    openResponses.get('/api/paused').end('third')
    const rest = await page.evaluate(async () => {
      let text = ''
      const decoder = new TextDecoder()
      while (true) {
        const chunk = await window.reader.read()
        if (chunk.done) return text
        text += decoder.decode(chunk.value)
      }
    })
    assert.equal(rest, 'secondthird')
    await waitCount(page, 1)
    assert.equal(metric(await events(page)).totalBytes, 16)
    assert.equal((await events(page)).length, 1)
  })

  await run('one stall per pending read and resume', async (page) => {
    await page.evaluate(async () => {
      window.response = await fetch('/api/wait')
      window.result = window.response.text()
    })
    await waitCount(page, 1)
    await page.waitForTimeout(450)
    assert.equal((await events(page)).length, 1)
    assert.equal((await events(page))[0].eventType, 'stream_stall')
    openResponses.get('/api/wait').end('你好')
    assert.equal(await page.evaluate(() => window.result), '你好')
    await waitCount(page, 2)
    const list = await events(page)
    assert.equal(metric(list).totalBytes, 6)
    assert.equal(list[0].payload.attributes.traceId, list[1].payload.attributes.traceId)
  })

  for (const pending of [false, true]) {
    await run(`connection failure / pending read=${pending}`, async (page) => {
      await page.evaluate(async () => {
        window.response = await fetch('/api/broken')
        window.reader = window.response.body.getReader()
      })
      openResponses.get('/api/broken').write('first')
      await page.evaluate(() => window.reader.read())
      if (pending)
        await page.evaluate(() => {
          window.result = window.reader.read().catch((error) => error.name)
        })
      else openResponses.get('/api/broken').write('buffered')
      openResponses.get('/api/broken').destroy()
      await waitCount(page, 1)
      const list = await events(page)
      assert.equal(list.length, 1)
      assert.equal(metric(list).endReason, 'error')
      assert.equal(metric(list).chunkCount, 1)
      assert.equal(
        await page.evaluate(() => window.reader.read().catch((error) => error.name)),
        'TypeError',
      )
    })
  }

  await run('AbortController after headers with pending read', async (page) => {
    const originalName = await page.evaluate(async () => {
      const controller = new AbortController()
      const response = await window.streamTest.nativeFetch('/api/abort-original', {
        signal: controller.signal,
      })
      const result = response.text().catch((error) => error.name)
      controller.abort()
      return result
    })
    const name = await page.evaluate(async () => {
      const controller = new AbortController()
      const response = await fetch('/api/abort', { signal: controller.signal })
      const result = response.text().catch((error) => error.name)
      controller.abort()
      return result
    })
    assert.equal(name, originalName)
    await waitCount(page, 1)
    assert.equal(metric(await events(page)).endReason, 'cancel')
    await page.waitForTimeout(350)
    assert.equal((await events(page)).length, 1)
  })

  await run('reader.cancel propagates to HTTP request', async (page) => {
    await page.evaluate(async () => {
      const response = await fetch('/api/cancel')
      await response.body.cancel('stop')
    })
    await waitCount(page, 1)
    assert.equal(metric(await events(page)).endReason, 'cancel')
    await page.waitForTimeout(100)
    assert.equal(openResponses.has('/api/cancel'), false)
  })

  await run('destroy clears monitoring but keeps business stream alive', async (page) => {
    await page.evaluate(async () => {
      const response = await fetch('/api/destroy')
      window.result = response.text()
      window.streamTest.destroy()
    })
    await page.waitForTimeout(450)
    assert.deepEqual(await events(page), [])
    assert(openResponses.has('/api/destroy'))
    openResponses.get('/api/destroy').end('still working')
    assert.equal(await page.evaluate(() => window.result), 'still working')
    assert.deepEqual(await events(page), [])
  })

  assert.deepEqual(errors, [])
  assert(requests.length > 0)
  assert(requests.every((batch) => batch.schemaVersion === 2 && batch.sendType === 'fetch'))
  console.log(
    `PASS: ${requests.flatMap((batch) => batch.events).length} AI events delivered through real SDK HTTP batches`,
  )
} finally {
  await browser?.close()
  for (const response of openResponses.values()) response.destroy()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
