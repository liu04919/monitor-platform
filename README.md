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

停止容器不会删除数据卷：

```powershell
docker compose stop postgres clickhouse
```

除非明确要重建本地数据，否则不要执行 `docker compose down -v`。
