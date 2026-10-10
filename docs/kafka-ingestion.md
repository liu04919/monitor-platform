# Kafka 上报链路

第一版采用一个 Kafka KRaft 节点、一个单分区 Topic `telemetry-batches`、一个消费组 `telemetry-writer`。
一个 SDK 批次对应一条 Kafka 消息；Go HTTP 服务与 worker 是两个独立进程。

## 接收和消费

```text
SDK → HTTP 校验、项目 publicKey 验证
    → PostgreSQL Reserve：登记 pending，检查内容冲突
    → Kafka 发布并等待确认 → HTTP 202

Kafka → worker 获取消息
      → BatchStore.Save：指纹计算、账本防重、ClickHouse 写入、标记 completed
      → 提交消费位点
```

HTTP 保留原来的 `403 INVALID_PUBLIC_KEY`、`409 BATCH_ID_CONFLICT` 和重复批次响应。
`duplicate` 表示相同身份与内容已出现在账本中；`accepted` 不表示 ClickHouse 写入完成。
`pending` 只代表登记过，不能证明 Kafka 已接收，所以重复请求仍会发布并等待确认。
`completed` 才能直接返回重复成功。

生产者采用同步发送、`RequiredAcks=all`，消息 Key 为项目 ID 与批次 ID 的组合。
Topic 由 `kafka-init` 显式创建，禁止自动创建。第一版保持分区数量不变。
消费者通过 `FetchMessage` 获取消息，整个批次入库后调用 `CommitMessages`，不使用自动提交。
当前消息未完成处理和提交前，不处理下一条消息。

## 失败时发生什么

| 场景 | 行为 |
| --- | --- |
| PostgreSQL 登记失败 | 接口返回错误，不发布 |
| 登记成功，但 Kafka 发布失败或结果未知 | 接口返回错误；SDK 用原批次重试，允许重复发布 |
| worker 未启动 | 消息留在 Kafka，启动后从消费组位点继续 |
| 数据库暂时不可用 | 当前批次每秒重试，位点不前进 |
| 数据入库成功，但位点尚未提交就退出 | 重启后再次消费，批次账本防止重复入库 |
| 位点提交失败 | 重试提交，期间不处理下一条 |
| 消息格式非法或内容身份冲突 | 不提交该消息，worker 报错退出，保留 Topic/分区/位点供人工排查 |

没有新增 Outbox、自动补偿、死信队列或跨批次合并。登记后、发布前失败的请求仍依赖 SDK 重试，
服务端不会扫描 `pending` 自动恢复；账本也不保存事件正文。消费者仅重新检查消息结构，不重新验证已接收批次的 publicKey，
因此接收后轮换 key 不会丢弃已接手的事件。

最终写入继续依赖原有账本和 ClickHouse `insert_deduplication_token`。这是至少一次消费加业务防重，
不是跨 PostgreSQL、Kafka、ClickHouse 的事务。ClickHouse 写成功但账本完成失败的防重仍受 ClickHouse 去重窗口限制。

## 本地运行与观察

日常运行 `pnpm dev`，会一并启动 HTTP、worker、管理端和 Demo。
分别启动时，在根目录运行：

```cmd
docker compose up -d --wait postgres clickhouse redis kafka
docker compose run --rm kafka-init
go -C apps/server run ./cmd/migrate
```

然后在两个终端分别运行：

```cmd
pnpm dev:server
pnpm dev:worker
```

检查消费组进度（首次消费前组可能还不存在）：

```cmd
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group telemetry-writer
```

`CURRENT-OFFSET` 是已提交的下一条消息位置，`LOG-END-OFFSET` 是日志末尾，`LAG` 是尚未追上的消息数。
可以只停止 worker，继续在 Demo 上报，再启动 worker 观察积压消退。使用 `pnpm dev` 时任一进程退出会停止其他应用，
做这个实验应使用上述分别启动的命令。

默认 Go 连接 `localhost:9092`；容器内连接 `kafka:9092`。本地 Kafka 端口只绑定宿主机回环地址。
自定义端口时，需要同时调整 `.env` 的 `KAFKA_PORT` 和 `KAFKA_BROKERS`。
Topic 和消费组通过 `KAFKA_TELEMETRY_TOPIC`、`KAFKA_CONSUMER_GROUP` 配置；切换消费组会从保留日志的最早位置开始消费。

## 当前边界

- 单节点、单副本，数据卷保留重建容器后的日志，但不能抵御磁盘损坏；`acks=all` 在这里仍只代表一个副本。
- Topic 按 7 天保留策略清理日志，积压不能无限堆放；需观察消费延迟与磁盘空间。
- `/healthz` 仍是 HTTP 存活检查，不证明 worker 正常，也不检查 Kafka 积压。
- HTTP 启动仍需连接 PostgreSQL、ClickHouse 和 Redis，因为同一服务也提供管理查询；本轮没有拆分管理 API。
- 持续失败会阻塞当前消费循环；排查日志、恢复依赖或修复消息后再重启，不自动跳过数据。

## 代码阅读顺序

1. `internal/ingestion/queued_batch_store.go`：为什么 pending 批次也要重新发布。
2. `internal/queue/kafka/publisher.go`：发送确认、消息 Key 与超时。
3. `internal/queue/kafka/consumer.go`：先入库、后提交位点。
4. `internal/ingestion/batch_store.go`：原有指纹、账本与 ClickHouse 防重。
5. `internal/app/worker.go`、`cmd/worker/main.go`：组装、启动与退出。

实现依据：[kafka-go 的显式位点提交](https://github.com/segmentio/kafka-go#explicit-commits)、
[Kafka 入门](https://kafka.apache.org/quickstart/)。
