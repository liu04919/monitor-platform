import { getConfig, setConfig } from '../common/config'
import { initReportTransport, lazyReportBatch } from '../common/report'
import {
  Breadcrumb,
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

  private reportTransportDispose?: MonitorDispose

  constructor(options?: Partial<ConfigType>) {
    this.init(options)
  }

  init(options?: Partial<ConfigType>): this {
    setConfig(options)

    if (!this.reportTransportDispose) {
      this.reportTransportDispose = initReportTransport()
    }

    options?.plugins?.forEach((plugin) => {
      this.use(plugin)
    })

    return this
  }

  use(plugin: MonitorPlugin | MonitorPlugin[]): this {
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

    try {
      const dispose = plugin.setup(this.createContext(cleanups))

      if (typeof dispose === 'function') {
        cleanups.push(dispose)
      }

      if (cleanups.length) {
        this.disposers.set(plugin.name, () => {
          this.runCleanups(cleanups)
        })
      }
    } catch (error) {
      this.plugins.delete(plugin.name)
      this.runCleanups(cleanups)
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
    Array.from(this.disposers.values())
      .reverse()
      .forEach((dispose) => {
        dispose()
      })

    this.disposers.clear()
    this.plugins.clear()
    this.capabilities.clear()
    this.eventHandlers.clear()

    this.reportTransportDispose?.()
    this.reportTransportDispose = undefined
  }

  private runCleanups(cleanups: MonitorDispose[]): void {
    cleanups
      .slice()
      .reverse()
      .forEach((cleanup) => {
        cleanup()
      })
  }

  private createContext(cleanups: MonitorDispose[]): MonitorContext {
    const addDispose = (dispose: MonitorDispose): MonitorDispose => {
      cleanups.push(dispose)
      return dispose
    }

    return {
      config: getConfig(),
      getConfig,
      report: lazyReportBatch,
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
            handler(payload)
          })
        },
      },
      provide: (name, value) => {
        this.capabilities.set(name, value)
      },
      consume: (name) => this.capabilities.get(name),
      getBehaviorState: () => {
        const getState = this.capabilities.get('behavior:state') as (() => Breadcrumb[]) | undefined
        return getState?.() || []
      },
      getRecordScreenData: () => {
        const getData = this.capabilities.get('behavior:record-screen-data') as
          | (() => string)
          | undefined
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
