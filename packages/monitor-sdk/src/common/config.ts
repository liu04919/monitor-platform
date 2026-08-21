import { ConfigType } from '../types'

const config: ConfigType = {
  url: 'http://127.0.0.1:8080/api/v1/events/batch', // 上报地址
  projectName: '', // 项目名称，必须在初始化 SDK 时显式提供
  appId: '', // 项目 ID，必须在初始化 SDK 时显式提供
  publicKey: '', // 浏览器公开上报 Key，必须使用管理端创建项目后返回的值
  userId: '123456', // 用户id
  isAjax: false, // 是否开启ajax上报
  batchSize: 5, // 批量上报大小
  containerElements: ['html', 'body', '#app', '#root'], // 容器元素
  skeletonElements: [], // 骨架屏元素
}

export function setConfig(options: Partial<ConfigType> = {}) {
  Object.assign(config, options)
}

export function getConfig() {
  return config
}

// export function setConfig(options: Partial<ConfigType> = {}) {
//   Object.assign(config, options)
// }
