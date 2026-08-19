# monitor-platform

本地开发链路为：浏览器 SDK → Go ingestion API → PostgreSQL 批次账本 → ClickHouse 遥测事件。

## 启动本地服务

先在仓库根目录启动数据库：

```powershell
docker compose up -d postgres clickhouse
docker compose ps
```

进入 `apps/server`，为当前 PowerShell 会话设置连接字符串：

```powershell
$env:DATABASE_URL = "postgres://monitor:monitor_dev_password@localhost:5432/monitor_platform?sslmode=disable"
$env:CLICKHOUSE_DSN = "clickhouse://monitor:monitor_dev_password@localhost:9000/monitor_platform?dial_timeout=5s&compress=lz4"
$env:MANAGEMENT_API_TOKEN = "monitor_local_management_token_change_me"
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

停止容器不会删除数据卷：

```powershell
docker compose stop postgres clickhouse
```

除非明确要重建本地数据，否则不要执行 `docker compose down -v`。
