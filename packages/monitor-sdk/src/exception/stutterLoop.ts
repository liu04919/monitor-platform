import { createEventBase } from '../common/event'
import { MonitorContext, StabilityEvent } from '../types'

const MIN_FPS = 24
const REPORT_INTERVAL = 3000
const STAT_INTERVAL = 1000

export default function stutterLoop(ctx: MonitorContext): void {
  let lastFrameTime = performance.now()
  let lastReportTime = 0
  let frameCount = 0
  let isRunning = true

  const resetFPSCounter = (): void => {
    frameCount = 0
    lastFrameTime = performance.now()
  }

  const reportStutter = (fps: number): void => {
    const replayData = ctx.getRecordScreenData()

    const reportData: StabilityEvent = {
      ...createEventBase(ctx),

      category: 'stability',
      eventType: 'stutter',
      level: 'warning',

      breadcrumbs: ctx.getBehaviorState(),
      replayData: replayData || undefined,

      payload: {
        message: `页面 FPS 下降到 ${fps}`,

        metrics: {
          fps,
        },
      },
    }

    lastReportTime = performance.now()
    ctx.report(reportData)
  }

  const trackFPS = (timestamp: number): void => {
    if (!isRunning) {
      return
    }

    if (document.hidden) {
      resetFPSCounter()
      requestAnimationFrame(trackFPS)
      return
    }

    frameCount++

    const delta = timestamp - lastFrameTime

    if (delta >= STAT_INTERVAL) {
      const fps = Math.round((frameCount * 1000) / delta)
      const canReport = fps <= MIN_FPS && performance.now() - lastReportTime > REPORT_INTERVAL

      if (canReport) {
        reportStutter(fps)
      }

      frameCount = 0
      lastFrameTime = timestamp
    }

    requestAnimationFrame(trackFPS)
  }

  resetFPSCounter()
  requestAnimationFrame(trackFPS)
  ctx.on(document, 'visibilitychange', resetFPSCounter)
  ctx.addDispose(() => {
    isRunning = false
  })
}
