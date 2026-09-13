import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

export async function testHeartbeat(browser, origin, requests) {
  const context = await browser.newContext()
  const errors = []
  try {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error))
    const received = (id) =>
      requests.filter((request) => request.path === `/collect-heartbeat-${id}`)
    const waitFor = async (check, timeout = 20000) => {
      const deadline = Date.now() + timeout
      while (!check()) {
        if (Date.now() >= deadline) throw new Error('heartbeat browser check timed out')
        await delay(50)
      }
    }

    async function start(id, options = {}, transport = {}, replay = 'heartbeat-replay') {
      await page.goto(origin)
      await page.waitForFunction(() => window.sdk)
      await page.evaluate(
        ({ id, options, transport, replay }) => {
          window.heartbeatDrops = []
          window.heartbeatSuccess = []
          window.heartbeatFailures = 0
          window.heartbeatMonitor = window.sdk.createMonitor({
            url: `${location.origin}/collect-heartbeat-${id}`,
            appId: id,
            projectName: id,
            publicKey: `pk-${id}`,
            transport,
            reportDrop: (info) => window.heartbeatDrops.push(info),
            reportSuccess: (events) => window.heartbeatSuccess.push(...events),
            reportFail: () => {
              window.heartbeatFailures++
            },
            plugins: [
              {
                name: 'fixture:replay',
                setup(ctx) {
                  ctx.provide('replay:data', () => replay)
                },
              },
              window.sdk.crashPlugin(options),
            ],
          })
          window.heartbeatMonitor.addBreadcrumb({ category: 'custom', message: 'before hang' })
        },
        { id, options, transport, replay },
      )
      // 等 Worker 启动并交换第一轮心跳、快照后再阻塞主线程。
      await page.waitForTimeout(350)
    }

    function hang(ms) {
      return page.evaluate((duration) => {
        const until = performance.now() + duration
        while (performance.now() < until) {
          /* 有界阻塞，仅用于测试页面。 */
        }
      }, ms)
    }

    // 默认参数也必须在真实 Worker 中跑一遍，不能只靠缩短时间的模拟测试。
    await start('default')
    let recovered = false
    const blocked = hang(22000).finally(() => {
      recovered = true
    })
    await waitFor(() => received('default').length === 1, 25000)
    assert.equal(recovered, false, '请求必须在主线程恢复之前到达，证明由 Worker 独立发送')
    const event = received('default')[0].body.events[0]
    assert.equal(event.eventType, 'crash')
    assert.equal(event.payload.metrics.timeout, 15000)
    assert(event.payload.metrics.unresponsiveDuration >= 15000)
    assert.equal(event.replayData, 'heartbeat-replay')
    assert.equal(event.breadcrumbs[0].message, 'before hang')
    await blocked
    await page.waitForFunction(() => window.heartbeatSuccess.length === 1)
    await page.evaluate(() => window.heartbeatMonitor.destroy())
    console.log(
      'PASS: real production Worker / default 5s-15s watchdog / delivery while main thread blocked',
    )

    const fast = { intervalMs: 100, timeoutMs: 500, snapshotIntervalMs: 200 }
    await start('retry', fast, { requestTimeoutMs: 300, maxRetries: 2 })
    const retryBlock = hang(2400)
    await waitFor(() => received('retry').length >= 2)
    assert.deepEqual(received('retry')[1].body, received('retry')[0].body)
    await retryBlock
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => window.heartbeatFailures), 1)
    assert.equal(await page.evaluate(() => window.heartbeatSuccess.length), 1)
    assert.equal(received('retry').length, 2, '同一次异常只生成一个事件，失败重试沿用批次')
    await hang(1000)
    await waitFor(() => received('retry').length === 3)
    assert.notEqual(
      received('retry')[2].body.events[0].eventId,
      received('retry')[0].body.events[0].eventId,
    )
    await page.evaluate(() => window.heartbeatMonitor.destroy())
    console.log('PASS: real HTTP 500 retry / stable batch / recovery / next hang')

    await start('offline', fast)
    await context.setOffline(true)
    await hang(1200)
    const stored = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('monitor-sdk')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            const read = db.transaction('reportQueue').objectStore('reportQueue').getAll()
            read.onsuccess = () => {
              db.close()
              resolve(read.result.filter((task) => task.url.endsWith('/collect-heartbeat-offline')))
            }
            read.onerror = () => {
              db.close()
              reject(read.error)
            }
          }
        }),
    )
    assert.equal(stored.length, 1)
    assert.equal(received('offline').length, 0)
    // 旧页面和 Worker 都退出，再由新实例恢复同一持久队列。
    await page.goto('about:blank')
    await context.setOffline(false)
    await start('offline', fast)
    await waitFor(() => received('offline').length === 1)
    assert.equal(received('offline')[0].body.batchId, stored[0].id)
    await page.evaluate(() => window.heartbeatMonitor.destroy())
    console.log(
      'PASS: real Worker IndexedDB / offline hang / page exit / reload delivery with same batchId',
    )

    await start('oversized-replay', fast, { maxBatchBytes: 4096 }, 'x'.repeat(100000))
    await hang(1000)
    await waitFor(() => received('oversized-replay').length === 1)
    const small = received('oversized-replay')[0].body
    assert(!small.events[0].replayData)
    assert.equal(small.events[0].breadcrumbs[0].message, 'before hang')
    assert(Buffer.byteLength(JSON.stringify(small)) <= 4096)

    // 使用真实 Worker，但显式派发缓存生命周期；不冒充真实 BFCache 命中验证。
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await page.waitForTimeout(350)
    await hang(1000)
    await waitFor(() => received('oversized-replay').length === 2)
    await page.evaluate(() => window.heartbeatMonitor.destroy())
    await hang(1000)
    assert.equal(received('oversized-replay').length, 2)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: bounded replay snapshot / simulated BFCache lifecycle with real Worker / destroy cleanup',
    )
  } finally {
    await context.close()
  }
}
