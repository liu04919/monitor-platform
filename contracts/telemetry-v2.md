# Telemetry ingestion contract v2

本文档定义浏览器 Monitor SDK 与 Go 接收服务之间的上报协议。它描述的是当前仓库已经使用的 v2 数据结构，而不是未来功能清单。

对应实现：

- SDK 批次结构：`packages/monitor-sdk/src/common/report-db.ts`
- SDK 序列化与重试：`packages/monitor-sdk/src/common/report.ts`
- SDK 事件联合类型：`packages/monitor-sdk/src/types/events.ts`
- SDK 稳定性插件：`packages/monitor-sdk/src/stability/`
- 可执行测试样例：`contracts/examples/*-batch-v2.json`

## 1. HTTP 接口

```http
POST /api/v1/events/batch
Content-Type: application/json | text/plain;charset=UTF-8
```

请求体最大为 1 MiB，一个批次必须包含 1 到 100 个事件。请求体始终是 UTF-8 JSON：
Fetch 使用 `application/json`；跨源 `sendBeacon` 使用 CORS 简单请求允许的 `text/plain`，
避免页面退出时因等待预检而丢失真正的 POST。

使用 `app.id` 识别项目，并使用独立的 `publicKey` 判断浏览器 SDK 是否可以向该项目上报。`publicKey` 会暴露在浏览器中，不是服务端秘密，也不能用于项目管理接口。

## 2. 批次结构

```json
{
  "schemaVersion": 2,
  "batchId": "018f8c78-4fb1-7cb1-a319-06ea417bbb61",
  "sentAt": 1717243200456,
  "publicKey": "pk_monitor_web_demo",
  "app": {
    "id": "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7",
    "name": "Monitor Web"
  },
  "events": [],
  "sendType": "fetch"
}
```

| 字段 | 类型 | 必填 | 约束与含义 |
| --- | --- | --- | --- |
| `schemaVersion` | number | 是 | 当前只能为 `2`。表示整个传输批次的协议版本。 |
| `batchId` | string | 是 | 本批次的幂等键，非空且不超过 128 个字符。它是 opaque ID，服务端不能假定它一定是 UUID。 |
| `sentAt` | number | 是 | SDK 创建批次时的 Unix 毫秒时间戳，必须是非负整数。 |
| `publicKey` | string | 是 | 浏览器公开上报 Key，非空且不超过 128 个字符。它必须与 `app.id` 对应，但不是可保密的管理端凭证。 |
| `app.id` | string | 是 | 项目的稳定标识，非空且不超过 128 个字符。 |
| `app.name` | string | 是 | 便于诊断的项目名称，非空且不超过 128 个字符。项目正式名称以后以服务端业务数据为准。 |
| `events` | array | 是 | 1 到 100 个监控事件。整个批次成功校验或整体拒绝，不做部分接收。 |
| `sendType` | string | 是 | 只能为 `fetch` 或 `beacon`，表示 SDK 本次使用的传输方式。它不改变事件语义。 |

`schemaVersion` 在批次和单个事件中都会出现。批次版本描述 envelope，事件版本描述事件结构；v2 中两者都必须为 `2`。

普通 fetch、页面退出时的 beacon 和 Crash Worker 直接 fetch 都把 `publicKey` 放在同一个 JSON 批次中，不依赖自定义 HTTP Header。接收 Handler 实现后，服务端必须校验 `(app.id, publicKey)` 是否对应一个允许上报的项目；未知、禁用或不匹配的 Key 必须拒绝，不能仅凭 `app.id` 接收数据。

由于浏览器使用者可以查看 `publicKey`，它的作用是项目级接入控制、禁用和轮换，而不是证明请求来自可信后端。公开部署后仍需结合请求大小限制、项目级限流和可选的来源域名限制控制滥用。

## 3. 公共事件结构

所有事件都包含以下字段：

