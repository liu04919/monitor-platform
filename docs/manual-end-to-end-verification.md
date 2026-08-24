# 本地完整人工验证教程

这份教程用于从所有服务均已关闭的状态开始，完整验证以下链路：

```text
Docker 数据库
  → Go 服务
  → 管理端注册、登录和创建项目
  → monitor-demo 接入项目配置
  → 浏览器 SDK 上报
  → PostgreSQL 批次账本
  → ClickHouse 事件
  → 管理端事件与 Issue
```

本教程假设你始终打开着 IDE 工作区，启动命令主要在 IDE 的 CMD 集成终端中输入；只有需要给 Go 打断点时，才使用“运行和调试”面板。不要求打开外部 PowerShell。

## 0. 验证前准备

使用 IDE 打开仓库根目录：

```text
D:\code\Go\monitor-platform
```

左侧文件树至少应包含：

```text
.vscode
apps
packages
.env.example
compose.yaml
```

本教程建议在 IDE 中保留三个集成终端：

```text
server
admin
demo
```

PostgreSQL、ClickHouse 和 Redis 由 Docker Desktop 在后台运行。

## 1. 启动数据库

### 1.1 启动 Docker Desktop

手动启动 Docker Desktop，等待 Docker Engine 完全就绪。若 Docker 尚未就绪便执行 Compose，通常会看到 `dockerDesktopLinuxEngine` 管道不存在之类的错误。

### 1.2 检查根目录环境文件

在 IDE 文件树中确认根目录存在 `.env`。

如果不存在：

1. 复制根目录 `.env.example`。
2. 将副本命名为 `.env`。
3. 本地开发可以直接使用示例中的数据库配置。

不要覆盖已经在使用的 `.env`，否则新配置可能与现有 Docker 数据卷中的数据库账号不一致。

### 1.3 使用 IDE 集成终端启动数据库

在 IDE 中选择“终端 → 新建终端”。如果终端不在仓库根目录，执行：

```cmd
cd /d D:\code\Go\monitor-platform
```

启动数据库：

```cmd
docker compose up -d postgres clickhouse redis
```

检查状态：

```cmd
docker compose ps
```

预期三个服务最终都显示为 `healthy`：

```text
postgres
clickhouse
redis
```

刚启动时若暂时显示 `starting`，等待几秒后再次执行 `docker compose ps`。

三个数据库的职责是：

```text
PostgreSQL
├─ 用户
├─ 项目
└─ 上报批次状态

Redis
└─ 登录 Session

ClickHouse
├─ 原始遥测事件
└─ Issue 聚合查询数据
```

## 2. 在 IDE 中启动 Go 后端

Go 标准库本身不会读取 `.env`，本项目的迁移和服务入口已经统一接入环境文件加载器。程序会从当前目录开始向上查找 `.env`，因此从仓库根目录或 `apps/server` 启动都不需要手工导入变量。操作系统已经设置的同名变量优先，不会被 `.env` 覆盖。

### 2.1 执行数据库迁移

在同一个终端中执行：

```cmd
cd apps\server
go run ./cmd/migrate
```

迁移任务会创建或检查 PostgreSQL 与 ClickHouse 表。迁移完成后任务自动退出是正常行为。

### 2.2 启动 HTTP 服务

迁移结束后，继续在当前终端执行：

```cmd
go run ./cmd/server
```

保持该终端运行，可以将终端标签重命名为 `server`。

需要打断点调试 Go 时，再使用“运行和调试”面板中的可选配置：

```text
后端：数据库迁移
后端：启动服务
```

这两个入口与终端命令使用同一个 `.env` 加载流程。

### 2.3 验证后端健康状态

浏览器访问：

```text
http://127.0.0.1:8080/healthz
```

预期响应：

```json
{
  "data": {
    "status": "ok"
  }
}
```

如果该地址无法访问，先查看 `server` 终端输出，不要继续启动管理端和 Demo。

## 3. 启动管理端

在 IDE 中新建一个 CMD 集成终端：

```cmd
cd /d D:\code\Go\monitor-platform
pnpm --dir apps/monitor-admin install
pnpm --dir apps/monitor-admin dev
```

