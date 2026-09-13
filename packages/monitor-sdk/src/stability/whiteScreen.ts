import { createEventBase } from '../common/event'
import type { MonitorContext, MonitorPlugin, StabilityEvent } from '../types'

export interface WhiteScreenOptions {
  /** 命中就算空白，只匹配元素自身。传入数组会替换默认名单。 */
  blankSelectors?: string[]
  /** 跳过匹配的元素及其后代，继续检查这个坐标下方的元素。 */
  ignoreSelectors?: string[]
  /** 空白点比例必须大于此值才算疑似白屏，默认 0.7，取值 [0, 1)。 */
  blankRatio?: number
  /** 两次检测的间隔，默认 2000 毫秒；疑似白屏后下一次检测即为复检。 */
  recheckIntervalMs?: number
}

const DEFAULT_BLANK_SELECTORS = ['html', 'body', '#root', '#app']
const TOTAL_POINTS = 33

function isBlankPoint(
  x: number,
  y: number,
  blankSelectors: string[],
  ignoreSelectors: string[],
): boolean {
  for (const element of document.elementsFromPoint(x, y)) {
    let ignored = false
    for (const selector of ignoreSelectors) {
      // 例如遮罩内的 loading 图标，也属于需要跳过的遮罩。
      if (element.closest(selector)) {
        ignored = true
        break
      }
    }
    if (ignored) continue

    for (const selector of blankSelectors) {
      // 这里不能用 closest，否则 #root 内的所有业务内容都会被算作空白。
      if (element.matches(selector)) return true
    }

    // 第一个未被忽略、也不在空白名单中的元素，视为正常内容。
    return false
  }

  // 没有命中元素，或命中的元素全部被忽略。
  return true
}

function countBlankPoints(blankSelectors: string[], ignoreSelectors: string[]): number {
  const width = window.innerWidth
  const height = window.innerHeight
  let blankPoints = 0

  // 横、竖、两条对角线各 9 点，中心只采一次：9 + 8 + 8 + 8 = 33。
  for (let i = 1; i <= 9; i++) {
    const x = (width * i) / 10
    const y = (height * i) / 10
    if (isBlankPoint(x, height / 2, blankSelectors, ignoreSelectors)) {
      blankPoints++
    }
    if (i === 5) continue
    if (isBlankPoint(width / 2, y, blankSelectors, ignoreSelectors)) {
      blankPoints++
    }
    if (isBlankPoint(x, y, blankSelectors, ignoreSelectors)) {
      blankPoints++
    }
    if (isBlankPoint(x, height - y, blankSelectors, ignoreSelectors)) {
      blankPoints++
    }
  }
  return blankPoints
}

function reportWhiteScreen(ctx: MonitorContext, recheckDelayMs: number, blankPoints: number): void {
  const event: StabilityEvent = {
    ...createEventBase(ctx),
    category: 'stability',
    eventType: 'white_screen',
    level: 'error',
    breadcrumbs: ctx.getBreadcrumbs(),
    replayData: ctx.getReplayData() || undefined,
    payload: {
      message: '页面白屏，两次采样确认',
      metrics: {
        recheckDelayMs: Math.round(recheckDelayMs),
        blankPoints,
        totalPoints: TOTAL_POINTS,
        blankRatio: blankPoints / TOTAL_POINTS,
      },
    },
  }
  ctx.report(event)
}

export function whiteScreenPlugin(options: WhiteScreenOptions = {}): MonitorPlugin {
  // 复制配置，避免调用方后续修改数组影响正在运行的检测。
  const blankSelectors = [...(options.blankSelectors ?? DEFAULT_BLANK_SELECTORS)]
  const ignoreSelectors = [...(options.ignoreSelectors ?? [])]
  const blankRatio = options.blankRatio ?? 0.7
  const recheckIntervalMs = options.recheckIntervalMs ?? 2000

  if (!Number.isFinite(blankRatio) || blankRatio < 0 || blankRatio >= 1) {
    throw new RangeError('whiteScreenPlugin: blankRatio 必须是大于等于 0 且小于 1 的有限数值')
  }
  if (!Number.isFinite(recheckIntervalMs) || recheckIntervalMs <= 0) {
    throw new RangeError('whiteScreenPlugin: recheckIntervalMs 必须是大于 0 的有限数值')
  }

  return {
    name: 'stability:white-screen',
    setup(ctx) {
      if (typeof document.elementsFromPoint !== 'function') return

      // 安装时检查选择器语法，避免错误配置在每次定时采样时反复抛错。
      for (const selector of [...blankSelectors, ...ignoreSelectors]) {
        document.documentElement.matches(selector)
      }

      let loaded = document.readyState === 'complete'
      let running = false
      let timer: number | null = null
      let firstBlankAt: number | null = null
      let reported = false

      function resetEpisode(): void {
        firstBlankAt = null
        reported = false
      }

      function check(): void {
        if (document.hidden || window.innerWidth <= 0 || window.innerHeight <= 0) {
          resetEpisode()
          return
        }

        const blankPoints = countBlankPoints(blankSelectors, ignoreSelectors)
        if (blankPoints / TOTAL_POINTS <= blankRatio) {
          resetEpisode()
          return
        }

        if (reported) return

        // 第一次超出比例只记为疑似白屏，等下一轮复检，不立即上报。
        if (firstBlankAt === null) {
          firstBlankAt = performance.now()
          return
        }

        // 第二次仍然超出比例才确认。复检正常时会在上面清空疑似状态。
        reported = true
        reportWhiteScreen(ctx, performance.now() - firstBlankAt, blankPoints)
      }

      function stop(): void {
        running = false
        if (timer !== null) {
          window.clearTimeout(timer)
          timer = null
        }
        resetEpisode()
      }

      function tick(): void {
        check()
        // 本次检测结束后再等待完整间隔。上报回调销毁实例时不再安排下一次。
        if (running) timer = window.setTimeout(tick, recheckIntervalMs)
      }

      function start(): void {
        if (!loaded || document.hidden || running) return
        running = true
        tick()
      }

      ctx.addDispose(stop)
      ctx.on(document, 'visibilitychange', () => {
        stop()
        start()
      })
      // 页面进入往返缓存时暂停，返回页面后重新计时。
      ctx.on(window, 'pagehide', stop)
      ctx.on(window, 'pageshow', start)
      if (!loaded) {
        ctx.on(
          window,
          'load',
          () => {
            loaded = true
            start()
          },
          { once: true },
        )
      }
      start()
    },
  }
}