| 字段 | 类型 | 必填 | 约束与含义 |
| --- | --- | --- | --- |
| `schemaVersion` | number | 是 | 当前只能为 `2`。 |
| `eventId` | string | 是 | 单个事件的幂等标识，非空且不超过 128 个字符。它同样是 opaque ID。 |
| `category` | string | 是 | `error`、`performance`、`behavior`、`stability` 或 `ai`。 |
| `eventType` | string | 是 | category 下的具体事件类型，见第 4 节。 |
| `timestamp` | number | 是 | 事件发生时的 Unix 毫秒时间戳，必须是非负整数。 |
| `pageUrl` | string | 是 | 事件发生页面的完整 URL，最大 4096 个字符；无页面环境时允许为空字符串。 |
| `userId` | string | 否 | SDK 使用方提供的用户标识，最大 128 个字符；不能在此放姓名、手机号等不必要的敏感信息。 |
| `payload` | object | 是 | 由 `category + eventType` 决定的事件数据。 |

错误和稳定性事件还可以包含：

| 字段 | 类型 | 必填 | 约束与含义 |
| --- | --- | --- | --- |
| `level` | string | 是 | `error` 或 `warning`。 |
| `breadcrumbs` | array | 是 | 错误发生前的有限操作轨迹，没有数据时传空数组。 |
| `replayData` | string | 否 | rrweb 事件数组 → UTF-8 JSON → gzip → Base64，仅一层 Base64。它可能较大，也属于潜在敏感数据，必须受请求大小和数据保留策略约束。 |

服务端必须保留完整 `payload`，第一版不要求把每一种 payload 都拆成数据库列。服务端仍需校验公共字段以及已知事件类型所要求的最小字段，不能把任意 JSON 当作合法事件直接入库。

## 4. category 与 eventType

| category | 允许的 eventType |
| --- | --- |
| `error` | `js_error`、`unhandled_rejection`、`cors_error`、`react_error`、`vue_error`、`resource_error` |
| `performance` | `web_vital`、`page_load`、`http_request`、`resource_timing`、`react_render` |
| `behavior` | `page_view`、`route_change`、`click`、`custom` |
| `stability` | `white_screen`、`stutter`、`crash` |
| `ai` | `stream_metric`、`stream_stall` |

服务端必须校验二者的组合。例如 `category: "performance"` 与 `eventType: "js_error"` 的组合无效。

## 5. 分类 payload 结构

### 5.1 错误事件

除第 3 节的公共字段外，`js_error`、`unhandled_rejection`、`cors_error`、`react_error` 和 `vue_error` 的 payload 至少包含：

```json
{
  "exception": {
    "name": "TypeError",
    "message": "Cannot read properties of undefined",
    "stack": [
      {
        "filename": "https://example.com/assets/app.js",
        "functionName": "loadProject",
        "line": 42,
        "column": 17
      }
    ]
  },
  "mechanism": {
    "type": "window.onerror",
    "handled": false
  }
}
```

`resource_error` 使用独立 payload，至少包含 `message`、`resource.url` 和 `mechanism`。具体 TypeScript 定义以 `packages/monitor-sdk/src/types/events.ts` 为当前事实来源；修改协议时，SDK 类型、本文档和 JSON 样例必须在同一轮一起更新。

参考：`contracts/examples/error-batch-v2.json` 同时包含异常错误和资源加载错误，用于覆盖 `ErrorEvent` 联合类型的两个 payload 分支。

### 5.2 性能事件

所有性能事件共享同一种 payload：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `name` | string | 是 | 指标名称，例如 `FCP`、`page-load`、`fetch` 或 `react-render`。 |
| `value` | number | 是 | 指标数值，必须是有限数字。是否允许负数由具体指标决定。 |
| `unit` | string | 是 | `ms`、`bytes` 或 `count`。 |
| `attributes` | object | 否 | 该类指标特有的补充信息，不能代替稳定的公共字段。 |

后端第一版保存完整 attributes，不对其中每个键建立统一 DTO。查询和聚合真正需要某个属性时，再把该属性提升为明确字段。

参考：`contracts/examples/performance-batch-v2.json` 覆盖五种性能事件。

