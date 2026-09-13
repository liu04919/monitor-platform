# Monitor SDK

浏览器事件采集 SDK。业务插件通过 `MonitorContext.report()` 提交事件，实例负责批次构建、持久化和发送。

## 目录

- `src/core`：实例、插件与生命周期。
- `src/transport`：批次、队列、IndexedDB 和 HTTP 发送。
- `src/error`、`performance`、`behavior`、`stability`、`aiPerformance`：采集插件。
- `src/breadcrumbs`：实例级诊断轨迹、过滤与有界快照。
- `src/replay`：单独启用的 rrweb 录屏。

## 错误采集

错误采集只提供三个插件，按运行环境组合使用：

| 插件                  | 捕获范围                                                                        |
| --------------------- | ------------------------------------------------------------------------------- |
| `jsErrorPlugin()`     | 浏览器 JS 异常、未处理的 Promise 拒绝、资源加载失败、信息受限的 `Script error.` |
| `reactErrorPlugin()`  | React 错误边界捕获的组件异常及组件栈                                            |
| `vueErrorPlugin(app)` | Vue 应用错误处理器捕获的异常及组件信息                                          |

React 项目使用 `plugins: [jsErrorPlugin(), reactErrorPlugin()]`；Vue 项目使用 `plugins: [jsErrorPlugin(), vueErrorPlugin(app)]`。均从 `minitor-sdk/plugins` 导入，实例不会自动安装这些插件。

React 插件安装后，通过 `monitor.getCapability('error:react-boundary')` 取得错误边界组件，并用它包裹需要保护的组件树，传入 `Fallback` 组件。注册插件本身不会自动包裹应用。错误边界不替代浏览器基础错误采集；普通事件回调和异步任务中的未捕获异常仍需 JS 插件。

`src/error` 中每个插件各自负责监听和事件分类；`shared.ts` 只共用异常整理和诊断字段。未知拒绝原因会转换成字符串，非 Error 值不生成虚假的 SDK 调用栈。事件类型仍区分 `js_error`、`unhandled_rejection`、`resource_error`、`cors_error`、`react_error` 和 `vue_error`。

同一 Monitor 按插件名称去重，销毁时移除浏览器监听器并恢复仍由 SDK 接管的 Vue 错误处理器。需要录屏时另行安装 `recordScreenPlugin()`，错误上报时读取当前实例的录屏和 breadcrumbs 快照。

## React 渲染统计

`reactProfilerPlugin()` 通过 React 的 `<Profiler>` 收集被包裹子树的渲染耗时，产生 `performance / react_render`。安装插件不会自动包裹应用；应在模块初始化时取得包装组件，不要在组件渲染中反复创建 Monitor 或包装组件。

```tsx
import type { ComponentType } from 'react'
import { createMonitor } from 'minitor-sdk'
import { reactProfilerPlugin, REACT_PROFILER_CAPABILITY } from 'minitor-sdk/plugins'
import type { MonitorProfilerProps } from 'minitor-sdk/plugins'

const monitor = createMonitor({
  url: 'https://monitor.example.com/api/v1/events/batch',
  projectName: 'Website',
  appId: '项目 ID',
  publicKey: '项目 publicKey',
  plugins: [
    reactProfilerPlugin({
      reportIntervalMs: 1000,
      maxCommitCount: 20,
      slowRenderThresholdMs: 16,
    }),
  ],
})
const MonitorProfiler = monitor.getCapability<ComponentType<MonitorProfilerProps>>(
  REACT_PROFILER_CAPABILITY,
)!

// 在业务 JSX 中：<MonitorProfiler id="editor"><Editor /></MonitorProfiler>
```

