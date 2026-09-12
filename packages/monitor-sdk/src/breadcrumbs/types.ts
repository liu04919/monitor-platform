import type { Breadcrumb } from '../types/events'

export type BreadcrumbInput = Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }

export interface BreadcrumbOptions {
  /** 每个实例最多保留多少条轨迹，默认 25，最大 100；0 表示关闭。 */
  maxBreadcrumbs?: number
  /** 写入前同步过滤或脱敏；返回 null 丢弃，抛错也丢弃当前轨迹。 */
  beforeBreadcrumb?: (breadcrumb: Breadcrumb) => Breadcrumb | null
}
