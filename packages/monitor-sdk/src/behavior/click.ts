import { createEventBase } from '../common/event'
import { safely } from '../common/safe'
import type { BehaviorEvent, MonitorPlugin } from '../types'

export interface ClickOptions {
  /** 默认不采集文本。开启后仅采集点击目标的短文本，不读取表单 value。 */
  captureText?: boolean
}

const ignored =
  '[data-monitor-ignore],.rr-block,.rr-ignore,[contenteditable]:not([contenteditable="false"]),input[type="password"]'

function elementPath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && parts.length < 5) {
    const tag = current.tagName.toLowerCase()
    let index = 1
    for (
      let sibling = current.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.tagName === current.tagName) index++
    }
    parts.unshift(`${tag}:nth-of-type(${index})`)
    current = current.parentElement
  }
  return parts.join(' > ')
}

export const clickPlugin = (options: ClickOptions = {}): MonitorPlugin => ({
  name: 'behavior:click',
  setup(ctx) {
    const captureText = options.captureText === true
    ctx.on(
      window,
      'click',
      (event) =>
        safely(() => {
          const target = event.target
          if (!(target instanceof Element)) return
          // 事件路径只用于排除敏感区域，不用于向上替换点击目标。
          if (event.composedPath().some((node) => node instanceof Element && node.matches(ignored)))
            return
          const monitorId = target.getAttribute('data-monitor-id')?.slice(0, 128)
          const data = {
            tagName: target.tagName,
            path: elementPath(target),
            monitorId,
            textContent:
              captureText && !target.querySelector(ignored)
                ? target.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120)
                : undefined,
          }
          const behaviorEvent: BehaviorEvent = {
            ...createEventBase(ctx),
            category: 'behavior',
            eventType: 'click',
            payload: { message: `click ${monitorId || target.tagName.toLowerCase()}`, data },
          }
          ctx.addBreadcrumb({
            category: 'click',
            timestamp: behaviorEvent.timestamp,
            message: behaviorEvent.payload.message,
            data,
          })
          ctx.report(behaviorEvent)
          ctx.events.emit('behavior:click', behaviorEvent)
        }),
      true,
    )
  },
})
