import type { Breadcrumb } from '../types'

export interface BehaviorStoreOptions {
  maxBreadcrumbs: number
}

export default class BehaviorStore {
  private state: Breadcrumb[] = []

  private maxBreadcrumbs: number

  constructor(options: BehaviorStoreOptions) {
    this.maxBreadcrumbs = Math.max(options.maxBreadcrumbs || 1, 1)
  }

  push(value: Breadcrumb): void {
    this.state.push(value)

    while (this.state.length > this.maxBreadcrumbs) {
      this.state.shift()
    }
  }

  get(): Breadcrumb[] {
    return this.state.slice()
  }

  clear(): void {
    this.state = []
  }
}
