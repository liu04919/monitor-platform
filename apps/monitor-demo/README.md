# monitor-demo

`monitor-demo` 是浏览器 SDK 的本地联调应用，用来验证以下真实数据链路：

```text
React/Vite → minitor-sdk → Go ingestion → PostgreSQL → ClickHouse
```

应用通过 `link:../../packages/monitor-sdk` 使用当前仓库中的 SDK 构建产物，默认上报到
`http://127.0.0.1:8080/api/v1/events/batch`。

## 启动

先按照仓库根 README 启动数据库、执行迁移和 `devseed`，然后启动 Go 服务。SDK
需要先构建，再启动 Demo：

```powershell
pnpm --dir packages/monitor-sdk install
pnpm --dir packages/monitor-sdk build
pnpm --dir apps/monitor-demo install
pnpm --dir apps/monitor-demo dev
```

访问 `http://127.0.0.1:5173`，可以逐项触发网络、行为、性能和错误场景。
`http://127.0.0.1:5173/?auto=1` 会自动运行基础场景，并在最后一批事件发送后销毁
Monitor，避免无人值守的测试页面持续采集。Vite 热更新也会销毁旧 Monitor 实例。

页面显示“Go ingestion 已接通”只代表 SDK 的 Fetch 上报收到成功响应。页面退出时的
`sendBeacon` 不会向 JavaScript 暴露服务端响应，必须到 PostgreSQL 和 ClickHouse 中
确认最终写入结果。

## 验证

```powershell
pnpm --dir apps/monitor-demo check
pnpm --dir apps/monitor-demo build
```