保持该终端运行，并访问：

```text
http://127.0.0.1:5174
```

## 4. 注册和登录

### 4.1 注册新账号

在登录页点击“创建账号”。为了完整验证注册流程，使用一个未注册过的邮箱，例如：

```text
manual-20260824@example.com
```

密码示例：

```text
Monitor123!
```

如果邮箱已存在，换一个新的邮箱即可，不需要清理数据库。

注册只会在 PostgreSQL 创建用户，不会自动登录。

### 4.2 登录

使用刚注册的邮箱和密码登录。登录成功后的数据流是：

```text
PostgreSQL 验证用户
  → Redis 创建 Session
  → 浏览器收到 HttpOnly Cookie
  → 管理端使用 Cookie 请求当前用户数据
```

## 5. 创建项目并获取 SDK 配置

### 5.1 创建项目

登录后点击“新建项目”，项目名称可以填写：

```text
Manual E2E
```

点击“创建项目”。服务端会自动生成：

```text
项目 ID
publicKey
创建时间
```

用户只填写项目名称，不需要手工编写项目 ID 或随机后缀。

### 5.2 复制 SDK 配置

创建成功后，页面会显示类似配置：

```ts
createMonitor({
  url: "http://127.0.0.1:8080/api/v1/events/batch",
  projectName: "Manual E2E",
  appId: "服务端生成的项目 UUID",
  publicKey: "服务端生成的 pk_...",
});
```

点击“复制配置”，保存以下三个项目值：

```text
projectName
appId
publicKey
```

如果关闭了创建成功窗口，可以进入“项目设置 → SDK 初始化配置”再次复制。

在完成 Demo 验证前：

- 不要重新生成 `publicKey`；
- 不要关闭“允许 SDK 上报”。

## 6. 在 monitor-demo 中接入项目

### 6.1 配置 `.env.local`

在 IDE 文件树中打开：

```text
apps/monitor-demo/.env.local
```

如果文件不存在，复制 `apps/monitor-demo/.env.example` 并将副本命名为 `.env.local`。

把刚创建的项目配置填写进去：

```env
VITE_MONITOR_REPORT_URL=http://127.0.0.1:8080/api/v1/events/batch
VITE_MONITOR_PROJECT_ID=这里粘贴项目的 appId
VITE_MONITOR_PROJECT_NAME=Manual E2E
VITE_MONITOR_PUBLIC_KEY=这里粘贴项目的 publicKey
```

保存文件。不要加逗号，也不要把内容改成 JavaScript 对象。

`publicKey` 应写在 `.env.local`，不要直接硬编码到 TypeScript。它会出现在浏览器中，用于 SDK 上报接入控制，但不能代替管理端登录 Session。

### 6.2 理解 Demo 中的接入代码

`apps/monitor-demo/src/monitor.ts` 读取环境变量：

```ts
const projectId = import.meta.env.VITE_MONITOR_PROJECT_ID?.trim();
const projectName = import.meta.env.VITE_MONITOR_PROJECT_NAME?.trim();
const publicKey = import.meta.env.VITE_MONITOR_PUBLIC_KEY?.trim();
```

然后初始化 SDK：

```ts
export const monitor = createMonitor({
  url: REPORT_URL,
  projectName,
  appId: projectId,
  publicKey,
  userId: `local-${new Date().toISOString().slice(0, 10)}`,
  batchSize: 1,
  plugins: [
    ...behaviorPlugins(),
    ...browserErrorPlugins(),
    reactErrorPlugin(),
    ...performancePlugins(),
    aiStreamPlugin(...),
    reactProfilerPlugin(...),
    stallPlugin(...),
  ],
})
```

文件职责如下：

```text
.env.local
└─ 当前本地项目配置

monitor.ts
└─ SDK 初始化和插件注册

App.tsx
└─ 各种错误、性能和行为测试场景
```

不要用管理端复制出来的简化示例覆盖整个 `monitor.ts`，否则会丢失 Demo 的 Beacon 模式、React 插件和测试能力。

## 7. 构建 SDK 并启动 monitor-demo

