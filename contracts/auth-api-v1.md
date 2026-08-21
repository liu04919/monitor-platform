# Auth API v1

认证接口前缀为 `/api/v1/auth`。用户持久数据保存在 PostgreSQL；登录 Session 以哈希后的不透明 Token 为键保存在 Redis。

## Cookie

注册或登录成功后返回 `monitor_session` Cookie：

- `HttpOnly`：浏览器 JavaScript 无法读取 Token。
- `SameSite=Lax`：默认阻止跨站请求携带登录态。
- `Path=/api/v1`：只发送给 API。
- 本地 HTTP 开发环境不设置 `Secure`；生产环境必须设置。
- 默认有效期为 7 天，可通过 `SESSION_TTL` 调整。

Cookie 中的原始 Token 不写入日志或数据库；Redis Key 使用 Token 的 SHA-256 摘要。

## 注册

`POST /api/v1/auth/register`

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

成功返回 `201`，并直接建立登录 Session：

```json
{
  "data": {
    "id": "6b94c9bf-c6ac-4834-b4dd-80fbde93d1a8",
    "email": "user@example.com",
    "createdAt": 1787241600000
  }
}
```

邮箱会去除首尾空白并转成小写。密码必须包含 8 到 128 个 Unicode 字符，并使用 Argon2id 保存。

## 登录

`POST /api/v1/auth/login`

请求结构与注册相同。成功返回 `200` 和用户数据，并建立新的 Session。邮箱不存在和密码错误统一返回 `INVALID_CREDENTIALS`，避免接口泄露账号是否存在。

## 当前用户

`GET /api/v1/auth/me`

需要有效的 `monitor_session` Cookie。成功返回 `200` 和用户数据；Cookie 缺失、过期或已退出时返回 `401 UNAUTHENTICATED`。

## 退出

`DELETE /api/v1/auth/logout`

删除 Redis Session、清除 Cookie，并返回 `204`。未携带 Cookie 时同样返回 `204`。

## 错误边界

- `400 MALFORMED_JSON`：JSON 损坏、包含未知字段或包含多个 JSON 值。
- `409 EMAIL_CONFLICT`：邮箱已经注册。
- `415 UNSUPPORTED_MEDIA_TYPE`：注册或登录请求不是 `application/json`。
- `422 INVALID_EMAIL` / `INVALID_PASSWORD`：注册字段不满足约束。
- `503 SESSION_UNAVAILABLE`：Redis 不可用。不能把基础设施故障伪装成未登录。

所有认证响应都带有 `Cache-Control: no-store`。
