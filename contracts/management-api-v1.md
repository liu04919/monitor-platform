# Management API v1

本文档描述当前已实现的管理端项目、Issue 聚合、事件列表和事件详情接口。PostgreSQL 管理用户
与项目，ClickHouse 保存遥测事件并提供 Issue 聚合数据，Redis 保存登录 Session。

## 鉴权边界

注册接口只创建 PostgreSQL 用户；登录成功后返回 `HttpOnly`、`SameSite=Lax` 的
`monitor_session` Cookie。项目与事件接口只接受该 Session，不支持 Bearer Token：

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me
DELETE /api/v1/auth/logout
```

缺少、过期或错误的 Session 返回 `401 UNAUTHENTICATED`；Redis 暂时不可用返回
`503 SESSION_UNAVAILABLE`。浏览器 SDK 的 `publicKey` 只能用于事件上报，不能读取管理数据。

每个项目都有非空 `owner_user_id`。列表只返回当前用户的项目；创建项目自动绑定当前用户；项目、
Issue 和事件接口都会先验证项目归属。访问不存在或不属于自己的项目统一返回
`404 PROJECT_NOT_FOUND`，不泄露其他用户的项目是否存在。

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
        "id": "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7",
        "name": "Monitor Web",
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
  "name": "Monitor Web"
}
```

调用方只填写 `name`；它去除首尾空白后必须非空，最长 128 个 Unicode 字符。请求体最多
4 KiB，且不能包含未知字段或多个 JSON 值。

服务端生成不可变的 UUID v4 项目 ID，作为 SDK 的稳定 `appId`；同时使用系统安全随机源生成
256 位随机 `publicKey`。项目名称允许重复，项目归属由登录用户和服务端生成的 ID 隔离。
创建成功返回 `201 Created`：

```json
{
  "data": {
    "id": "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7",
    "name": "Monitor Web",
    "enabled": true,
    "createdAt": 1787155200000,
    "publicKey": "pk_generated_value"
  }
}
```

`publicKey` 会暴露在浏览器 SDK 中，不是管理端秘密。项目列表不会重复返回它；管理端应在创建
成功后让用户立即复制 SDK 配置。名称非法返回 `422 INVALID_PROJECT`；数据库或随机源故障返回
不暴露内部错误的 `500 INTERNAL_ERROR`。调用方提交 `id` 等未知字段会返回
`400 MALFORMED_JSON`。

## 项目详情

```http
GET /api/v1/projects/{projectId}
```

该接口用于当前项目的设置与 SDK 接入页。只有项目所有者可以读取；不存在、UUID 非法或属于其他
用户的项目统一返回 `404 PROJECT_NOT_FOUND`，不会泄露项目是否存在。成功响应会重新返回
`publicKey`：

```json
{
  "data": {
    "id": "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7",
    "name": "Monitor Web",
    "enabled": true,
    "createdAt": 1787155200000,
    "publicKey": "pk_generated_value"
  }
}
```

`publicKey` 是浏览器 SDK 的公开接入凭据，不是管理端 Session 或读取凭据。项目列表继续不返回
该字段，详情接口则允许已登录的项目所有者随时重新复制 SDK 配置。数据库故障返回不暴露内部
错误的 `500 INTERNAL_ERROR`。

## Issue 列表

```http
GET /api/v1/projects/{projectId}/issues
```

Issue 只聚合 `category=error` 的事件。Go 在事件写入 ClickHouse 前根据错误类型、异常类型和错误
位置生成稳定的 `issue_fingerprint`；ClickHouse 只按这个字段分组，不在查询时重新计算指纹。

查询参数：

- `limit`：可选，默认 `30`，范围 `1..100`
- `cursor`：可选，上一页返回的不透明游标

```json
{
  "data": {
    "issues": [
      {
        "id": "e75e42d8fa4b92e739f3365d687b854a",
        "title": "Cannot read properties of undefined",
        "eventType": "js_error",
        "exceptionType": "TypeError",
        "eventCount": 3,
        "affectedUsers": 2,
        "firstSeen": 1787328000000,
        "lastSeen": 1787328060000,
        "latestEventId": "evt_latest",
        "latestPageUrl": "https://example.com/profile"
      }
    ],
    "nextCursor": "opaque_cursor_or_empty_string"
  }
}
```

结果按 `(lastSeen DESC, id DESC)` 稳定排序。项目不存在或不属于当前用户返回
`404 PROJECT_NOT_FOUND`；非法 `limit` 或 `cursor` 返回 `400 INVALID_QUERY`；ClickHouse 故障
返回不暴露内部错误的 `500 INTERNAL_ERROR`。

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
    "projectId": "7b5d9a2f-3c61-4e88-9f42-2d6b81a530c7",
    "appName": "Monitor Web",
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

当前用户拥有项目但事件不存在时返回 `404 EVENT_NOT_FOUND`；项目不存在或不属于当前用户时返回
`404 PROJECT_NOT_FOUND`；路径参数非法返回
`400 INVALID_PATH`；数据库或存储 JSON 异常返回不暴露内部细节的 `500 INTERNAL_ERROR`。