在 IDE 中新建另一个 CMD 集成终端：

```cmd
cd /d D:\code\Go\monitor-platform
pnpm --dir packages/monitor-sdk install
pnpm --dir packages/monitor-sdk build
pnpm --dir apps/monitor-demo install
pnpm --dir apps/monitor-demo dev
```

必须先构建 SDK，因为 Demo 使用仓库内的本地包：

```text
apps/monitor-demo
  → link:../../packages/monitor-sdk
  → packages/monitor-sdk/dist
```

访问：

```text
http://127.0.0.1:5173
```

此时应同时保持：

```text
Go 后端：8080
管理端：5174
monitor-demo：5173
```

## 8. 验证第一次真实上报

Demo 右上角最初可能显示“等待首次上报”。SDK 初始化后会自动采集部分页面和性能事件；普通 Fetch 上报成功后会显示“Go ingestion 已接通”。

打开浏览器开发者工具：

```text
Network → Fetch/XHR → 筛选 batch
```

应看到：

```text
POST http://127.0.0.1:8080/api/v1/events/batch
```

预期状态码：

```text
202 Accepted
```

响应大致如下：

```json
{
  "data": {
    "accepted": 1,
    "duplicate": false
  }
}
```

## 9. 触发 JavaScript 错误

在 Demo 中找到“JavaScript 错误”，点击“运行测试”。浏览器 Console 会出现：

```text
Uncaught Error: 全局 JavaScript 测试错误
```

这是 Demo 故意制造的真实错误，属于预期现象。SDK 会通过 `window.onerror` 捕获它并生成错误事件。

回到管理端，确认当前选择的是刚创建的 `Manual E2E` 项目，然后进入“事件流”并刷新。

应该看到类似：

```text
分类：error
事件类型：js_error
传输：fetch
```

点击事件进入详情，检查：

- 错误名称；
- 错误消息；
- 页面 URL；
- 堆栈；
- Breadcrumbs；
- Payload；
- 传输方式。

## 10. 验证 Issue 聚合

进入管理端“问题”页面并刷新，应该看到“全局 JavaScript 测试错误”，事件数为 1。

回到 Demo，再次运行同一个“JavaScript 错误”，然后刷新管理端“问题”页面。

预期结果：

```text
仍然只有一个 Issue
事件数从 1 增加到 2
```

点击 Issue 可以查看两条发生记录。这证明相同错误位置会得到相同 Issue 指纹并被聚合。

## 11. 验证其他事件类型

Demo 还提供以下场景：

| 场景            | 主要验证内容              | 管理端位置   |
| --------------- | ------------------------- | ------------ |
| Fetch 请求      | Fetch 状态和耗时          | 事件流       |
| XHR 请求        | XMLHttpRequest 状态和耗时 | 事件流       |
| AI 流式响应     | TTFB、TTFT、Chunk 和停顿  | 事件流       |
| 自定义事件      | 业务行为数据              | 事件流       |
| 路由切换        | 页面导航行为              | 事件流       |
| 主线程长任务    | Long Task 和 RAF 卡顿     | 事件流       |
| JavaScript 错误 | 全局异常与堆栈            | 问题、事件流 |
| Promise 错误    | 未处理 Promise rejection  | 问题、事件流 |
| 资源加载错误    | 失败资源地址和标签        | 问题、事件流 |
| React 错误      | React ErrorBoundary       | 问题、事件流 |
| React Profiler  | React 提交次数和耗时      | 事件流       |

“事件流”展示所有原始事件；“问题”只聚合错误类事件。性能和行为事件不会出现在“问题”页面。

## 12. 验证页面退出 Beacon

打开：

```text
http://127.0.0.1:5173/?beacon=1&runId=manual-beacon-001
```

页面会创建一条自定义事件并立即跳转到完成页，SDK 在 `pagehide` 阶段调用 `navigator.sendBeacon`。

回管理端刷新“事件流”，找到最新事件，其传输方式应为：

```text
beacon
```

每次测试更换 `runId`，例如：

```text
manual-beacon-002
manual-beacon-003
```

`sendBeacon` 不向 JavaScript 暴露服务端响应，因此最终是否成功要以管理端事件列表为准。

