import { createConfig } from '../common/config'
import { safely } from '../common/safe'
import { ReportTransport } from '../transport'
import { BreadcrumbStore } from '../breadcrumbs'
import type { BreadcrumbInput } from '../breadcrumbs'
import { createCustomEvent } from '../behavior/custom'
import {
  ConfigType,
  MonitorContext,
  MonitorDispose,
  MonitorEventHandler,
  MonitorPlugin,
} from '../types'

export class Monitor {
  private plugins = new Map<string, MonitorPlugin>()

  private disposers = new Map<string, MonitorDispose>()

  private capabilities = new Map<string, any>()

  private eventHandlers = new Map<string, Set<MonitorEventHandler>>()

  private readonly config: ConfigType
  private readonly transport: ReportTransport
  private readonly breadcrumbs: BreadcrumbStore
  private destroyed = false

  constructor(options?: Partial<ConfigType>) {
    this.config = createConfig(options)
    this.breadcrumbs = new BreadcrumbStore(this.config.breadcrumbs)
    this.transport = new ReportTransport(this.config)
    try {
      options?.plugins?.forEach((plugin) => {
        this.use(plugin)
      })
    } catch (error) {
      this.destroy()
      throw error
    }
  }

  use(plugin: MonitorPlugin | MonitorPlugin[]): this {
    if (this.destroyed) return this
    if (Array.isArray(plugin)) {
      plugin.forEach((item) => {
        this.use(item)
      })
      return this
    }

    if (this.plugins.has(plugin.name)) {
      return this
    }

    const missingDep = plugin.deps?.find((name) => !this.plugins.has(name))

    if (missingDep) {
      console.warn(`[monitor-sdk] plugin "${plugin.name}" depends on "${missingDep}"`)
    }

    this.plugins.set(plugin.name, plugin)

    const cleanups: MonitorDispose[] = []
    let disposed = false
    const disposeAll = (): void => {
      if (disposed) return
      disposed = true
      this.runCleanups(cleanups)
    }
    const context = this.createContext(cleanups, () => disposed)
    // 即使插件暂时没有清理函数，也保留作用域，以覆盖异步安装的监听器。
    this.disposers.set(plugin.name, disposeAll)

    try {
      const dispose = plugin.setup(context)

      if (typeof dispose === 'function') {
        context.addDispose(dispose)
      }
    } catch (error) {
      this.plugins.delete(plugin.name)
      this.disposers.delete(plugin.name)
      disposeAll()
      throw error
    }

    return this
  }

  getPlugin(name: string): MonitorPlugin | undefined {
    return this.plugins.get(name)
  }

  getCapability<T = any>(name: string): T | undefined {
    return this.capabilities.get(name)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.transport.destroy()
    Array.from(this.disposers.values())
      .reverse()
      .forEach((dispose) => {
        safely(dispose)
      })

    this.disposers.clear()
    this.plugins.clear()
    this.capabilities.clear()
    this.eventHandlers.clear()
    this.breadcrumbs.clear()
  }

  /** 自定义业务事件；需要错误上下文时，另行调用 addBreadcrumb。 */
  track(name: string, data?: Record<string, unknown>): void {
    if (this.destroyed) return
    safely(() => {
      const event = createCustomEvent(this.config, name, data)
      if (event) this.transport.report(event)
    })
  }

  addBreadcrumb(breadcrumb: BreadcrumbInput): void {
    if (!this.destroyed) this.breadcrumbs.add(breadcrumb)
  }

  flush(): Promise<void> {
    return this.transport.flush()
  }

  private runCleanups(cleanups: MonitorDispose[]): void {
    cleanups
      .slice()
      .reverse()
      .forEach((cleanup) => {
        safely(cleanup)
      })
  }

  private createContext(cleanups: MonitorDispose[], disposed: () => boolean): MonitorContext {
    const addDispose = (dispose: MonitorDispose): MonitorDispose => {
      if (this.destroyed || disposed()) {
        safely(dispose)
        return dispose
      }
      cleanups.push(dispose)
      return dispose
    }

    return {
      config: this.config,
      getConfig: () => this.config,
      report: (event) => {
        if (!disposed()) this.transport.report(event)
      },
      getPlugin: (name: string) => this.getPlugin(name),
      events: {
        on: (name, handler) => {
          const handlers = this.eventHandlers.get(name) || new Set<MonitorEventHandler>()
          handlers.add(handler as MonitorEventHandler)
          this.eventHandlers.set(name, handlers)

          return addDispose(() => {
            handlers.delete(handler as MonitorEventHandler)

            if (!handlers.size) {
              this.eventHandlers.delete(name)
            }
          })
        },
        off: (name, handler) => {
          const handlers = this.eventHandlers.get(name)
          handlers?.delete(handler as MonitorEventHandler)

          if (handlers && !handlers.size) {
            this.eventHandlers.delete(name)
          }
        },
        emit: (name, payload) => {
          const handlers = this.eventHandlers.get(name)

          handlers?.forEach((handler) => {
            safely(() => handler(payload))
          })
        },
      },
      provide: (name, value) => {
        this.capabilities.set(name, value)
      },
      consume: (name) => this.capabilities.get(name),
      addBreadcrumb: (breadcrumb) => {
        if (!disposed()) this.addBreadcrumb(breadcrumb)
      },
      getBreadcrumbs: () => this.breadcrumbs.snapshot(),
      getReplayData: () => {
        const getData = this.capabilities.get('replay:data') as (() => string) | undefined
        return getData?.() || ''
      },
      on: (target, type, listener, options) => {
        target.addEventListener(type, listener, options)
        return addDispose(() => {
          target.removeEventListener(type, listener, options)
        })
      },
      addDispose,
    }
  }
}

export function createMonitor(options?: Partial<ConfigType>): Monitor {
  return new Monitor(options)
}
