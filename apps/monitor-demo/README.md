# monitor-demo

`monitor-demo` 是浏览器 SDK 的本地联调应用，用来验证以下真实数据链路：

```text
React/Vite → minitor-sdk → Go ingestion → PostgreSQL → ClickHouse
```

应用通过 `link:../../packages/monitor-sdk` 使用当前仓库中的 SDK 构建产物，默认上报到
`http://127.0.0.1:8080/api/v1/events/batch`。

## 启动

先按照仓库根 README 启动后端，在管理端注册、登录并创建项目。把创建结果中的 SDK 配置写入
Demo 的本地环境文件：

```powershell
Copy-Item apps/monitor-demo/.env.example apps/monitor-demo/.env.local
```

必须填写 `VITE_MONITOR_PROJECT_ID`、`VITE_MONITOR_PROJECT_NAME` 和
`VITE_MONITOR_PUBLIC_KEY`；Demo 不再携带固定测试项目。然后构建 SDK 并启动 Demo：

```powershell
pnpm --dir packages/monitor-sdk install
pnpm --dir packages/monitor-sdk build
pnpm --dir apps/monitor-demo install
pnpm --dir apps/monitor-demo dev
```

访问 `http://127.0.0.1:5173`，可以逐项触发网络、行为、性能和错误场景。
`http://127.0.0.1:5173/?auto=1` 会自动运行基础场景，并在最后一批事件发送后销毁
Monitor，避免无人值守的测试页面持续采集。Vite 热更新也会销毁旧 Monitor 实例。

Demo 显式安装 `recordScreenPlugin()`；行为插件本身不再启动录屏。“自定义事件”场景通过
`monitor.addBreadcrumb()` 添加业务轨迹，再通过 `monitor.track()` 发送独立事件。先触发
Fetch、XHR、自定义场景，再触发 JavaScript 错误，可以在错误详情的 breadcrumbs 中检查
`http` 和 `custom`；测试按钮带有稳定的 `data-monitor-id`，点击不采集按钮文本。

页面显示“Go ingestion 已接通”只代表 SDK 的 Fetch 上报收到成功响应。页面退出时的
`sendBeacon` 不会向 JavaScript 暴露服务端响应，必须到 PostgreSQL 和 ClickHouse 中
确认最终写入结果。

### 页面卡顿场景

使用支持 `long-animation-frame` 的 Chrome / Edge，点击“主线程长任务”。Demo 阻塞约 180ms；`stabilityPlugins({ stutter: ... })` 用 120ms 门槛触发 LoAF 事件，等待 200ms 收集旁证后上报。该 Demo 将最小上报间隔设为 500ms，SDK 默认是 3 秒。

管理端事件流中应看到 `stability / stutter`：`payload.metrics.duration` 是 LoAF 慢帧耗时，`payload.diagnostics.source` 为 `long-animation-frame`，并尽力附带 `scripts`、`longTasks` 和 `rafGap`。旁证不保证每次都有，不应分别出现旧的 `longtask`、`raf_gap` 或 FPS 告警。不支持 LoAF 时该场景不会生成卡顿事件。

### React Profiler 场景

在 `pnpm dev` 的页面点击“触发渲染 +”，在事件流查看 `performance / react_render`。Demo 按 ID 累计 4 次提交或等待 700ms 后汇总，`payload.value` 是累计渲染耗时；`slowRenderCount` 使用 Demo 的 1ms 门槛，SDK 默认门槛是 16ms，不代表卡顿判定。

普通 React 生产构建默认关闭 profiling，所以当前 Demo 执行 `pnpm build` 后不会产生该事件；这不是上传失败。需要在生产环境采集时，应用必须使用 [React profiling 构建](https://react.dev/reference/react/Profiler#caveats)。独立的 `pnpm --dir packages/monitor-sdk test:browser:react` 会验证三种构建行为，不修改 Demo 的默认构建配置。

### AI 流式响应场景

点击流式请求按钮，Demo 持续读取 `/api/demo/chat` 的三段文本。`aiStreamPlugin` 的等待门槛配置为 500ms，默认 Demo 的 0 / 180 / 420ms 写入通常只产生一个 `ai / stream_metric`，不产生停顿事件。网络可能合并分片，因此 `chunkCount` 不保证等于服务端 write 次数。

在事件详情查看 `ttfb`、`ttft`、`ttlt`、`ttlb`、`totalBytes` 和 `endReason`。这些耗时使用浏览器响应和首 / 尾分片时刻近似测量，不是模型协议级的精确 token 计时；只有实际等待读取超过门槛才报告 `stream_stall`，暂停消费不报告。源码分工与完整边界见 SDK README 的“AI 流式响应”。

### 页面退出 Beacon 场景

使用唯一的 `runId` 打开以下地址：

```text
http://127.0.0.1:5173/?beacon=1&runId=beacon-check-001
```

页面会生成带有该 `runId` 的自定义事件，随后立即跳转到不加载 SDK 的
`beacon-complete.html`。Beacon 模式会临时提高批量阈值，让事件留到 `pagehide` 时再由
`navigator.sendBeacon` 发送。最终应在 ClickHouse 中看到该批次的 `send_type = 'beacon'`；
不要用普通页面上的成功状态判断 Beacon 是否落库。

## 验证

```powershell
pnpm --dir apps/monitor-demo check
pnpm --dir apps/monitor-demo build
```
