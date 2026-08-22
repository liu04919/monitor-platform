# monitor-platform

本地链路为：浏览器 SDK → Go ingestion API → PostgreSQL 控制面与批次账本 → ClickHouse 遥测事件。Go 在错误事件入库前生成稳定的 Issue 指纹，管理端再从 ClickHouse 聚合 Issue。PostgreSQL 保存用户和归属项目，Redis 只保存可过期的登录 Session。

## 启动后端

首次运行先创建本地配置：

```powershell
Copy-Item .env.example .env
docker compose up -d postgres clickhouse redis
. .\scripts\import-env.ps1
Set-Location apps/server
go run ./cmd/migrate
go run ./cmd/server
```

Go 不会隐式读取 `.env`；`scripts/import-env.ps1` 只把配置导入当前 PowerShell 进程，不会输出配置值。

管理端认证统一使用 PostgreSQL 账号和 Redis Session：

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me
DELETE /api/v1/auth/logout
```

注册只创建用户；登录才写入 `HttpOnly`、`SameSite=Lax` 的 `monitor_session` Cookie。项目、Issue 和事件读取都要求该 Cookie，并且只能访问当前用户拥有的项目。SDK `publicKey` 只允许上报，不能读取管理数据。

## 启动管理端

```powershell
pnpm --dir apps/monitor-admin install
pnpm --dir apps/monitor-admin dev
```

访问 `http://127.0.0.1:5174`，注册并登录，然后创建第一个项目。项目设置页可以随时重新查看并复制
当前项目的 SDK 配置。

## 启动浏览器 SDK Demo

先把管理端生成的项目配置写入 Demo 的本地环境文件：

```powershell
Copy-Item apps/monitor-demo/.env.example apps/monitor-demo/.env.local
```

填写 `VITE_MONITOR_PROJECT_ID`、`VITE_MONITOR_PROJECT_NAME` 和 `VITE_MONITOR_PUBLIC_KEY` 后启动：

```powershell
pnpm --dir packages/monitor-sdk install
pnpm --dir packages/monitor-sdk build
pnpm --dir apps/monitor-demo install
pnpm --dir apps/monitor-demo dev
```

访问 `http://127.0.0.1:5173`。详细测试场景见 `apps/monitor-demo/README.md`。

停止容器不会删除数据卷：

```powershell
docker compose stop postgres clickhouse redis
```

只有明确要重建本项目数据时才执行 `docker compose down -v`。