## 13. 验证断网恢复

1. 保持 Demo 页面打开。
2. 打开 DevTools 的 Network 面板。
3. 将网络切换为 `Offline`。
4. 在 Demo 中运行“自定义事件”。
5. 打开 `Application → IndexedDB → monitor-sdk → reportQueue`。
6. 确认存在待重试批次。
7. 把 Network 恢复为 `No throttling`。
8. 等待 SDK 自动重传。
9. 确认 `reportQueue` 中的任务消失。
10. 回管理端刷新事件流，确认断网期间触发的事件已经出现。

完整路径是：

```text
浏览器事件
  → monitor-sdk 插件
  → 内存批次 / IndexedDB
  → POST /api/v1/events/batch
  → Go 校验项目、publicKey 和 Payload
  → PostgreSQL 记录批次状态
  → Go 为错误事件计算 Issue 指纹
  → ClickHouse 保存事件
  → 管理端查询事件和 Issue
```

## 14. 常见问题

### 后端启动时提示缺少环境变量

确认：

- 仓库根目录存在 `.env`；
- `.env` 中存在 `DATABASE_URL`、`CLICKHOUSE_DSN` 和 `REDIS_URL`；
- 当前命令从 `monitor-platform` 仓库内部执行，而不是其他无关目录。

如果使用 `.vscode/launch.json` 进行断点调试，则确认 IDE 已安装并启用 Go 扩展。

### Demo 提示缺少项目配置

确认 `apps/monitor-demo/.env.local` 中四个变量都有值。Vite 只在启动时读取环境文件，修改后需要停止并重新启动 Demo。

### 上报返回 `403 INVALID_PUBLIC_KEY`

常见原因：

- publicKey 粘贴错误；
- 项目已停用；
- 项目重新生成过 publicKey，`.env.local` 仍然使用旧值；
- appId 与 publicKey 来自不同项目。

重新进入“项目设置 → SDK 初始化配置”复制完整配置，然后重启 Demo。

### Demo 已接通，但管理端没有数据

先确认管理端选择的是 Demo `.env.local` 中 `VITE_MONITOR_PROJECT_ID` 对应的项目。存在同名项目时，以项目 ID 为准，而不是只看名称。

### 点击错误测试后 Console 变红

JavaScript、Promise、资源加载和 React 错误场景会故意制造真实错误。Console 出现红色信息是验证的一部分。

### 端口被占用

默认端口：

```text
Go 后端：8080
monitor-demo：5173
管理端：5174
PostgreSQL：5432
Redis：6379
ClickHouse HTTP：8123
ClickHouse Native：9000
```

关闭旧的同类进程后再启动，不要随意修改端口绕过问题。

## 15. 停止服务

在 IDE 中分别停止：

- 在 `server` 终端按 `Ctrl+C`；
- 在 `admin` 终端按 `Ctrl+C`；
- 在 `demo` 终端按 `Ctrl+C`。

在 IDE 的 CMD 集成终端中停止数据库：

```cmd
cd /d D:\code\Go\monitor-platform
docker compose stop postgres clickhouse redis
```

该命令只停止容器，不删除账号、项目、事件和数据库卷。

不要执行：

```cmd
docker compose down -v
```

除非明确需要删除本项目的全部数据库数据。

## 16. 最终验收清单

- [ ] PostgreSQL、ClickHouse、Redis 均为 healthy；
- [ ] `/healthz` 返回 `status: ok`；
- [ ] 新用户可以注册和登录；
- [ ] 登录 Session 写入 Redis；
- [ ] 用户可以创建自己的项目；
- [ ] 项目 ID 和 publicKey 由服务端生成；
- [ ] Demo 读取 `.env.local` 中的项目配置；
- [ ] 普通上报返回 HTTP 202；
- [ ] 管理端可以查询原始事件和详情；
- [ ] 相同错误被聚合成一个 Issue；
- [ ] 重复发生会增加 Issue 事件数；
- [ ] 页面退出事件使用 Beacon 传输；
- [ ] 断网事件进入 IndexedDB 并在恢复网络后重传。
