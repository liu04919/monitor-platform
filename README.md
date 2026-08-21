# monitor-platform

本地开发链路为：浏览器 SDK → Go ingestion API → PostgreSQL 控制面与批次账本 → ClickHouse 遥测事件。Redis 保存可过期的管理端登录 Session。

## 启动本地服务

首次运行时先在仓库根目录创建本地环境文件；`.env` 已被 Git 忽略，不会提交：

```powershell
Copy-Item .env.example .env
```

确认本地密码和 `MANAGEMENT_API_TOKEN` 已替换后，启动依赖：

```powershell
docker compose up -d postgres clickhouse redis
docker compose ps
```

Go 不会隐式读取 `.env`。在仓库根目录点调用导入脚本，把配置安全地加载到当前 PowerShell 进程；脚本不会输出配置值：

```powershell
. .\scripts\import-env.ps1
Set-Location apps/server
```

依次执行迁移、创建本地接入项目并启动服务：

```powershell
go run ./cmd/migrate
go run ./cmd/devseed
go run ./cmd/server
```

`devseed` 默认幂等创建以下本地项目，与 SDK 默认配置保持一致：

```text
projectId: monitor-local
projectName: monitor
publicKey: pk_local_development
```

可以通过 `.env.example` 中的 `DEV_PROJECT_ID`、`DEV_PROJECT_NAME` 和
`DEV_PROJECT_PUBLIC_KEY` 覆盖这些默认值；覆盖后也要同步修改 SDK 初始化配置。

服务启动后可访问 `http://127.0.0.1:8080/healthz` 检查进程是否存活。SDK 默认上报地址为
`http://127.0.0.1:8080/api/v1/events/batch`。

认证接口使用 PostgreSQL 用户和 Redis Session：

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me
DELETE /api/v1/auth/logout
```

注册与登录成功后，服务端写入 `HttpOnly`、`SameSite=Lax` 的 `monitor_session` Cookie。浏览器只能携带它，不能从 JavaScript 读取 Session Token。

管理端事件列表使用独立的服务端 Token，不能使用 SDK 的 `publicKey`：

```powershell
$headers = @{ Authorization = "Bearer $env:MANAGEMENT_API_TOKEN" }
Invoke-RestMethod `
  -Headers $headers `
  -Uri "http://127.0.0.1:8080/api/v1/projects/monitor-local/events?limit=20"
```

列表接口支持 `category`、`eventType`、`limit` 和 `cursor` 查询参数；单个事件详情使用
`/api/v1/projects/{projectId}/events/{eventId}`，详细约定见 `contracts/management-api-v1.md`。

## 启动浏览器 SDK 联调应用

先构建仓库内 SDK，再安装并启动 React/Vite Demo：

```powershell
pnpm --dir packages/monitor-sdk install
pnpm --dir packages/monitor-sdk build
pnpm --dir apps/monitor-demo install
pnpm --dir apps/monitor-demo dev
```

访问 `http://127.0.0.1:5173`。Demo 使用 `monitor-local`、`monitor` 和
`pk_local_development` 连接本地 Go ingestion；详细场景与验证边界见
`apps/monitor-demo/README.md`。

## 启动本地事件管理端

保持数据库和 Go 服务运行，并确保管理端与 Go 服务使用同一个
`MANAGEMENT_API_TOKEN`。然后启动独立的 React/Vite 管理端：

```powershell
pnpm --dir apps/monitor-admin install
pnpm --dir apps/monitor-admin dev
```

访问 `http://127.0.0.1:5174/events`。本地 Vite 代理在服务端注入管理 Token，Token 不会
进入浏览器构建；该代理只用于本地开发，不能代替生产环境的登录会话和项目鉴权。当前页面
支持创建和切换 PostgreSQL 项目，并展示后端已经支持的原始事件列表与详情。创建成功后可直接
复制 SDK 初始化配置，更多说明见 `apps/monitor-admin/README.md`。

停止容器不会删除数据卷：

```powershell
docker compose stop postgres clickhouse redis
```

除非明确要重建本地数据，否则不要执行 `docker compose down -v`。
