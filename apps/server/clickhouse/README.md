# ClickHouse 本地开发环境

ClickHouse 保存 SDK 上报的高吞吐遥测事件，PostgreSQL 继续保存用户、项目和公开上报 Key 等业务数据。

本项目的 ClickHouse 数据库名固定为 `monitor_platform`，与初始化 SQL 保持一致；本地端口、用户和密码可以通过 `.env` 覆盖。

根目录的 `compose.yaml` 使用以下端口：

- `8123`：HTTP 协议，便于使用浏览器、curl 或数据库工具调试。
- `9000`：原生协议，Go 服务通过这个端口连接。

宿主机和容器都使用 ClickHouse 标准端口 `8123/9000`。本项目优先占用这组端口，其他本地学习容器需要避让。

Compose 挂载的初始化 SQL 只会在 ClickHouse 数据卷第一次初始化时执行。已经存在的数据卷需要在 `apps/server` 目录运行 `go run ./cmd/migrate`，按版本应用 PostgreSQL 和 ClickHouse 的待执行迁移。

常用命令（在仓库根目录执行）：

```powershell
docker compose up -d clickhouse
docker compose ps
docker compose logs clickhouse
docker compose stop clickhouse
```

迁移命令需要同时设置 `DATABASE_URL` 和 `CLICKHOUSE_DSN`，完整示例见 `apps/server/migrations/README.md`。

运行真实 ClickHouse 集成测试：

```powershell
$env:TEST_CLICKHOUSE_DSN = "clickhouse://monitor:monitor_dev_password@localhost:9000/monitor_platform?dial_timeout=5s&compress=lz4"
go test -tags=integration ./internal/database
```

`MergeTree` 的排序键用于加速项目、分类和时间范围查询，不是唯一约束。`batchId` 的业务状态和冲突由 PostgreSQL 记录，ClickHouse 的插入 token 只负责保护失败重试。

`000002_enable_insert_deduplication.sql` 会在本地保存最近 `10000` 个插入块的去重标识。这是有边界的重试保护，不是永久唯一约束；长期批次身份仍以 PostgreSQL 的 `ingestion_batches` 为准。

`docker compose stop clickhouse` 只停止容器，不会删除数据卷。`docker compose down -v` 会删除本项目的 PostgreSQL 和 ClickHouse 数据，除非明确要整体重建，否则不要执行。
