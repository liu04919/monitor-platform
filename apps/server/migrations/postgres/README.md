# PostgreSQL 迁移

PostgreSQL 只保存用户、项目、公开上报 Key 等控制面数据。SDK 上报的遥测事件仍计划写入 ClickHouse。

根目录的 `compose.yaml` 会在 PostgreSQL 数据卷第一次初始化时执行向上迁移 SQL。Docker 官方镜像只会对空数据目录执行初始化脚本，因此已经存在的数据卷必须使用迁移命令升级。

`go run ./cmd/migrate` 会把 SQL 编译进命令，按文件名版本执行尚未应用的 PostgreSQL 和 ClickHouse 迁移，并分别写入 `schema_migrations`。迁移文件需要保持可重复执行，不能靠删除数据卷升级数据库。

常用命令（在仓库根目录执行）：

```powershell
docker compose up -d postgres
docker compose ps
docker compose logs postgres
docker compose stop postgres
```

应用数据库迁移（在 `apps/server` 目录执行）：

```powershell
$env:DATABASE_URL = "postgres://monitor:monitor_dev_password@localhost:5432/monitor_platform?sslmode=disable"
$env:CLICKHOUSE_DSN = "clickhouse://monitor:monitor_dev_password@localhost:9000/monitor_platform?dial_timeout=5s&compress=lz4"
go run ./cmd/migrate
```

运行真实 PostgreSQL 集成测试：

```powershell
$env:TEST_DATABASE_URL = "postgres://monitor:monitor_dev_password@localhost:5432/monitor_platform?sslmode=disable"
go test -tags=integration ./internal/storage/postgres
```

`docker compose stop postgres` 只停止容器，不会删除数据库卷。`docker compose down -v` 会删除本项目数据库数据，除非明确要重建数据库，否则不要执行。