`react_render` 按 Profiler ID 汇总：`payload.value` 是窗口内 React `actualDuration` 之和，单位 `ms`，不是 DOM 提交耗时。`attributes` 包含 `id`、`windowStart`、`windowEnd`、`commitCount`、`mountCount`、`updateCount`、`nestedUpdateCount`、`actualDurationMax`、`baseDurationMax` 和 `slowRenderCount`。三个阶段次数之和等于回调总次数 `commitCount`；慢渲染按配置的渲染耗时门槛判断，不代表 LoAF 卡顿事件。

`windowStart` 为本轮首次渲染的开始时间，`windowEnd` 为汇总时刻，均为 performance 单调时间轴上的毫秒值；事件顶层 `timestamp` 才是汇总时的 Unix 毫秒时间戳。汇总后删除该 ID 的统计，下一次渲染重新开窗，不统计每秒提交率或最后一次回调参数。同名 Profiler 的回调会合并，嵌套 Profiler 的耗时不能跨 ID 相加。生产环境是否能产生此事件取决于应用是否启用 React profiling 构建。

### 5.3 行为事件

行为事件 payload 包含以下可选字段：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `message` | string | 否 | 便于查看的行为摘要。 |
| `data` | object | 否 | 页面、路由、DOM 或自定义行为数据。 |

行为事件与 breadcrumb 不是同一层数据。行为事件是可以独立查询的完整事件；breadcrumb 是错误或稳定性事件携带的有限上下文快照。

当前 SDK 的行为数据约定如下，不改变四种 eventType 或服务端的通用 data 对象：

- `page_view`：data 为 `url`、`referrer`、可选 `navigationType`；URL 不带查询参数和凭据。
- `route_change`：data 为 `from`、`to`、`jumpType`、`timestamp`、`elapsedMs`。只修改 state/query 不生成新页面访问；elapsedMs 是有效导航之间的经过时间，不是前台活跃时长。
- `click`：data 为 `event.target` 元素的 `tagName`、`path`、可选 `monitorId`，不替换为祖先交互元素。默认没有 textContent，显式开启后限制为 120 字符；不读取表单 value。
- `custom`：`monitor.track(name, attributes)` 生成 message=name，data 为 `{ name, attributes }`。该接口不自动生成 breadcrumb；业务需要诊断上下文时使用 `monitor.addBreadcrumb()`。

breadcrumb 由实例独立缓存，点击、导航和已完成 HTTP 请求会写入摘要，业务可手动添加 custom。SDK 限制数量与字节数，写入前过滤、脱敏并形成快照。行为数据仍可能含业务主动提供的敏感内容；服务端也不能因为 data 灵活就跳过公共字段校验。

参考：`contracts/examples/behavior-batch-v2.json` 覆盖四种行为事件。

### 5.4 稳定性事件

稳定性事件必须具有第 3 节的 `level`、`breadcrumbs`，payload 为：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `message` | string | 是 | 白屏、卡顿或崩溃的可读摘要。 |
| `metrics` | object | 否 | 数值型诊断指标，例如 `duration`、`blockingDuration`。所有值必须是有限数字。 |
| `diagnostics` | object | 否 | 结构化诊断信息，例如慢帧的脚本入口和同期旁证。存在时必须是 JSON 对象。 |

`replayData` 仍属于事件顶层的诊断字段，不放入 payload。

`stutter` 只由 LoAF（`long-animation-frame`）达到 SDK 配置门槛后触发，不再计算平均 FPS，也不由 Long Tasks / rAF gap 独立触发。不支持 LoAF 的浏览器不启动该插件，不保留旧告警分支。

