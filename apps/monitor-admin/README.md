# monitor-admin

管理端实现账号注册、登录、退出，当前用户的项目创建/切换，以及原始事件列表和详情。暂不模拟 Workspace、事件聚合状态、环境筛选、项目编辑或删除。

## 本地启动

先启动仓库根目录的数据库和 Go 服务，然后：

```powershell
cd apps/monitor-admin
pnpm install
pnpm dev
```

访问 `http://127.0.0.1:5174`。Vite 将同源 `/api` 请求代理到 `MONITOR_API_ORIGIN`，默认 `http://127.0.0.1:8080`；浏览器自动携带服务端设置的 HttpOnly Session Cookie，不存在前端管理 Token。

新账号初次登录时会看到第一个项目引导。创建成功后页面只在当前流程展示一次 `publicKey`，项目列表不会再次返回该字段。

## 前端架构

```text
src/
├─ app/       # Router、QueryClient 和全局 Provider
├─ pages/     # 登录、注册、事件列表与详情路由页
├─ features/  # auth、projects、events 领域的 API、模型和组件
├─ widgets/   # AppShell 等跨页面布局
├─ shared/    # API 客户端、工具和基础 UI
└─ store/     # 仅保存当前 projectId 等客户端状态
```

- React Router 的守卫负责受保护路由和登录回跳。
- TanStack Query 是当前用户、项目和事件等服务端状态的唯一缓存。
- Zustand 只保存当前 `projectId`，不复制用户或事件数据。
- Mantine 提供通用控件，React Hook Form + Zod 管理表单与前端校验，CSS Modules 负责产品布局与视觉。
- 注册成功后再登录是有意的串行流程；若 Redis 暂时不可用，页面会明确提示账号已创建，避免用户重复注册。

## 质量检查

```powershell
pnpm lint
pnpm check
pnpm test
pnpm build
```
