# monitor-platform

本地链路为：浏览器 SDK → Go ingestion API → PostgreSQL 控制面与批次账本 → ClickHouse 遥测事件。Go 在错误事件入库前生成稳定的 Issue 指纹，管理端再从 ClickHouse 聚合 Issue。PostgreSQL 保存用户和归属项目，Redis 只保存可过期的登录 Session。

需要从数据库启动开始，人工走完注册、登录、创建项目、Demo 接入、错误上报、Issue 聚合、Beacon 和断网恢复时，请按照[本地完整人工验证教程](docs/manual-end-to-end-verification.md)操作。教程以 IDE 的 CMD 集成终端为主；需要断点调试时，也可以使用 `.vscode/launch.json` 中的 Go 启动配置。

## 启动后端

首次运行先创建本地配置：

```cmd
if not exist .env copy .env.example .env
docker compose up -d postgres clickhouse redis
cd apps\server
go run ./cmd/migrate
go run ./cmd/server
```

Go 标准库本身不会读取 `.env`；本项目的迁移和服务入口会从当前目录向上找到根目录 `.env` 并自动载入。操作系统已经注入的同名环境变量优先，不会被文件覆盖。需要断点调试时，可以直接使用 `.vscode/launch.json` 中的两个后端启动配置。

管理端认证统一使用 PostgreSQL 账号和 Redis Session：

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me
DELETE /api/v1/auth/logout
```

注册只创建用户；登录才写入 `HttpOnly`、`SameSite=Lax` 的 `monitor_session` Cookie。项目、Issue 和事件读取都要求该 Cookie，并且只能访问当前用户拥有的项目。SDK `publicKey` 只允许上报，不能读取管理数据。

## 启动管理端

```cmd
pnpm --dir apps/monitor-admin install
pnpm --dir apps/monitor-admin dev
```

访问 `http://127.0.0.1:5174`，注册并登录，然后创建第一个项目。项目设置页可以随时重新查看并复制
当前项目的 SDK 配置。

## 启动浏览器 SDK Demo

先把管理端生成的项目配置写入 Demo 的本地环境文件：

```cmd
if not exist apps\monitor-demo\.env.local copy apps\monitor-demo\.env.example apps\monitor-demo\.env.local
```

填写 `VITE_MONITOR_PROJECT_ID`、`VITE_MONITOR_PROJECT_NAME` 和 `VITE_MONITOR_PUBLIC_KEY` 后启动：

```cmd
pnpm --dir packages/monitor-sdk install
pnpm --dir packages/monitor-sdk build
pnpm --dir apps/monitor-demo install
pnpm --dir apps/monitor-demo dev
```

访问 `http://127.0.0.1:5173`。详细测试场景见 `apps/monitor-demo/README.md`。

停止容器不会删除数据卷：

```cmd
docker compose stop postgres clickhouse redis
```

只有明确要重建本项目数据时才执行 `docker compose down -v`。
