# 服务端 package 边界

`internal` 按 Go package 的职责组织，而不是为每个概念新建目录：

- `auth`、`project`、`telemetry`、`ingestion`、`event`、`issue` 提供核心能力与调用方所需接口。
- `transport/http` 负责 HTTP 解码、响应、路由和中间件，不承载业务规则。
- `storage` 按 PostgreSQL、ClickHouse、Redis 组织外部存储实现。
- `queue/kafka` 实现批次发布和顺序消费；生产者等待确认，消费者入库后手动提交位点。
- `app` 是组合根，负责创建实现、注入依赖和释放资源。
- `config`、`database`、`migration` 提供运行时基础设施。

依赖方向保持为：

```text
transport/http ──→ 核心能力包 ←── storage
                         ↑
                        app 负责组装全部实现
```

核心能力包不导入 `transport/http` 或 `storage`。只有在一个概念形成独立依赖边界、能够单独使用时，
才为它创建新的 package；同一能力内部优先通过多个聚焦文件拆分。

`cmd/server` 使用 `ingestion.NewQueuedBatchStore` 检查批次并发布消息；`cmd/worker` 使用
`ingestion.NewBatchStore` 完成指纹计算、防重和数据库写入。两者共享批次内容哈希与账本，
核心业务包不依赖 Kafka 客户端。队列的具体组装分别在 `app/app.go` 与 `app/worker.go`。
