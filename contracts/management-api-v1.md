# Management API v1

本文档描述当前已实现的管理端事件列表接口。它只负责读取 ClickHouse 事件摘要，尚不包含
用户登录、项目管理和事件详情。

## 鉴权边界

```http
Authorization: Bearer <MANAGEMENT_API_TOKEN>
```

`MANAGEMENT_API_TOKEN` 是服务端秘密，至少 32 字节。浏览器 SDK 的 `publicKey` 只能用于
事件上报，不能读取事件，也不能替代管理 Token。缺少或错误的管理 Token 返回
`401 UNAUTHORIZED`。

当前管理接口不会复用 ingestion 的通配 CORS。后续浏览器管理页面应配合登录会话和明确的
来源白名单，而不是把该 Token 打包进前端资源。

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
