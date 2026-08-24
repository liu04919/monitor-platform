# 后端生产部署指南

本指南用于把 Monitor 后端部署到一台 Linux VPS。目标拓扑为：

```text
Internet
   │ 80 / 443
   ▼
Caddy
   │ edge network
   ▼
Go server:8080
   │ data network（仅容器内部可达）
   ├─ PostgreSQL:5432
   ├─ ClickHouse:9000
   └─ Redis:6379
```

生产配置只公开 Caddy 的 80、443 端口。PostgreSQL、ClickHouse、Redis 和 Go 服务都不映射宿主机端口。

## 1. 部署边界

这套单机部署适合个人项目、作品展示和低流量服务。建议服务器至少具备：

```text
2–4 vCPU
8 GB RAM
80 GB SSD
Ubuntu 24.04 LTS 或同类 Linux
```

它不提供多机高可用。服务器或磁盘发生故障时，恢复能力取决于站外备份。

当前配置上线的是后端 API。SDK 可以跨域向以下地址上报：

```text
https://你的域名/api/v1/events/batch
```

管理端目前使用同源 Cookie 和相对 `/api/v1` 请求。完整上线管理端时，应让 Caddy 在同一个站点托管管理端静态文件并转发 `/api/*`，不要临时增加跨域认证分支。

## 2. 文件职责

```text
apps/server/Dockerfile
└─ 构建 server 与 migrate 两个 Go 程序

compose.production.yaml
├─ 生产数据库
├─ 显式 migrate Job
├─ Go server
└─ Caddy

deploy/Caddyfile
└─ HTTPS 与反向代理

.env.production
└─ 服务器本地密钥，不提交 Git
```

本地开发继续使用 `compose.yaml` 和 `.env`，生产环境只使用 `compose.production.yaml` 和 `.env.production`。

## 3. 准备服务器与域名

1. 创建 Linux VPS，并使用 SSH 密钥登录。
2. 为 API 准备域名，例如 `api.monitor.example.com`。
3. 在 DNS 服务商处添加指向 VPS 公网地址的 `A` 记录；使用 IPv6 时同时添加 `AAAA` 记录。
4. 安装 Docker Engine 与 Docker Compose Plugin。
5. 防火墙只放行 SSH、HTTP 和 HTTPS。

Ubuntu 使用 UFW 时可以执行：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status
```

不要开放：

```text
5432   PostgreSQL
6379   Redis
8123   ClickHouse HTTP
9000   ClickHouse Native
8080   Go server
```

## 4. 获取代码

```bash
git clone https://github.com/liu04919/monitor-platform.git
cd monitor-platform
git status --short --branch
```

生产部署应从已经推送的明确 commit 开始，不直接上传本地未提交文件。

## 5. 创建生产配置

复制模板：

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

生成三个独立的十六进制密码：

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

分别写入：

```text
POSTGRES_PASSWORD
CLICKHOUSE_PASSWORD
REDIS_PASSWORD
```

编辑 `.env.production`，至少确认：

```env
MONITOR_API_DOMAIN=api.monitor.example.com

POSTGRES_DB=monitor_platform
POSTGRES_USER=monitor
POSTGRES_PASSWORD=第一段随机值

CLICKHOUSE_DB=monitor_platform
CLICKHOUSE_USER=monitor
CLICKHOUSE_PASSWORD=第二段随机值

REDIS_PASSWORD=第三段随机值
SESSION_TTL=168h
IMAGE_TAG=latest
```

密码使用十六进制字符，是因为生产 Compose 会使用这些值构造数据库 URL；这样不需要额外处理 URL 转义。

检查生产配置能否解析：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  config --quiet
```

不要执行不带 `--env-file .env.production` 的生产命令。

## 6. 首次部署

### 6.1 构建 Go 镜像

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  build server
```

镜像同时包含：

```text
/app/server
/app/migrate
```

两个程序均由非 root 用户运行，迁移 SQL 已通过 `go:embed` 编译进 `migrate`。

### 6.2 启动数据库

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  up -d postgres clickhouse redis
```

检查状态：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  ps
```

等待三个数据库都显示 `healthy`。

### 6.3 执行迁移

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  run --rm migrate
```

迁移是显式的一次性任务，只在首次部署或代码新增迁移时执行。生产数据库没有挂载 `/docker-entrypoint-initdb.d`，不存在第二套初始化路径。

### 6.4 启动 API 和 HTTPS

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  up -d server caddy
```

Caddy 会在域名解析正确且 80、443 可达时自动申请 HTTPS 证书。

## 7. 验证部署

查看容器状态：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  ps
```

查看 Go 日志：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  logs --tail=200 server
```

查看 Caddy 证书和代理日志：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  logs --tail=200 caddy
```

验证 HTTPS：

```bash
curl --fail --show-error https://api.monitor.example.com/healthz
```

预期响应：

```json
{ "data": { "status": "ok" } }
```

然后把 Demo 的上报地址改为：

```env
VITE_MONITOR_REPORT_URL=https://api.monitor.example.com/api/v1/events/batch
```

使用真实 `appId` 与 `publicKey` 上报，并从日志确认 API 返回 `202 Accepted`。

## 8. 日常发布

先获取代码：

```bash
git pull --ff-only
```

构建新镜像：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  build server
```

如果本次代码包含新迁移，先执行：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  run --rm migrate
```

更新 Go 服务：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  up -d --no-deps server
```

单机更新会有短暂连接切换，不宣称零停机。

## 9. 停止与重启

停止应用但保留全部数据：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  stop
```

重新启动：

```bash
docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  up -d postgres clickhouse redis server caddy
```

不要执行：

```bash
docker compose --env-file .env.production -f compose.production.yaml down -v
```

`-v` 会删除 PostgreSQL、ClickHouse 和 Caddy 的持久卷。

## 10. 数据备份边界

Redis 只保存登录 Session，丢失后用户重新登录即可。必须备份的是：

```text
PostgreSQL
├─ 用户
├─ 项目
├─ publicKey
└─ 批次账本

ClickHouse
├─ 原始事件
└─ Issue 聚合来源
```

PostgreSQL 可以先手工导出：

```bash
mkdir -p backups

docker compose \
  --env-file .env.production \
  -f compose.production.yaml \
  exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/postgres-$(date +%Y%m%d-%H%M%S).dump"
```

备份文件必须再复制到 VPS 之外。ClickHouse 备份需要结合最终 VPS 提供商的卷快照或对象存储确定方案；在没有选定站外存储前，不在项目中伪造一个只保存在同一块磁盘上的“备份”。

## 11. 回滚边界

应用镜像可以通过切回旧 commit 后重新构建来回滚：

```bash
git checkout <previous-commit>
docker compose --env-file .env.production -f compose.production.yaml build server
docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps server
```

数据库迁移目前只有向上执行。只有确认旧程序兼容已经升级的数据库结构时，才能单独回滚应用。涉及破坏性结构修改时，必须先从站外备份恢复数据库，不能依赖 `git checkout` 回滚数据。

## 12. 上线后仍需完成

这轮生产化不伪装成完整运维体系。正式对陌生公网用户开放前，还需要：

- 为公开 SDK 上报接口增加限流；
- 增加会检查 PostgreSQL、ClickHouse、Redis 的 `/readyz`；
- 选定并验证 ClickHouse 站外备份；
- 增加持续可用性监控和告警；
- 将管理端与 `/api` 部署在同一个站点。
