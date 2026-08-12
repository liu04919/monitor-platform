import { record } from 'rrweb'
import { createEventBase } from '../common/event'
import { getOriginInfo, getPageInfo, getPathToElement, zip } from '../common/utils'
import type { BehaviorEvent, MonitorContext, MonitorPlugin, RecordEventScope } from '../types'
import BehaviorStore from './behaviorStore'
import { HistoryChangeDetail, wrHistory } from './utils'

const BEHAVIOR_CAPABILITY = 'behavior:instance'
const RECORD_SCREEN_CAPABILITY = 'behavior:record-screen'
const ROUTE_CHANGE_EVENT = 'route:change'
const CLICK_EVENT = 'behavior:click'

export interface CustomEventInput {
  eventKey: string
  eventAction: string
  eventValue?: unknown
}

type CustomHandler = (data: CustomEventInput) => void

export type RouteChangeEvent = {
  from: string
  to: string
  jumpType: string
  timestamp: number
  pageUrl: string
  pageTime: number
}

export class Behavior {
  public metrics: any

  public breadcrumbs: BehaviorStore

  public customHandler!: CustomHandler

  public maxBehaviorRecords!: number

  public clickMountList!: Array<string>

  constructor(private ctx: MonitorContext) {
    this.maxBehaviorRecords = 25
    this.breadcrumbs = new BehaviorStore({
      maxBreadcrumbs: this.maxBehaviorRecords,
    })
    this.customHandler = this.initCustomerHandler()
    this.clickMountList = ['click'].map((x) => x.toLowerCase())
  }
  // 自定义埋点上报
  initCustomerHandler = (): CustomHandler => {
    return (data) => {
      const behaviorEvent: BehaviorEvent = {
        ...createEventBase(this.ctx),

        category: 'behavior',
        eventType: 'custom',

        payload: {
          message: `${data.eventAction}: ${data.eventKey}`,

          data: {
            eventKey: data.eventKey,
            eventAction: data.eventAction,
            eventValue: data.eventValue,
          },
        },
      }

      this.ctx.report(behaviorEvent)
    }
  }

  initRouteChange = (): void => {
    this.ctx.events.on<RouteChangeEvent>(ROUTE_CHANGE_EVENT, (route) => {
      const behaviorEvent: BehaviorEvent = {
        ...createEventBase(this.ctx),

        category: 'behavior',
        eventType: 'route_change',

        payload: {
          message: `${route.from} -> ${route.to}`,

          data: {
            from: route.from,
            to: route.to,
            jumpType: route.jumpType,
            pageTime: route.pageTime,
          },
        },
      }

      this.ctx.report(behaviorEvent)

      this.breadcrumbs.push({
        category: 'navigation',
        timestamp: behaviorEvent.timestamp,
        message: behaviorEvent.payload.message,
        data: behaviorEvent.payload.data,
      })
    })
  }

  initPV = (): void => {
    const handler = () => {
      const behaviorEvent: BehaviorEvent = {
        ...createEventBase(this.ctx),

        category: 'behavior',
        eventType: 'page_view',

        payload: {
          message: `view ${window.location.pathname}`,

          data: {
            pageInfo: getPageInfo(),
            originInfo: getOriginInfo(),
          },
        },
      }

      this.ctx.report(behaviorEvent)
    }

    this.ctx.events.on<RouteChangeEvent>(ROUTE_CHANGE_EVENT, handler)

    if (document.readyState === 'complete') {
      setTimeout(handler)
    } else {
      this.ctx.on(window, 'pageshow', handler, {
        once: true,
        capture: true,
      })
    }
  }

  initClickHandler = (mountList: Array<string>): void => {
    const handler = (e: MouseEvent | any) => {
      const target = e.target as HTMLElement

      if (!target) {
        return
      }

      const behaviorEvent: BehaviorEvent = {
        ...createEventBase(this.ctx),

        category: 'behavior',
        eventType: 'click',

        payload: {
          message: `click ${target.tagName.toLowerCase()}`,

          data: {
            tagName: target.tagName,
            path: getPathToElement(target),
            textContent: target.textContent,
          },
        },
      }

      this.ctx.report(behaviorEvent)

      this.breadcrumbs.push({
        category: 'click',
        timestamp: behaviorEvent.timestamp,
        message: behaviorEvent.payload.message,
        data: behaviorEvent.payload.data,
      })
      this.ctx.events.emit(CLICK_EVENT, behaviorEvent)
    }

    mountList.forEach((eventType) => {
      this.ctx.on(window, eventType, handler, true)
    })
  }

