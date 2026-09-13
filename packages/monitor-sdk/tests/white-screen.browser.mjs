import assert from 'node:assert/strict'

// 验证真实 CSS 布局、elementsFromPoint 命中栈，以及事件经过传输层到达接收端。
export async function testWhiteScreen(browser, origin, requests) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } })
  const errors = []
  try {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error))
    await page.goto(origin)
    await page.waitForFunction(() => window.sdk)
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = `
        html, body, #root, .content { width: 100%; height: 100%; margin: 0; }
        .mask, .skeleton { position: fixed; inset: 0; z-index: 10; background: #ddd; }
        .spinner { display: block; width: 100%; height: 100%; }
      `
      document.head.append(style)
    })

    const cases = [
      { id: 'root', html: '<div id="root"></div>', blank: true, defaultTiming: true },
      {
        id: 'content',
        html: '<div id="root"><main class="content">商品列表</main></div>',
        blank: false,
      },
      {
        // 顶部 250px 覆盖米字形上半部的 9 个点，剩下 24 个空白点。
        id: '24-blank-points',
        html: '<div id="root"><main style="height:250px">顶部正常内容</main></div>',
        blank: true,
        blankPoints: 24,
      },
      {
        // 再覆盖 (500, 320) 这个点，只剩 23 个空白点，不超过 70%。
        id: '23-blank-points',
        html: '<div id="root"><main style="height:250px">顶部正常内容</main><div style="position:absolute;left:499px;top:319px;width:2px;height:2px"></div></div>',
        blank: false,
      },
      {
        id: 'ignored-mask-with-content',
        html: '<div id="root"><main class="content">商品列表</main><div class="mask"><span class="spinner">加载中</span></div></div>',
        options: { ignoreSelectors: ['.mask'] },
        blank: false,
      },
      {
        id: 'ignored-mask-with-root',
        html: '<div id="root"><div class="mask"><span class="spinner">加载中</span></div></div>',
        options: { ignoreSelectors: ['.mask'] },
        blank: true,
      },
      {
        id: 'mask-not-configured',
        html: '<div id="root"><div class="mask"><span class="spinner">正常弹窗</span></div></div>',
        blank: false,
      },
      {
        id: 'skeleton-with-content',
        html: '<div id="root"><main class="content">商品列表</main><div class="skeleton"><span class="spinner">占位内容</span></div></div>',
        options: { blankSelectors: ['html', 'body', '#root', '.skeleton', '.skeleton *'] },
        blank: true,
      },
    ]

    for (const test of cases) {
      const stack = await page.evaluate(async (test) => {
        window.whiteScreenMonitor?.destroy()
        document.body.innerHTML = test.html
        window.whiteScreenEvents = []
        window.whiteScreenMonitor = window.sdk.createMonitor({
          url: `${location.origin}/collect-white-screen-${test.id}`,
          appId: test.id,
          projectName: test.id,
          publicKey: `key-${test.id}`,
          plugins: [
            window.sdk.whiteScreenPlugin({
              ...test.options,
              // root 用真实默认 2 秒，其他布局用例只缩短检测间隔。
              ...(test.defaultTiming ? {} : { recheckIntervalMs: 80 }),
            }),
          ],
          reportSuccess(events) {
            window.whiteScreenEvents.push(...events)
          },
        })
        window.whiteScreenMonitor.addBreadcrumb({ category: 'custom', message: test.id })
        await window.whiteScreenMonitor.flush()
        return document
          .elementsFromPoint(500, 400)
          .map((element) => element.className || element.id || element.tagName.toLowerCase())
      }, test)

      if (test.id === 'ignored-mask-with-content') {
        assert.deepEqual(stack, ['spinner', 'mask', 'content', 'root', 'body', 'html'])
      }
      await page.waitForTimeout(350)
      await page.evaluate(() => window.whiteScreenMonitor.flush())
      if (test.defaultTiming) {
        assert.equal(await page.evaluate(() => window.whiteScreenEvents.length), 0)
      }
      if (test.blank) {
        await page.waitForFunction(() => window.whiteScreenEvents.length === 1)
      }
      const events = requests
        .filter((request) => request.path === `/collect-white-screen-${test.id}`)
        .flatMap((request) => request.body.events)
      assert.equal(events.length, test.blank ? 1 : 0, test.id)
      if (test.blank) {
        assert.equal(events[0].eventType, 'white_screen')
        assert.equal(events[0].category, 'stability')
        assert.equal(events[0].breadcrumbs[0].message, test.id)
        assert(events[0].payload.metrics.recheckDelayMs >= (test.defaultTiming ? 2000 : 80))
        assert.equal(events[0].payload.metrics.blankPoints, test.blankPoints ?? 33)
        assert.equal(events[0].payload.metrics.totalPoints, 33)
        assert.equal(events[0].payload.metrics.blankRatio, (test.blankPoints ?? 33) / 33)
      }
    }

    // 不导航、不重装插件；只改变页面内容，验证同一实例能检测第二段白屏。
    await page.waitForTimeout(200)
    await page.evaluate(() => window.whiteScreenMonitor.flush())
    assert.equal(await page.evaluate(() => window.whiteScreenEvents.length), 1)
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="root"><main class="content">恢复正常</main></div>'
    })
    await page.waitForTimeout(200)
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="root"></div>'
    })
    await page.waitForFunction(() => window.whiteScreenEvents.length === 2)
    await page.evaluate(async () => {
      window.whiteScreenMonitor.destroy()
      window.dispatchEvent(new Event('pageshow'))
      await window.whiteScreenMonitor.flush()
    })
    await page.waitForTimeout(350)
    assert.equal(await page.evaluate(() => window.whiteScreenEvents.length), 2)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: white-screen / 33-point sampling / 23-vs-24 threshold / real 2-second recheck / overlays / skeleton / recovery / collector delivery / cleanup',
    )
  } finally {
    await context.close()
  }
}
