import { createEventBase } from '../common/event'
import { MonitorContext, StabilityEvent } from '../types'

const WHITE_SCREEN_TIME = 6000
const CHECK_INTERVAL = 2000
const SAMPLE_POINTS = 17

function isEmptyElement(
  element: Element,
  containerElements: string[],
  skeletonElements: string[],
): boolean {
  return (
    containerElements.some((selector) => element.matches(selector)) ||
    skeletonElements.some((selector) => element.matches(selector))
  )
}

function getTopElementFromPoint(x: number, y: number): Element | null {
  const elements = document.elementsFromPoint(x, y)
  return elements[0] || null
}

function getEmptyPointCount(ctx: MonitorContext): number {
  const { containerElements, skeletonElements } = ctx.getConfig()
  let emptyPoints = 0

  for (let i = 1; i <= 9; i++) {
    const x = (window.innerWidth * i) / 10
    const y = (window.innerHeight * i) / 10

    const horizontalElement = getTopElementFromPoint(x, window.innerHeight / 2)

    if (
      horizontalElement &&
      isEmptyElement(horizontalElement, containerElements, skeletonElements)
    ) {
      emptyPoints++
    }

    if (i !== 5) {
      const verticalElement = getTopElementFromPoint(window.innerWidth / 2, y)

      if (verticalElement && isEmptyElement(verticalElement, containerElements, skeletonElements)) {
        emptyPoints++
      }
    }
  }

  return emptyPoints
}

function reportWhiteScreen(ctx: MonitorContext): void {
  const replayData = ctx.getRecordScreenData()

  const reportData: StabilityEvent = {
    ...createEventBase(ctx),

    category: 'stability',
    eventType: 'white_screen',
    level: 'error',

    breadcrumbs: ctx.getBehaviorState(),
    replayData: replayData || undefined,

    payload: {
      message: '页面持续白屏超过 6 秒',
    },
  }

  ctx.report(reportData)
}

export default function whiteScreenLoop(ctx: MonitorContext): void {
  let whiteStartTime = Date.now()
  let whiteLoopTimer: number | null = null

  const stopWhiteScreenLoop = (): void => {
    if (whiteLoopTimer !== null) {
      clearInterval(whiteLoopTimer)
      whiteLoopTimer = null
    }
  }

  const checkWhiteScreen = (): void => {
    const emptyPoints = getEmptyPointCount(ctx)

    if (emptyPoints !== SAMPLE_POINTS) {
      whiteStartTime = Date.now()
      return
    }

    const duration = Date.now() - whiteStartTime

    if (duration >= WHITE_SCREEN_TIME) {
      reportWhiteScreen(ctx)
      stopWhiteScreenLoop()
    }
  }

  const start = () => {
    checkWhiteScreen()

    whiteLoopTimer = window.setInterval(() => {
      checkWhiteScreen()
    }, CHECK_INTERVAL)
  }

  if (document.readyState === 'complete') {
    start()
  } else {
    ctx.on(window, 'load', start, {
      once: true,
      capture: true,
    })
  }

  ctx.addDispose(stopWhiteScreenLoop)
}
