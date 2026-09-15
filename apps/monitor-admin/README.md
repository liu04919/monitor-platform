# monitor-admin

管理端实现账号注册、登录、退出，当前用户的项目创建/切换与 SDK 配置查看，Issue 聚合列表与发生记录详情，以及原始事件列表、详情和事件录屏播放。暂不模拟 Workspace、Issue 状态流转、环境筛选或项目删除。

## 本地启动

先启动仓库根目录的数据库和 Go 服务，然后：

```powershell
cd apps/monitor-admin
pnpm install
pnpm dev
```

访问 `http://127.0.0.1:5174`。Vite 将同源 `/api` 请求代理到 `MONITOR_API_ORIGIN`，默认 `http://127.0.0.1:8080`；浏览器自动携带服务端设置的 HttpOnly Session Cookie，不存在前端管理 Token。

新账号初次登录时会看到第一个项目引导。项目列表不返回 `publicKey`；项目所有者可以从受保护的
项目设置页随时重新查看并复制 SDK 配置。

## 前端架构

```text
src/
├─ app/       # Router、QueryClient 和全局 Provider
├─ pages/     # 登录、注册、项目设置、Issue 与事件路由页
├─ features/  # auth、projects、issues、events、replay 的模型和组件
├─ widgets/   # AppShell 等跨页面布局
├─ shared/    # API 客户端、工具和基础 UI
└─ store/     # 仅保存当前 projectId 等客户端状态
```

- React Router 的守卫负责受保护路由和登录回跳。
- TanStack Query 是当前用户、项目、Issue 和事件等服务端状态的唯一缓存。
- Zustand 只保存当前 `projectId`，不复制用户或事件数据。
- Mantine 提供通用控件，React Hook Form + Zod 管理表单与前端校验，CSS Modules 负责产品布局与视觉。
- 注册成功后再登录是有意的串行流程；若 Redis 暂时不可用，页面会明确提示账号已创建，避免用户重复注册。

## 时间筛选

事件流、问题列表和问题发生记录共用时间选择器：最近 1 小时、24 小时、7 天，以及自定义本地时间。
默认最近 24 小时。实际 `from` / `to`（Unix 毫秒）与预设标识保存在 URL，查询采用 `[from, to)`。
分类、类型筛选和详情往返保留时间条件；查询缓存包含起止时间，切换区间从第一页开始。
预设范围点击刷新会推进到当前时间，自定义范围刷新不改起止时间。

Issue 的事件数、影响用户和首次/最近发生时间按所选时段统计，不混用全量累计数据。
接口参数及错误码见根目录 `contracts/management-api-v1.md`。

## 事件录屏

在事件详情打开「录屏」，可以播放、暂停、拖动进度、回到开头和调整倍速。没有附带录屏的事件显示空状态；录屏损坏或加载失败时可重新加载。

实现位于 `src/features/replay`，使用受登录保护的事件详情接口返回的 `replayData`，不新增独立录屏接口：

- `model/`：Worker 按 SDK 的唯一编码格式解码：Base64 → gzip → UTF-8 JSON。限制压缩字符串大小、解压后的 JSON 字节数和事件数量，检查完整快照、视口和时间顺序。不读取 gzip 内额外包裹 Base64 的数据。
- `player/`：固定 `rrweb-player@1.0.0-alpha.4`，其发行包内的播放器与 SDK 的 `rrweb@2.0.0-alpha.4` 对齐；脚本只在打开录屏时加载。
- `components/`：桌面播放器、播放控制、加载与错误状态。切走录屏页签会终止解码 Worker 并移除播放器 iframe，不在后台继续播放。

Canvas 回放需要执行 rrweb 的回放脚本，因此播放器放在 **data URL 的独立不透明源** 中，并用 CSP nonce 只允许可信播放器脚本执行。不要将 iframe 改成 `srcDoc` 或 `blob:`：当前的 `allow-scripts allow-same-origin` 仅用于 rrweb 内外层 iframe 互访，不能让回放获得管理端源。管理端只接收来自当前播放器窗口的消息。

边界：

- 这是 SDK 在错误发生时附带的短片段，不是完整会话录像。当前 SDK 每 3 秒生成完整快照，截取最近两段，稳定运行时通常约 3–6 秒。
- 图片、样式和字体仍可能从原站加载，资源失效、跨域限制或需要登录时，画面可能不完整。沙箱禁止回放脚本访问管理端 DOM、Cookie 和本地存储，但不禁止上述静态资源请求。
- 当前 rrweb 版本在**快速跳转时可能遗漏 Canvas 中间绘制，停在较早的一帧**。正常连续播放已验证 DOM 和 Canvas 变化；简化压缩编码不改变 rrweb 的录制分段或事件结构。

## 质量检查

```powershell
pnpm lint
pnpm check
pnpm test
pnpm build
```

## 列表分页

事件流、Issue 列表和发生记录统一使用页码分页。每页默认 30 条，可选择 10、30、50、100 条，支持页码、首尾页及输入页码跳转。
`from/to` 固定时间范围，`page/pageSize` 写入 URL 和 TanStack Query 缓存键；只展示当前页数据。
切换时间、筛选条件、项目或每页条数时从第一页开始；刷新自定义时间范围保留页码。
详情返回保留来源列表页码，Issue 列表页码通过 `issuesPage/issuesPageSize` 与发生记录的 `page/pageSize` 区分。
分页接口和总数含义见 [管理 API 契约](../../contracts/management-api-v1.md)。
