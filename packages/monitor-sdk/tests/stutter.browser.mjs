import assert from 'node:assert/strict'

// 使用生产 SDK、真实 LoAF / Long Tasks / rAF 和真实 HTTP 接收端，不伪造慢帧条目。
export async function testStutter(browser, origin, requests) {
  const context = await browser.newContext()
  const errors = []
  try {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error))
    await page.goto(origin)
    await page.waitForFunction(() => window.sdk)
    assert(
      await page.evaluate(() =>
        PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'),
      ),
      '卡顿浏览器回归必须运行在支持 LoAF 的 Chrome / Edge，不能跳过后声称通过',
    )
    await page.evaluate(() => {
      document.body.innerHTML =
        '<button id="block">Block main thread</button><p id="result">ready</p>'
      window.nativeFrames = []
      window.nativeFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.nativeFrames.push({ startTime: entry.startTime, duration: entry.duration })
      })
      window.nativeFrameObserver.observe({ type: 'long-animation-frame' })
      document.querySelector('#block').onclick = function blockMainThread() {
        const started = performance.now()
        while (performance.now() - started < 220) {
          /* 有界阻塞，随后恢复执行。 */
        }
        document.querySelector('#result').textContent = `updated at ${started}`
      }
      window.startStutter = (id, includeRafGap = true) => {
        window.stutterMonitor?.destroy()
        window.stutterEvents = []
        window.stutterMonitor = window.sdk.createMonitor({
          url: `${location.origin}/collect-stutter-${id}`,
          appId: id,
          projectName: id,
          publicKey: `key-${id}`,
          batchSize: 1,
          plugins: [
            window.sdk.stutterPlugin({
              durationThresholdMs: 180,
              reportIntervalMs: 1000,
              includeRafGap,
            }),
          ],
          reportSuccess(events) {
            window.stutterEvents.push(...events)
          },
        })
        window.stutterMonitor.addBreadcrumb({ category: 'custom', message: `before-${id}` })
      }
    })
    // 让页面布局先稳定，再安装 SDK；避免把加载阶段噪声当成测试结果。
    await page.waitForTimeout(250)
    await page.evaluate(() => window.startStutter('native'))
    await page.waitForTimeout(100)
    await page.click('#block')
    await page.waitForFunction(() => window.stutterEvents.length > 0)
    const result = await page.evaluate(() => ({
      events: window.stutterEvents,
      native: window.nativeFrames,
    }))
    assert.equal(result.events.length, 1)
    const event = result.events[0]
    assert.equal(event.eventType, 'stutter')
    assert.equal(event.category, 'stability')
    assert.equal(event.payload.diagnostics.source, 'long-animation-frame')
    assert(event.payload.metrics.duration >= 220)
    assert(
      result.native.some(
        (frame) =>
          frame.startTime === event.payload.metrics.startTime &&
          frame.duration === event.payload.metrics.duration,
      ),
    )
    assert(event.payload.diagnostics.longTasks.count >= 1)
    assert(event.payload.diagnostics.longTasks.maxDuration >= 220)
    assert(event.payload.diagnostics.rafGap.duration >= 180)
    assert(event.payload.diagnostics.scripts.length > 0)
    assert(event.payload.diagnostics.scripts.length <= 5)
    assert.equal(event.breadcrumbs[0].message, 'before-native')
    assert.equal(event.payload.metrics.fps, undefined)
    assert(!JSON.stringify(event).includes('"window"'))
    const nativeRequests = requests.filter((request) => request.path === '/collect-stutter-native')
    assert.equal(nativeRequests.flatMap((request) => request.body.events).length, 1)
    assert.equal(nativeRequests[0].body.sendType, 'fetch')

    // 恢复后能报告下一次独立慢帧；不是首次上报后永久停止。
    await page.waitForTimeout(1100)
    await page.click('#block')
    await page.waitForFunction(() => window.stutterEvents.length === 2)
    await page.evaluate(() => {
      window.stutterMonitor.destroy()
      window.nativeFrameObserver.disconnect()
    })
    await page.click('#block')
    await page.waitForTimeout(350)
    assert.equal(await page.evaluate(() => window.stutterEvents.length), 2)
    console.log(
      'PASS: native LoAF trigger / matching Long Task+rAF evidence / script diagnostics / one HTTP event / rearm / destroy',
    )

    // 明确关闭 rAF 旁证仍保留原生 LoAF；后台/BFCache 边界另由可控单元测试验证。
    await page.evaluate(() => window.startStutter('without-raf', false))
    await page.waitForTimeout(100)
    await page.click('#block')
    await page.waitForFunction(() => window.stutterEvents.length > 0)
    const withoutRaf = await page.evaluate(() => window.stutterEvents[0])
    assert.equal(withoutRaf.payload.diagnostics.rafGap, undefined)
    assert(withoutRaf.payload.metrics.duration >= 220)
    assert(withoutRaf.payload.diagnostics.longTasks.count >= 1)
    await page.evaluate(() => window.stutterMonitor.destroy())
    assert.deepEqual(errors, [])
    console.log('PASS: native LoAF continues with rAF collection disabled')
  } finally {
    await context.close()
  }
}