- `metrics` 保存 LoAF 的 `startTime`、`duration`、`blockingDuration`、`renderStart`、`styleAndLayoutStart`，以及项目自定上报门槛 `threshold`。`startTime`、`renderStart`、`styleAndLayoutStart` 使用本页面 performance 毫秒时间轴；事件顶层 `timestamp` 使用 LoAF 开始时的 Unix 毫秒，二者不能混用。
- `diagnostics.source` 固定为 `long-animation-frame`；`scripts` 最多包含耗时最高的 5 个脚本入口，保存开始时间、执行耗时、脱敏 URL、函数名、字符位置、调用类型和强制布局耗时，不复制 DOM / window 对象。入口位置不保证就是函数内部最耗时的位置。
- 可选 `diagnostics.longTasks` 包含关联样本的 `count` 和 `maxDuration`；可选 `diagnostics.rafGap` 包含相交间隔中最长一条的 `startTime` 和 `duration`。关联是时间区间相交的旁证，不等于确认共同根因；不同指标不可相加。
- 旁证仅取有界短期缓存。回调晚到、API 不支持或没有匹配样本时省略相应对象，不填 0，也不影响 LoAF 本身的上报。`count` 是缓存内的关联样本数，不保证是完整任务总数。

SDK 默认门槛为 `duration >= 120ms`、最小上报间隔 3000ms；等待旁证的 200ms 窗口内只保留最慢的一帧，随后统一上报。采集生命周期、缓存上限与配置示例见 SDK README。这些门槛是本项目策略，不是浏览器 API 或行业统一标准。

`crash` 使用 v2 事件和批次结构，包含在 `stabilityPlugins()` 中。它表示 Worker 检测到主线程长时间未回复心跳，不代表确认浏览器进程已经崩溃。Worker 无法直接调用主线程的 `ctx.report()`，但可以访问同源 IndexedDB，因此通过同一个 `ReportTransport` 实现生成单事件批次、持久化并发送。

心跳事件与其他事件共享服务端协议、大小限制、请求超时、持久队列和有限重试规则。主线程与 Worker 通过队列租约协调；重试保持同一 batchId 和内容，不能因为执行线程不同而定义另一套 DTO。Worker 使用事先同步的有界诊断快照；录屏过大时省略附件，`payload.metrics.snapshotAgeMs` 表示快照在 Worker 中的持有时长。

参考：`contracts/examples/stability-batch-v2.json` 展示走常规队列的白屏和卡顿；`contracts/examples/crash-batch-v2.json` 单独展示 Worker 生成的 crash 批次。

### 5.5 AI 事件

AI 事件的 payload 与性能指标形状相似：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `name` | string | 是 | 指标名称，例如 `ai-stream` 或 `ai-stream-stall`。 |
| `value` | number | 是 | 指标值，必须是有限数字。 |
| `unit` | string | 是 | `ms`、`bytes` 或 `count`。 |
| `attributes` | object | 否 | trace、请求、分片和流式响应特有信息。 |

当前浏览器 AI 插件观测 Fetch 字节流，不解析 SSE 或模型协议；分片不等于 token。

- `stream_metric` 的 `payload.value` 与 `attributes.ttlb` 是请求开始到流观测结束的毫秒数；中断时是截至取消或报错的耗时，结合 `endReason` 判断。`ttfb` 用 Fetch 返回 Response 的耗时近似首字节耗时；`ttft` / `ttlt` 用 Transform 观察到首块 / 尾块的耗时近似首 token / 尾 token 耗时，不是模型协议级的精确测量。缺失的时刻和耗时省略，不填 0。
- `chunkCount`、`totalBytes` 记录观察到的块数和字节数；`averageChunkInterval`、`maxChunkInterval` 少于两块时省略。业务消费暂停和浏览器缓冲会影响这些指标，它们不代表纯网络或模型耗时。
- `endReason` 为 `end`（读完 / 无正文）、`error`（Fetch 或源流失败）、`cancel`（主动取消 / 请求信号中止）。只有正常结束且 HTTP 为 2xx 时 `success` 为 true；错误响应正文仍原样提供给业务。
- `stream_stall` 仅在消费方正在等待原始 `reader.read()` 时计时。`payload.value` 是本次等待经过的毫秒，`attributes.waitStart` 是本次等待开始时刻，`threshold` 是配置门槛。同一次等待只上报一次，不把暂停消费或等待响应头当成分片停顿。
- 两类事件用同一个 `traceId` 关联。请求 / 分片 / 等待的原始时刻使用页面 `performance.now()` 时间轴；事件顶层 `timestamp` 使用 Unix 毫秒。销毁 SDK 只停止监控，不伪造业务取消或完成事件。

