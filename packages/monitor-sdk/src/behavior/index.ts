import { clickPlugin } from './click'
import { navigationPlugin } from './navigation'
import { pvPlugin } from './pageView'
import type { MonitorPlugin } from '../types'

export { clickPlugin, navigationPlugin, pvPlugin }
export type { ClickOptions } from './click'

// 录屏独立选择；breadcrumb 是 Monitor 自带能力，无需再安装一个空插件。
export const behaviorPlugins = (): MonitorPlugin[] => [
  navigationPlugin(),
  pvPlugin(),
  clickPlugin(),
]
