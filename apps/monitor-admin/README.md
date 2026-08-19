# monitor-admin

当前管理端只呈现后端已经实现的原始事件列表与详情，不模拟 Workspace、登录、事件聚合状态、
环境筛选或项目管理。

## 本地启动

先为 Go 服务和管理端配置同一个 `MANAGEMENT_API_TOKEN`（至少 32 字节）。Vite 会读取仓库
根目录的 `.env`，Go 服务则使用启动它的 PowerShell 会话环境。然后：

```powershell
cd apps/monitor-admin
pnpm install
pnpm dev
```

页面地址为 `http://127.0.0.1:5174/events`。默认项目是 `monitor-local`；如需切换，可在仓库
根目录 `.env` 设置 `VITE_MONITOR_PROJECT_ID`。Go API 地址默认是
`http://127.0.0.1:8080`，可用服务端变量 `MONITOR_API_ORIGIN` 覆盖。

## 鉴权边界

浏览器只请求同源的 `/management-api`。本地 Vite 开发代理读取服务端环境变量
`MANAGEMENT_API_TOKEN`，转发请求时注入 Bearer Token；该 Token 不会进入浏览器模块或构建产物。

这只是本地开发桥接。`vite build` 生成的静态资源没有生产代理，不能直接作为生产管理端部署。
正式环境仍需要登录会话或 BFF，并在服务端完成用户与项目权限校验。
