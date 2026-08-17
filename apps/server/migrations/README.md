# PostgreSQL 迁移

PostgreSQL 只保存用户、项目、公开上报 Key 等控制面数据。SDK 上报的遥测事件仍计划写入 ClickHouse。

根目录的 `compose.yaml` 会在 PostgreSQL 数据卷第一次初始化时执行 `000001_create_projects.up.sql`。Docker 官方镜像只会对空数据目录执行初始化脚本，因此修改已有迁移文件不会自动更新已经存在的数据库。

当前只有第一张表，所以先用这个轻量方式完成本地开发和演示。出现第二个迁移版本时，再引入专门的迁移命令，按版本执行 `up.sql`，不要靠删除数据卷来升级数据库。

常用命令（在仓库根目录执行）：

```powershell
docker compose up -d postgres
docker compose ps
docker compose logs postgres
docker compose stop postgres
```

运行真实 PostgreSQL 集成测试：

```powershell
$env:TEST_DATABASE_URL = "postgres://monitor:monitor_dev_password@localhost:5433/monitor_platform?sslmode=disable"
go test -tags=integration ./internal/storage/postgres
```

`docker compose stop postgres` 只停止容器，不会删除数据库卷。`docker compose down -v` 会删除本项目数据库数据，除非明确要重建数据库，否则不要执行。
