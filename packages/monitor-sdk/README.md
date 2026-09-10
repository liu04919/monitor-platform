# Monitor SDK

浏览器事件采集 SDK。业务插件通过 `MonitorContext.report()` 提交事件，实例负责批次构建、持久化和发送。

## 目录

- `src/core`：实例、插件与生命周期。
- `src/transport`：批次、队列、IndexedDB 和 HTTP 发送。
- `src/error`、`performance`、`behavior`、`stability`、`aiPerformance`：采集插件。

## 实例与队列

每次 `createMonitor(options)` 创建独立的配置、事件缓存、发送器和定时器。配置创建后固定；更换项目或上报 Key 时销毁旧实例并创建新实例。未传入 `userId` 时，不填写虚构的默认用户。

```ts
const monitor = createMonitor({
  url: 'https://monitor.example.com/api/v1/events/batch',
  projectName: 'Website',
  appId: '项目 ID',
  publicKey: '项目 publicKey',
  plugins: [
    /* 选择需要的采集插件 */
  ],
  reportDrop(info) {
    // 可在本地统计丢弃原因，不要再次上报到同一个 SDK。
  },
})

await monitor.flush()
monitor.destroy()
```

`flush()` 封装当前缓存，并尝试发送当前已到重试时间的批次；它不等待未来的重试，也不代表队列已经全部投递成功。明确收到成功响应才调用 `reportSuccess`。页面隐藏时暂不启动正常 Fetch 消费。

`destroy()` 幂等地停止采集、定时器和在途监控请求，不影响业务请求；剩余批次尝试持久化，下一实例恢复。销毁后不再调用用户回调。页面强制终止时无法保证异步存储写入完成。

不再暴露全局 `initReportTransport()`、`flushOfflineQueue()` 或可改投递目标的 `Monitor.init()`；使用 `createMonitor()` 和实例 `flush()`。

## 投递语义

1. 入队时复制事件；封装批次后固定 `batchId`、`sentAt` 和事件内容。
2. 优先存入 IndexedDB，再用 Fetch 发送；同一实例的正常发送串行执行。
3. 只有 HTTP 成功响应才移除批次。浏览器明确离线时暂停正常发送，不消耗重试次数；其他网络错误、超时、408、429、5xx 指数退避重试。其他失败状态和耗尽重试次数的任务丢弃。
4. IndexedDB 不可用时使用有界内存队列，重试保留原批次；此时刷新或关闭页面可能丢失数据。

IndexedDB 按固定的上报 URL、项目 ID、publicKey 隔离。相同范围的多个标签页通过事务领取短租约，减少并发重传；租约不能替代服务端幂等，网络结果不确定时仍可能重发同一批次。

生命周期回调接收事件副本，仅用于通知；修改副本不会修改已封装的批次。同步抛错或异步拒绝都不会改变业务请求结果，也不会把成功投递误判为失败。

## 默认上限

可通过初始化时的 `transport` 覆盖这些参数：

| 参数               | 默认值  | 含义                                                   |
| ------------------ | ------- | ------------------------------------------------------ |
| `requestTimeoutMs` | 10 秒   | 单次 Fetch 超时后中止并进入失败处理                    |
| `maxBatchBytes`    | 256 KiB | 按完整请求的 UTF-8 字节数分批，硬上限 900 KiB          |
| `maxQueueTasks`    | 100     | 每个实例的待持久化队列、每个隔离范围的磁盘队列分别限制 |
| `maxQueueBytes`    | 5 MiB   | 上述两级队列分别限制序列化数据总大小                   |
| `maxQueueAgeMs`    | 24 小时 | 当前范围读写时惰性清理到期任务                         |
| `maxRetries`       | 5       | 初次发送以外允许的重试次数                             |

`batchSize` 默认 5，最多 100 条。未满批次约 1 秒封装。容量不足时拒绝新批次，单条超限事件直接丢弃，不无限增长、不擅自截断事件内容。`reportDrop` 通知非法事件、单条超限、队列满、内存任务到期、HTTP 拒绝、重试耗尽等原因；磁盘过期清理由存储层直接完成。

## 页面退出

每个实例每次隐藏周期最多尝试一个不超过 60 KiB 的当前批次：先 Beacon，不支持、返回 false 或抛错时使用 Fetch keepalive；较大的批次只尝试保存，恢复可见或下次启动后正常发送。Beacon 返回 true 仅代表浏览器接收任务，批次仍保留，随后用 Fetch 确认。

60 KiB 是 SDK 自己的保守预算，不是独占的浏览器额度。多个实例或其他 SDK 仍可能竞争浏览器共享的退出发送额度。[浏览器 sendBeacon 限制](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)。

本轮将本地 IndexedDB `reportQueue` 更新为版本 4，升级会删除该浏览器来源下旧的待发送队列，不转换旧记录；不影响服务端已接收数据。

这套路径覆盖通过 `ctx.report()` 提交的事件。`crashLoop` 的 Worker 断联检测仍有独立的直接发送路径；录屏也仍随事件携带，尚未升级为独立回放存储。

## 验证

在此目录执行：

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

浏览器回归测试使用独立本地 HTTP 接收端和临时浏览器上下文，不访问项目数据库：

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

Windows 已安装 Edge 时，在 IDE 的 **CMD 终端**中可以复用它，不额外下载 Chromium：

```cmd
set MONITOR_BROWSER_CHANNEL=msedge
pnpm test:browser
```

覆盖真实构建、多实例、业务 Fetch、IndexedDB 离线刷新恢复以及页面导航退出发送。单元测试另外覆盖超时、存储故障、回调异常、容量限制和前后台切换。