- `reportIntervalMs` 默认 1000ms，从某个 ID 本轮第一次回调起计时；后续更新不延后计时器。必须大于 0 且不超过 2147483647，主线程忙时实际回调可能推迟。
- `maxCommitCount` 默认 20，某个 ID 达到该次数就提前汇总并取消计时器；必须为正安全整数。
- `slowRenderThresholdMs` 默认 16ms，`actualDuration` 达到门槛就累计一次慢渲染；非负有限数字，0 表示全部计入。这是采集阈值，不代表确认页面卡顿。
- 参数在创建插件时复制并校验。每个 Monitor 独立累计；一次汇总后删除该 ID 的统计，下一次真实回调再开窗，不保留闲置 ID。
- `payload.value` 是窗口内 `actualDuration` 之和；`attributes` 保留 `commitCount`、三个阶段的次数、`actualDurationMax`、`baseDurationMax` 和 `slowRenderCount`。`windowStart` 是首个回调提供的渲染开始时间，`windowEnd` 是汇总时刻，二者均使用 performance 时间轴，不是 Unix 时间戳。
- `actualDuration` 是被包裹子树的渲染耗时，不是 DOM 提交耗时；`baseDuration` 是不考虑渲染优化时的子树耗时估计。一个 ID 应对应一个稳定的 UI 区域；同名实例会合并计数，嵌套 Profiler 的耗时有重叠，不能跨 ID 相加当成整页耗时。
- 销毁只停止回调、清理计时器并丢弃尚未汇总的统计。`monitor.flush()` 只刷新已经进入传输队列的事件，不会强制生成 Profiler 报表；本插件不保证退出前最后一个窗口被保留。

