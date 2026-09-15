import { record } from 'rrweb'
import { encodeReplay } from './codec'

type RecordOptions = NonNullable<Parameters<typeof record>[0]>
type RecordedEvent = Parameters<NonNullable<RecordOptions['emit']>>[0]
interface RecordScope {
  scope: string
  eventList: RecordedEvent[]
}

// 按完整快照分段，错误发生时截取最近两段。
export class RecordScreen {
  public eventList: RecordScope[] = [{ scope: `${Date.now()}-`, eventList: [] }]

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

export function replaySnapshot(recorder: RecordScreen): string {
  return encodeReplay(recorder.eventList.slice(-2).flatMap((segment) => segment.eventList))
}
