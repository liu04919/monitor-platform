import type { ConfigType } from '../types'

export function createConfig(options: Partial<ConfigType> = {}): ConfigType {
  const config: ConfigType = {
    url: 'http://127.0.0.1:8080/api/v1/events/batch', // 上报地址
    projectName: '', // 项目名称，必须在初始化 SDK 时显式提供
    appId: '', // 项目 ID，必须在初始化 SDK 时显式提供
    publicKey: '', // 浏览器公开上报 Key，必须使用管理端创建项目后返回的值
    userId: '', // 未提供业务用户时，不伪造用户身份
    isAjax: false, // 是否开启ajax上报
    batchSize: 5, // 批量上报大小
    ...options,
  }
  config.transport = { ...config.transport }
  config.breadcrumbs = Object.freeze({ ...config.breadcrumbs })
  if (typeof window !== 'undefined') {
    config.url = new URL(config.url, window.location.href).href
  }
  Object.freeze(config.transport)
  // 实例创建后固定投递目标，已入队的批次不能被配置更新改投到其他项目。
  return Object.freeze(config)
}
