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
| `replayData` | string | 否 | 压缩后的 rrweb 数据。它可能较大，也属于潜在敏感数据，必须受请求大小和数据保留策略约束。 |

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

### 5.3 行为事件

行为事件 payload 包含以下可选字段：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `message` | string | 否 | 便于查看的行为摘要。 |
| `data` | object | 否 | 页面、路由、DOM 或自定义行为数据。 |

行为事件与 breadcrumb 不是同一层数据。行为事件是可以独立查询的完整事件；breadcrumb 是错误或稳定性事件携带的有限上下文快照。

行为数据容易包含 DOM 文本、URL 参数等敏感信息。SDK 和服务端后续都需要脱敏及长度限制，但本协议不允许服务端因为 `data` 灵活就跳过公共字段校验。

参考：`contracts/examples/behavior-batch-v2.json` 覆盖四种行为事件。

### 5.4 稳定性事件

稳定性事件必须具有第 3 节的 `level`、`breadcrumbs`，payload 为：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `message` | string | 是 | 白屏、卡顿或崩溃的可读摘要。 |
| `metrics` | object | 否 | 数值型诊断指标，例如 `fps`、`duration`。所有值必须是有限数字。 |

`replayData` 仍属于事件顶层的诊断字段，不放入 payload。

`crash` 已使用 v2 事件和批次结构，并已加入默认 `stabilityPlugins()`。它的采集逻辑运行在 Web Worker 中，Worker 无法访问主线程里的 `ctx.report()` 和 IndexedDB 上报队列，因此会独立生成只包含一个 crash 事件的 v2 批次并直接通过 fetch 发送。

这意味着 crash 与其他事件共享同一份服务端协议，但当前不具备常规批次的离线持久化和自动重试能力。服务端不能因为传输路径不同而为 crash 定义另一套 DTO。

参考：`contracts/examples/stability-batch-v2.json` 展示走常规队列的白屏和卡顿；`contracts/examples/crash-batch-v2.json` 单独展示 Worker 生成的 crash 批次。

### 5.5 AI 事件

AI 事件的 payload 与性能指标形状相似：

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `name` | string | 是 | 指标名称，例如 `ai-stream` 或 `ai-stream-stall`。 |
| `value` | number | 是 | 指标值，必须是有限数字。 |
| `unit` | string | 是 | `ms`、`bytes` 或 `count`。 |
| `attributes` | object | 否 | trace、请求、分片和流式响应特有信息。 |

AI 事件独立于 `performance`，是因为它描述模型流式输出的领域语义，例如首 token、流结束和停顿，而不只是普通 HTTP 耗时。

参考：`contracts/examples/ai-batch-v2.json` 覆盖 `stream_metric` 和 `stream_stall`。

## 6. 幂等语义

常规 `ctx.report()` 事件会被 SDK 批量保存到 IndexedDB。断网、服务端限流或 5xx 响应后，同一个批次可能以相同 `batchId` 再次发送；通过 beacon 发送的批次也可能在下次启动时重新确认。

当前 crash Worker 直接发送 v2 批次，不经过这套离线重试队列，但仍必须遵守相同的幂等规则。这样将来为 crash 增加重试，或网络层出现重复请求时，服务端无需改变处理方式。

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
