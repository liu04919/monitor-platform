# Management API v1

本文档描述当前已实现的管理端项目创建/发现、事件列表和详情接口。它在 PostgreSQL 管理项目，
从 ClickHouse 读取事件，尚不包含用户登录以及项目编辑或删除。

## 鉴权边界

```http
Authorization: Bearer <MANAGEMENT_API_TOKEN>
```

`MANAGEMENT_API_TOKEN` 是服务端秘密，至少 32 字节。浏览器 SDK 的 `publicKey` 只能用于
事件上报，不能读取事件，也不能替代管理 Token。缺少或错误的管理 Token 返回
`401 UNAUTHORIZED`。

当前管理接口不会复用 ingestion 的通配 CORS。后续浏览器管理页面应配合登录会话和明确的
来源白名单，而不是把该 Token 打包进前端资源。

## 项目列表

```http
GET /api/v1/projects
```

项目按 `(created_at ASC, id ASC)` 稳定排序。禁用项目仍会返回，便于管理端继续查看历史事件，
调用方通过 `enabled` 区分其接入状态。响应只包含项目选择所需字段，不返回 SDK 使用的
`publicKey`：

```json
{
  "data": {
    "projects": [
      {
        "id": "monitor-local",
        "name": "monitor",
        "enabled": true,
        "createdAt": 1787068800000
      }
    ]
  }
}
```

数据库故障返回不暴露内部错误的 `500 INTERNAL_ERROR`。

## 创建项目

```http
POST /api/v1/projects
Content-Type: application/json
```

```json
{
  "id": "monitor-web",
  "name": "Monitor Web"
}
```

`id` 是 SDK 的稳定 `appId`，创建后不可修改。它最长 128 个字符，只能包含小写字母、数字和
中间连字符，并且必须以字母或数字开头、结尾。`name` 去除首尾空白后必须非空，最长 128 个
Unicode 字符。请求体最多 4 KiB，且不能包含未知字段或多个 JSON 值。

服务端使用系统安全随机源生成 256 位随机 `publicKey`。创建成功返回 `201 Created`：

```json
{
  "data": {
    "id": "monitor-web",
    "name": "Monitor Web",
    "enabled": true,
    "createdAt": 1787155200000,
    "publicKey": "pk_generated_value"
  }
}
```

`publicKey` 会暴露在浏览器 SDK 中，不是管理端秘密。项目列表不会重复返回它；管理端应在创建
成功后让用户立即复制 SDK 配置。ID 或名称非法返回 `422 INVALID_PROJECT`，ID 已存在返回
`409 PROJECT_ID_CONFLICT`，数据库或随机源故障返回不暴露内部错误的 `500 INTERNAL_ERROR`。

## 事件列表

```http
GET /api/v1/projects/{projectId}/events
```

查询参数：

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| `category` | 否 | `error`、`performance`、`behavior`、`stability` 或 `ai`。 |
| `eventType` | 否 | category 下的具体事件类型。 |
| `limit` | 否 | 每页数量，默认 50，范围 1 到 100。 |
| `cursor` | 否 | 上一页返回的不透明游标，调用方不应自行解析或修改。 |

事件按 `(event_timestamp DESC, event_id DESC)` 排序，使用键集分页，不使用 `OFFSET`。
列表只返回摘要字段，完整 payload、breadcrumbs 和 replay data 留给后续详情接口。

```json
{
  "data": {
    "events": [
      {
        "batchId": "batch-1",
        "sendType": "fetch",
        "eventId": "event-1",
        "category": "error",
        "eventType": "js_error",
        "timestamp": 1787068800000,
        "pageUrl": "https://example.com",
        "userId": "user-1",
        "level": "error",
        "message": "boom",
        "receivedAt": 1787068800100
      }
    ],
    "nextCursor": "opaque-cursor-value"
  }
}
```

没有下一页时，`nextCursor` 是空字符串。查询参数非法返回 `400 INVALID_QUERY`；数据库等
内部故障返回不暴露内部错误的 `500 INTERNAL_ERROR`。

列表和详情中的 `message` 是从 SDK payload 读取的展示摘要：优先使用顶层
`payload.message`，为空时读取异常事件的 `payload.exception.message`。该字段只是读取投影，
不会改写 ClickHouse 中保存的原始 `payload`。

## 事件详情

```http
GET /api/v1/projects/{projectId}/events/{eventId}
```

`projectId` 和 `eventId` 共同确定查询范围，不能跨项目读取同名事件。响应包含列表摘要字段，
并补充 `schemaVersion`、`appName`、`sentAt`、`payload`、`breadcrumbs` 和 `replayData`。
数据库中的 JSON 字符串会在存储边界验证，API 返回真正的 JSON 对象和数组：

```json
{
  "data": {
    "schemaVersion": 2,
    "projectId": "monitor-local",
    "appName": "monitor",
    "batchId": "batch-1",
    "sendType": "fetch",
    "sentAt": 1787068800000,
    "eventId": "event-1",
    "category": "error",
    "eventType": "js_error",
    "timestamp": 1787068800000,
    "pageUrl": "https://example.com",
    "userId": "user-1",
    "level": "error",
    "breadcrumbs": [],
    "replayData": null,
    "payload": {
      "message": "boom"
    },
    "receivedAt": 1787068800100
  }
}
```

事件不存在或不属于指定项目时返回 `404 EVENT_NOT_FOUND`；路径参数非法返回
`400 INVALID_PATH`；数据库或存储 JSON 异常返回不暴露内部细节的 `500 INTERNAL_ERROR`。