参考：`contracts/examples/ai-batch-v2.json` 覆盖 `stream_metric` 和 `stream_stall`。

## 6. 幂等语义

常规 `ctx.report()` 事件会被 SDK 批量保存到 IndexedDB。断网、服务端限流或 5xx 响应后，同一个批次可能以相同 `batchId` 再次发送；通过 beacon 发送的批次也可能在下次启动时重新确认。

crash Worker 同样使用这套离线重试队列和幂等规则。已经写入 IndexedDB 的批次可由仍在运行的 Worker 或后续页面实例继续发送；尚未完成的持久化写入不保证在进程终止后保留。

服务端以 `(app.id, batchId)` 作为批次幂等键：

- 第一次收到合法批次时，接收整个批次。
- 再次收到相同键时，不重复写入事件，仍返回成功响应。
- 同一个键对应的请求内容不同，返回 `409 BATCH_ID_CONFLICT`，不能静默覆盖旧批次。
- `eventId` 是事件级的第二层防重标识，不能替代批次幂等。

## 7. 成功响应

批次通过校验并被接收后返回 `202 Accepted`：

```json
{
  "data": {
    "batchId": "018f8c78-4fb1-7cb1-a319-06ea417bbb61",
    "accepted": 1,
    "duplicate": false
  }
}
```

重复批次也返回 `202`，但 `accepted` 为 `0`、`duplicate` 为 `true`。`202` 表示接收层已经承担后续处理责任，不保证事件立刻能被查询到。

SDK 的 beacon 调用无法读取响应，但服务端仍执行完全相同的校验、幂等和状态码语义。

## 8. 错误响应

错误响应使用统一结构：

```json
{
  "error": {
    "code": "INVALID_EVENT",
    "message": "events[0].eventType is not valid for category error",
    "details": {
      "field": "events[0].eventType"
    }
  }
}
```

`details` 可选，不应包含服务器堆栈、数据库错误或密钥。

| HTTP 状态 | code 示例 | 使用场景 | SDK 是否重试 |
| --- | --- | --- | --- |
| `400 Bad Request` | `MALFORMED_JSON` | JSON 语法错误、存在尾随内容。 | 否 |
| `403 Forbidden` | `INVALID_PUBLIC_KEY` | `publicKey` 未知、已禁用，或与 `app.id` 不匹配。 | 否 |
| `409 Conflict` | `BATCH_ID_CONFLICT` | 同一幂等键对应不同请求内容。 | 否 |
| `413 Content Too Large` | `PAYLOAD_TOO_LARGE` | 请求体超过 1 MiB。 | 否 |
| `415 Unsupported Media Type` | `UNSUPPORTED_MEDIA_TYPE` | Content-Type 不是 `application/json` 或 `text/plain`。 | 否 |
| `422 Unprocessable Content` | `INVALID_BATCH`、`INVALID_EVENT` | JSON 可解析，但字段、数量或事件组合不合法。 | 否 |
| `429 Too Many Requests` | `RATE_LIMITED` | 项目超过上报速率限制。应同时返回 `Retry-After`。 | 是 |
| `500 Internal Server Error` | `INTERNAL_ERROR` | 服务端暂时无法承担该批次。 | 是 |

SDK 当前还会重试 `408 Request Timeout` 和其他 5xx 响应。4xx（除 408、429）表示请求本身无法通过重试修复，SDK 应丢弃该离线任务。

## 9. 本版本暂不包含

- `publicKey` 的创建、轮换和项目管理接口
- 服务端 Secret 或请求签名鉴权
- gzip 请求体
- OpenAPI 或 JSON Schema 代码生成
- 单事件接收接口
- 部分成功响应
- PostgreSQL、ClickHouse 或 Redis 的具体表结构
- Issue 聚合规则

这些内容需要在真实需求出现时单独讨论，不能通过修改接收实现悄悄改变本契约。