**普通 React 生产构建默认不触发 Profiler 回调。** 需要采集时，应用应明确选择启用 profiling 的生产构建，并接受额外开销；SDK 本身无法替应用开启。当前 Demo 使用普通构建，开发模式可以验证，普通 `build` 后没有这类事件是预期。参见 [React Profiler 官方说明](https://react.dev/reference/react/Profiler)。

独立回归命令 `pnpm test:browser:react` 会在临时浏览器上下文中检查开发、普通生产、profiling 生产三种构建和真实 HTTP 上报；不修改 Demo 构建配置，也不连接项目数据库。

## 白屏检测

白屏规则配置在插件上，不放在 `createMonitor()` 顶层：

```ts
import { whiteScreenPlugin } from 'minitor-sdk/plugins'

// 放进 createMonitor({ plugins: [...] })。
whiteScreenPlugin({
  blankSelectors: ['html', 'body', '#root', '#app', '.skeleton', '.skeleton *'],
  ignoreSelectors: ['.monitor-overlay'],
  blankRatio: 0.7,
  recheckIntervalMs: 2000,
})
```

- `blankSelectors`：命中元素自身就将该点判为空白，不继续向下找。默认 `['html', 'body', '#root', '#app']`，自定义数组替换默认值。骨架屏及其内部占位元素可分别写 `.skeleton` 和 `.skeleton *`。不能通过祖先匹配这份名单，否则 `#root` 中的正常内容也会被判为空白。
- `ignoreSelectors`：跳过匹配的元素及其 DOM 后代，继续检查该坐标下方的元素。默认为空数组，不自动忽略弹窗或遮罩；这份配置用于明确需要穿透的覆盖层。
- 每个点按 `elementsFromPoint()` 返回的视觉叠放顺序检查：忽略规则优先，其次是空白规则；遇到其他元素就算非空白。没有命中元素或所有元素都被跳过时算空白。
- `blankRatio`：空白点比例门槛，默认 `0.7`，必须严格大于才算疑似白屏。33 点中 23 点为空白不满足，24 点才满足；取值范围为 `[0, 1)`。
- `recheckIntervalMs`：两次检测的间隔，默认 `2000` 毫秒。首检满足比例后不立即上报，下一轮仍满足才确认；复检不满足则取消疑似状态。每轮检测结束后再安排下一轮。
- 参数在创建插件时复制，每个 Monitor 独立维护检测状态。检测间隔必须是大于 0 的有限数值，比例也必须是有限数值；非法选择器会在安装插件时抛错。不支持 `elementsFromPoint()` 的环境不启动检测。

组合安装时，将同一份配置交给 `whiteScreen` 字段即可，不要再额外安装一个同名白屏插件：

```ts
import { stabilityPlugins } from 'minitor-sdk/plugins'

stabilityPlugins({
  whiteScreen: {
    blankSelectors: ['html', 'body', '#root'],
    ignoreSelectors: [],
  },
})
```

检测使用米字形 33 点：横、竖、两条对角线各 9 点，共用中心点，`9 + 8 + 8 + 8 = 33`。默认采用空白点比例大于 70%、间隔 2 秒两次满足才上报的规则，参考 [腾讯云 Aegis 白屏检测说明](https://cloud.tencent.com/document/product/248/87193)，不是行业统一标准。

这里仅采用其采样与复检规则，触发方式仍为页面 `load` 后立即检测并定时巡检，没有加入错误触发或 DOM 变化观察器。等待加载的时间不计入复检间隔；隐藏或 `pagehide` 时暂停并清空疑似状态，恢复可见或 `pageshow` 后重新首检。零尺寸视口不参与判定。

同一段异常只报一次，但检测不会停止；某次采样恢复到比例门槛以内后，可以检测并上报下一段异常。事件仍是 `stability / white_screen`，附带 breadcrumbs、已启用的录屏快照，以及 `payload.metrics` 中的 `recheckDelayMs`（首检到复检的实际间隔，使用单调时钟）、`blankPoints`、`totalPoints`、`blankRatio`（复检时的实际空白点比例）。不再使用持续 6 秒的判定规则。

这是基于 DOM 命中和业务名单的启发式检测，不是截图像素检测。两次采样之间的短暂变化可能被漏过；忽略遮罩后判断的是下方页面是否有内容，不能用来发现遮罩本身一直不消失。当前不检查 iframe 或 Shadow DOM 内部内容。

## 卡顿检测

`stutterPlugin()` 位于 `src/stability/stutter/`，只由 LoAF 触发 `stability / stutter`。Long Tasks 和 rAF gap 提前采集，作为同一时间段的旁证附带，不独立上报；不再计算平均 FPS。AI 流式分片的 `stream_stall` 不属于这类页面卡顿，仍留在 AI 插件。

```ts
import { stutterPlugin } from 'minitor-sdk/plugins'

stutterPlugin({
  durationThresholdMs: 120,
  reportIntervalMs: 3000,
  includeRafGap: true,
})
// 组合安装：stabilityPlugins({ stutter: { durationThresholdMs: 120 } })。
```

- `durationThresholdMs`：LoAF 的 `duration` 上报门槛，默认 120ms，必须为至少 50 的有限数字。LoAF API 只提供超过约 50ms 的慢帧；本项目的告警门槛不是行业标准。
- `reportIntervalMs`：按 LoAF 开始时间控制最小上报间隔，默认 3000ms，0 表示不限频。不能用回调抵达时间让晚到的旧帧绕过限频。
- `includeRafGap`：默认 true；关闭后不运行 rAF 采集循环，仍使用 LoAF 和可用的 Long Tasks。观察 rAF 仅记录至少 50ms 的间隔，不计算平均 FPS，也不把回调间隔当成真实屏幕掉帧数。开启时仍有每帧回调的采集开销。
- 每个实例分别缓存最多 100 条 Long Task、100 条 rAF gap；只保留两个数字，写入和关联时清理结束时间早于 10 秒前的样本。缓存是旁证，不是完整性能轨迹。
- LoAF 达到门槛后等待 200ms，让其他 Observer / rAF 回调有机会到达。窗口内只保留最慢的一帧，只维护一个待报项和计时器；最后按时间区间相交寻找旁证，统一读取一次录屏和 breadcrumbs。没有旁证仍可上报，迟于窗口的旁证不另发补报。200ms 是计划等待时间，主线程再次阻塞时实际执行会延迟。
- `payload.metrics` 保存慢帧耗时、阻塞耗时、渲染起点等原生数值；`payload.diagnostics` 保存 LoAF 来源、最多 5 个最耗时脚本入口、可选长任务数量/最大耗时、可选最大 rAF 间隔。URL 脱敏，函数名限制 120 字符；不携带原生条目的 window 等对象。不同指标不能相加，时间相交不保证相同根因。
- 插件创建时复制并校验参数。不支持 LoAF 或订阅失败时不启动辅助监听，不自动换成旧告警。Long Tasks 不可用时仅缺少该项旁证。
- 只观察安装后且完整位于本次可见周期的帧和任务，不读取历史 buffered 条目。隐藏、`pagehide`、`freeze` 会取消待报项、清空缓存并停止所有监听；恢复时重新建立时间基准，防止后台长间隔被误报。销毁后不再恢复。

事件顶层 `timestamp` 是 LoAF 开始时刻，关联字段 `startTime` 使用 performance 单调时间轴；页面 URL 在选中帧时保存，附件在等待结束后读取，可能略晚于慢帧发生时。两者都只能在主线程恢复执行后处理，不能替代独立 Worker 的心跳检测。

LoAF 描述主线程慢帧，不保证涵盖所有 GPU / 合成线程卡顿；它的脚本位置是入口，不保证指向最耗时的内部函数。参考 [Chrome LoAF 文档](https://developer.chrome.com/docs/web-platform/long-animation-frames)。

源码分工：`index.ts` 负责监听、等待窗口和生命周期；`evidence.ts` 负责有界样本及时间关联；`report.ts` 负责脚本字段整理与事件构造；`types.ts` 负责配置和类型。

## 主线程心跳检测

`crashPlugin()` 使用独立 Worker 检查主线程是否回复。它检测的是主线程长时间无响应，不保证发现进程退出、浏览器崩溃或系统杀进程；事件类型为 `stability / crash`。

```ts
import { crashPlugin } from 'minitor-sdk/plugins'

crashPlugin({
  intervalMs: 5000,
  timeoutMs: 15000,
  snapshotIntervalMs: 10000,
})
// 组合安装时使用 stabilityPlugins({ heartbeat: { timeoutMs: 20000 } })。
```

- Worker 每 5 秒发送带序号的 ping，主线程立即回复对应 pong。每轮检查距离上次有效回复是否达到 15 秒，因此判定有最多约一个心跳间隔的检查延迟；这里的时长不是精确测量的死循环持续时间。超时必须大于心跳间隔，这些默认值不是行业统一标准。
- 同一次无响应只生成一个事件，上报后心跳继续运行；有效回复到达后，可以报告下一次异常。发送失败的重试沿用原批次，不生成新的事件。
- 隐藏时暂停检测；恢复可见后重新计时。`pagehide` / `freeze` 终止 Worker，`pageshow` / `resume` 重新创建。SDK 销毁后不再恢复。
- 如果 Worker 自己也长时间没有运行，先发新心跳重新探测，不直接把这段停顿计入主线程无响应。这只能减少休眠、调试和调度暂停造成的误判，不能精确识别它们的原因。
- 初始快照通过独立任务生成，之后默认每 10 秒更新一次。心跳回复不读取录屏；快照任务仍可能执行同步压缩，并不是把录屏处理搬进了 Worker。快照超过半个批次预算时先省略录屏，再省略 breadcrumbs，不截断压缩数据。`snapshotAgeMs` 表示 Worker 持有这份快照多久，它可能早于卡住时刻。
- Worker 直接复用 `ReportTransport`：批次大小限制、IndexedDB 队列、请求超时、HTTP 状态检查、有限重试都与普通事件一致；网络错误、408、429、5xx 可重试，413 等其他 4xx 终止该批次。主线程与 Worker 通过同一套队列租约协调，不维护第二份离线队列。
- Worker 初始化只接收可序列化配置，不复制业务函数。Worker 消费任务时，通过消息把已配置的发送回调和 `reportDrop` 通知交回主线程执行；主线程卡住时，回调会延迟到恢复后。主线程恢复或重新打开页面后，也可能消费已持久化的任务。
- 持久化仍是尽力而为：IndexedDB 不可用时退回有界内存队列；页面或进程终止前尚未完成的写入不保证保留。

源码位于 `src/stability/heartbeat/`：`index.ts` 管主线程及页面生命周期，`watchdog.ts` 管心跳计时，`worker.ts` 管 Worker 入口与上报，`types.ts` 定义选项和线程消息。构建时将 Worker TypeScript 及其依赖打包为独立脚本再内嵌，应用无需配置额外 Worker 文件。使用 CSP 的站点需要允许该 Blob Worker（`worker-src`），Worker 上报也需要满足 `connect-src` 和服务端 CORS；创建或运行失败时只停止本插件，不中断业务初始化。

## 行为与诊断轨迹

```ts
import { createMonitor } from 'minitor-sdk'
import { behaviorPlugins, performancePlugins, recordScreenPlugin } from 'minitor-sdk/plugins'

const monitor = createMonitor({
  url: 'https://monitor.example.com/api/v1/events/batch',
  projectName: 'Website',
  appId: '项目 ID',
  publicKey: '项目 publicKey',
  plugins: [
    ...behaviorPlugins(),
    ...performancePlugins(),
    // 需要录屏才显式添加；不包含在 behaviorPlugins() 中。
    recordScreenPlugin(),
  ],
  breadcrumbs: {
    maxBreadcrumbs: 25,
    beforeBreadcrumb(breadcrumb) {
      // 同步返回修改后的轨迹，返回 null 丢弃。这里可增加业务专用脱敏。
      return breadcrumb
    },
  },
})

// 写入错误上下文，但不产生独立事件。
monitor.addBreadcrumb({ category: 'custom', message: '开始生成', data: { model: 'demo' } })
// 独立业务事件，不自动再写一条 breadcrumb。
monitor.track('generation_started', { model: 'demo' })
```

- `behaviorPlugins()` 组合 `navigationPlugin()`、`pvPlugin()`、`clickPlugin()`。初次访问产生一个 PV，后续按去掉查询参数后的路径与 hash 判断变化；仅修改 state/query 不增加 PV，重复的 popstate/hashchange 通知只处理一次。`elapsedMs` 是两次有效导航之间的经过时间，不是前台有效浏览时长。
- `history.ts` 包装 History 方法，成功执行后向 `window` 派发小写的 `pushstate` / `replacestate` 自定义事件，不附带 state 或调用参数。`navigation.ts` 和监听原生 `popstate`、`hashchange` 一样监听它们。多个实例共享包装，最后一个实例销毁时恢复；不会覆盖其他库后来安装的包装。
- 点击直接采集 `event.target` 对应元素的标签、路径及该元素自身的 `data-monitor-id`，不向上替换为按钮，也不限制交互元素白名单，普通 div 同样采集。Shadow DOM 场景保留 window 监听器实际收到的 target，不从事件路径中改选内部节点。默认不读文本或表单 value；使用单独的 `clickPlugin({ captureText: true })` 替换默认 click 插件后，最多采集 120 字符。`data-monitor-ignore`、`.rr-block`、`.rr-ignore`、密码输入框和可编辑区域仍被忽略，事件路径仅用于检查这些排除区域。不要同时安装两个同名 click 插件。
- Fetch/XHR 插件会复用请求完成结果写入 `http` breadcrumb，不依赖行为插件，不重复包装网络 API。摘要只有方法、脱敏 URL、状态码与耗时；自身上报端点被排除。请求尚未完成时不会提前生成完成摘要。
- `track()` 和 `addBreadcrumb()` 是实例方法，不需要通过 `getCapability('behavior:instance')` 调用内部类；旧 Behavior 类、breadcrumbPlugin、routePlugin/routerChangePlugin 入口已移除，不保留兼容路径。
- breadcrumb 默认最多 25 条，配置上限 100 条；单条最多 2 KiB、总计最多 32 KiB，单条超限丢弃，数量/总量超限淘汰最旧记录。`maxBreadcrumbs: 0` 关闭轨迹。输入和读取结果都与内部快照隔离，实例销毁时清空。
- 自定义数据限制嵌套深度、字段数与字符串长度，并过滤常见凭据字段。URL 去掉凭据与查询参数；hash 路由保留路径，带键值的 token fragment 移除。任意业务文本、路径段不可能自动判断是否敏感，业务仍需避免传入个人信息，或使用 `beforeBreadcrumb` 做领域脱敏。

以上是行为事件和 breadcrumb 的采集边界，不代表所有插件都完成了隐私治理：原有 HTTP 性能事件仍可能包含 params，录屏有独立的数据采集规则。不要将这两个数据面与轻量 HTTP breadcrumb 混为一谈。

## AI 流式响应

```ts
import { aiStreamPlugin } from 'minitor-sdk/plugins'

const monitor = createMonitor({
  // 项目和上报配置略。
  plugins: [aiStreamPlugin({
    urlPatterns: ['/api/chat'],
    stallThreshold: 2000,
    getMeta: () => ({ model: 'demo' }),
  })],
})
```

`urlPatterns` 只接受字符串数组，URL 包含其中任意字符串就采集，区分大小写，默认 `['/api/chat']`；空数组不采集。配置创建时复制，不受外部数组后续修改影响。自身上报端点按 origin + pathname 排除，查询参数不影响排除。`getMeta` 应保持轻量、同步；抛错或误返回异步拒绝不会阻断业务请求。

实现集中在 `aiPerformance/stream/`，三个文件共同实现一个 `aiStreamPlugin`：

- `index.ts`：插件入口，处理配置、请求匹配和 Fetch 安装 / 销毁；请求信息准备与业务 Fetch 流程分开。
- `body.ts`：外层 `ReadableStream` 按需读取原始 reader，再通过 `TransformStream` 统计并原样透传。`sourceReader` 读取原始响应，`transformWriter` / `transformReader` 分别写入 / 读取 Transform。两者同时启动，避免背压死锁；没有 clone 分支或自动读完整段响应的循环。
- `measurement.ts`：统计、等待计时与事件构建，不保存回答正文。只用于此插件的小函数放在各自文件，不再单独散落在外层 `utils.ts`。

外层 `highWaterMark` 为 0，只有消费方请求下一块时才读取上游。`stream_stall` 从本次原始 `reader.read()` 开始计时，达到门槛上报一次；同一次等待不重复上报，收到结果后清理计时器，下一次读取重新计时。未开始消费、暂停处理上一块、等待响应头都不计作流分片停顿。默认门槛 2000ms，必须为大于 0 且不超过 2147483647 的有限数字。

`stream_metric` 在读到 EOF、原始流报错、主动取消或 Fetch 失败时汇总一次，`endReason` 为 `end` / `error` / `cancel`；HTTP 非 2xx 即使读完正文，`success` 仍是 false。通过原始 reader 的 `closed` 观察错误，业务暂停读取时也能收尾。只停止读取但未取消的流不会被主动耗尽，也不会伪造完成事件。`destroy()` 清理监控计时器并停止报告，不取消业务请求。

指标沿用 TTFB / TTFT / TTLT / TTLB 命名，单位为毫秒。以浏览器响应和分片时刻近似测量，不解析 SSE 或模型协议：

| attributes 字段 | 含义 |
| --- | --- |
| `ttfb` | 请求开始到 Fetch 返回 Response 的耗时，近似首字节耗时。 |
| `ttft` / `ttlt` | 请求开始到 Transform 观察到首块 / 尾块的耗时，近似首 token / 尾 token 耗时。分片不等于 token，首块也可能只有元信息。 |
| `ttlb` | 请求开始到本次流观测结束的耗时，也是最终事件的 `payload.value`。正常结束表示读取完成；取消或报错时表示截至中断的耗时，结合 `endReason` 判断。 |
| `chunkCount` / `totalBytes` | 观察到的块数和字节总量，不保存块内容。 |
| `averageChunkInterval` / `maxChunkInterval` | Transform 观察到的相邻块间隔，可能包含业务消费暂停。少于两块时省略。 |

不存在的响应头、首块和尾块时刻及耗时省略，不填 0。原始 `requestStart`、`responseStart`、`firstChunkTime`、`lastChunkTime`、`streamEndTime` 以及停顿事件的 `waitStart` 使用本页面 `performance.now()` 毫秒时间轴，不能与事件 `timestamp` 的 Unix 毫秒直接相减。浏览器缓冲、主线程调度和业务消费速度都会影响观测，不能仅凭这些数值判定模型或服务端卡顿。

匹配成功的有正文响应会返回新的 Response 实例，保留 `status`、`statusText`、headers 内容、`url`、`type`、`redirected` 与普通 `clone()` 的元信息；不保证对象身份、额外自定义属性或底层字节流 BYOB 能力相同。消费方法保留原始流错误，包括 Chromium 中重建响应后可能被改写的 `AbortError`；JSON 解析失败、重复消费及锁冲突仍保留原生错误。204 / 205 / 304、不可见状态、已使用或锁定的响应不重建。业务主动 clone 仍具有原生分流的缓冲和提前拉取特性，此时按它实际发起的 read 计时，不会因此重复采集同一条流。

页面和请求 URL 去除凭据及查询参数；`getMeta` 复制为有界 JSON，并过滤常见敏感字段。不要传入提示词、回答正文或个人信息；任意文本和 URL 路径中的敏感内容不能靠通用过滤完整识别。

单独验证流式采集可运行 `pnpm test:browser:stream`，使用真实浏览器、原生 Fetch / Streams 和独立 HTTP 接收端，不访问项目数据库。

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

`flush()` 封装当前传输缓存，并尝试发送当前已到重试时间的批次；不催促尚未提交事件的采集器（例如 Profiler 的统计窗口）。它不等待未来的重试，也不代表队列已经全部投递成功。明确收到成功响应才调用 `reportSuccess`。页面隐藏时暂不启动正常 Fetch 消费。

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

这套传输实现同时用于 `ctx.report()` 和心跳 Worker。录屏仍随事件携带，尚未升级为独立回放存储。

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

覆盖真实构建、多实例、业务 Fetch、IndexedDB 离线刷新恢复、页面导航退出发送、原生错误采集和白屏采样。白屏用例使用真实 CSS 布局检查 23/33 与 24/33 比例边界、默认 2 秒复检、遮罩后代、骨架屏、内容恢复及上报；其他布局用例将检测间隔缩短至 80 毫秒。受控时钟单元测试另验证完整采样坐标、复检取消、前后台生命周期和配置边界。
