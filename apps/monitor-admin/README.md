# monitor-admin

当前管理端呈现后端已经实现的只读项目切换、原始事件列表与详情，不模拟 Workspace、登录、
事件聚合状态、环境筛选或项目增删改。

## 本地启动

先为 Go 服务和管理端配置同一个 `MANAGEMENT_API_TOKEN`（至少 32 字节）。Vite 会读取仓库
根目录的 `.env`，Go 服务则使用启动它的 PowerShell 会话环境。然后：

```powershell
cd apps/monitor-admin
pnpm install
pnpm dev
```

页面地址为 `http://127.0.0.1:5174/events`。侧栏项目选择器从 PostgreSQL 项目列表读取数据。
仓库根目录 `.env` 中的 `VITE_MONITOR_PROJECT_ID` 只是首次加载的首选项目，默认为
`monitor-local`；如果该项目不存在，页面会选择接口返回的第一个项目。Go API 地址默认是
`http://127.0.0.1:8080`，可用服务端变量 `MONITOR_API_ORIGIN` 覆盖。

## 鉴权边界

浏览器只请求同源的 `/management-api`。本地 Vite 开发代理读取服务端环境变量
`MANAGEMENT_API_TOKEN`，转发请求时注入 Bearer Token；该 Token 不会进入浏览器模块或构建产物。

这只是本地开发桥接。`vite build` 生成的静态资源没有生产代理，不能直接作为生产管理端部署。
正式环境仍需要登录会话或 BFF，并在服务端完成用户与项目权限校验。

## 前端架构

管理端按职责分层，而不是把页面逻辑集中在入口组件：

```text
src/
├─ app/       # Router、QueryClient 和全局 Provider
├─ pages/     # 路由页面，只组合业务组件
├─ features/  # 事件领域的 API、查询、类型和组件
├─ widgets/   # AppShell 等跨页面布局
├─ shared/    # API 客户端、配置、工具和基础 UI
└─ store/     # Zustand 管理跨页面客户端状态
```

- React Router 管理 `/events` 与 `/events/:eventId`。
- TanStack Query 管理项目、事件列表、详情、游标分页、缓存、重试和取消信号。
- Zustand 只保存当前项目上下文；切换项目后，包含 `projectId` 的事件 query key 会自然隔离缓存并重新查询，事件数据不进入 Store。
- 页面与组件使用 CSS Modules，全局样式只包含设计变量、reset 和无障碍基础规则。

## 质量检查

```powershell
pnpm lint
pnpm check
pnpm test
pnpm build
```

Vitest 与 Testing Library 覆盖项目切换、列表到详情的路由、URL 筛选条件和管理端鉴权错误状态。