  initAll = (): void => {
    this.initRouteChange()
    this.initPV()
    this.initClickHandler(this.clickMountList)
  }
}

export class RecordScreen {
  public eventList: RecordEventScope[] = [{ scope: `${Date.now()}-`, eventList: [] }]

  public scopeScreenTime = 3000

  public screenCnt = 3

  private closeCallback?: ReturnType<typeof record>

  constructor() {
    this.init()
  }

  init = () => {
    this.closeCallback = record({
      emit: (event, isCheckout) => {
        if (isCheckout) {
          const lastEvents = this.eventList[this.eventList.length - 1]

          if (lastEvents) {
            lastEvents.scope = lastEvents.scope + Date.now()
          }

          if (this.eventList.length >= this.screenCnt) {
            this.eventList.shift()
          }

          this.eventList.push({ scope: `${Date.now()}-`, eventList: [] })
        }

        const currentEvents = this.eventList[this.eventList.length - 1]
        currentEvents.eventList.push(event)
      },
      recordCanvas: true,
      checkoutEveryNms: this.scopeScreenTime,
    })
  }

  close() {
    this.closeCallback?.()
    this.closeCallback = undefined
  }
}

function getOrCreateBehavior(ctx: MonitorContext): Behavior {
  let behavior = ctx.consume<Behavior>(BEHAVIOR_CAPABILITY)

  if (!behavior) {
    behavior = new Behavior(ctx)
    ctx.provide(BEHAVIOR_CAPABILITY, behavior)
    ctx.provide('behavior:state', () => behavior?.breadcrumbs.get() || [])
  }

  return behavior
}

function getRecordScreenData(recordScreen: RecordScreen | undefined): string {
  const eventList = recordScreen?.eventList.slice(-2) || []
  const data = eventList.reduce(
    (pre, cur) => {
      return [...pre, ...cur.eventList]
    },
    [] as RecordEventScope['eventList'],
  )

  return zip(data)
}

export const routePlugin = (): MonitorPlugin => ({
  name: 'route',
  setup: (ctx) => {
    const disposeHistory = wrHistory()
    ctx.addDispose(disposeHistory)

    let currentUrl = window.location.href
    let oldDate = Date.now()

    const handler = (e: Event) => {
      const event = e as CustomEvent<HistoryChangeDetail>
      const from = event.detail?.from || currentUrl
      const to = event.detail?.to || window.location.href
      const timestamp = Date.now()
      const pageTime = timestamp - oldDate

      ctx.events.emit<RouteChangeEvent>(ROUTE_CHANGE_EVENT, {
        from,
        to,
        jumpType: e.type,
        timestamp,
        pageUrl: to,
        pageTime,
      })

      currentUrl = to
      oldDate = timestamp
    }

    ctx.on(window, 'popstate', handler, true)
    ctx.on(window, 'replaceState', handler, true)
    ctx.on(window, 'pushState', handler, true)
  },
})

export const breadcrumbPlugin = (): MonitorPlugin => ({
  name: 'behavior:breadcrumb',
  setup: (ctx) => {
    getOrCreateBehavior(ctx)
  },
})

export const routerChangePlugin = (): MonitorPlugin => ({
  name: 'behavior:router-change',
  deps: ['route'],
  setup: (ctx) => {
    getOrCreateBehavior(ctx).initRouteChange()
  },
})

export const pvPlugin = (): MonitorPlugin => ({
  name: 'behavior:pv',
  deps: ['route'],
  setup: (ctx) => {
    getOrCreateBehavior(ctx).initPV()
  },
})

export const clickPlugin = (): MonitorPlugin => ({
  name: 'behavior:click',
  setup: (ctx) => {
    const behavior = getOrCreateBehavior(ctx)
    behavior.initClickHandler(behavior.clickMountList)
  },
})

export const recordScreenPlugin = (): MonitorPlugin => ({
  name: 'behavior:record-screen',
  setup: (ctx) => {
    const recordScreen = new RecordScreen()

    ctx.provide(RECORD_SCREEN_CAPABILITY, recordScreen)
    ctx.provide('behavior:record-screen-data', () => getRecordScreenData(recordScreen))

    return () => {
      recordScreen.close()
    }
  },
})

export const behaviorPlugins = (): MonitorPlugin[] => [
  routePlugin(),
  breadcrumbPlugin(),
  routerChangePlugin(),
  pvPlugin(),
  clickPlugin(),
  recordScreenPlugin(),
]
