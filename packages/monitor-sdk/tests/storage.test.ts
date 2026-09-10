import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBatch, scopeFor } from '../src/transport/batch'
import { createConfig } from '../src/common/config'
import { transportOptions } from '../src/transport/types'
import { browser, event } from './helpers'

const config = createConfig({ appId: 'a', publicKey: 'key-a' })

beforeEach(() => {
  vi.resetModules()
  browser()
})

async function storage(options = transportOptions()) {
  const { QueueStorage } = await import('../src/transport/storage')
  return new QueueStorage(scopeFor(config), options)
}

describe('真实 IndexedDB 接口的队列事务', () => {
  it('已经删除的任务不会被迟到的失败结果重新插入', async () => {
    const queue = await storage()
    const task = createBatch(config, [event()])
    await queue.add(task)
    await queue.settle(task)
    await queue.settle(task, task)
    expect(await queue.claim('owner')).toBeUndefined()
  })
  it('记录写入后可以被新的存储实例读回', async () => {
    const first = await storage(),
      second = await storage()
    const task = createBatch(config, [event()])
    expect(await first.add(task)).toBe(true)
    expect(await second.claim('consumer')).toMatchObject({ id: task.id, body: task.body })
  })

  it('同一事务内限制条数与字节数，拒绝新任务不驱逐旧任务', async () => {
    const queue = await storage(transportOptions({ maxQueueTasks: 1 }))
    const first = createBatch(config, [event()])
    expect(await queue.add(first)).toBe(true)
    expect(await queue.add(createBatch(config, [event()]))).toBe(false)
    expect((await queue.claim('owner'))?.id).toBe(first.id)
    const bytes = await storage(transportOptions({ maxQueueBytes: first.bytes - 1 }))
    expect(await bytes.add(createBatch(config, [event()]))).toBe(false)
  })

  it('项目/地址/Key 不同不会消费对方的离线事件', async () => {
    const queue = await storage()
    await queue.add(createBatch(config, [event()]))
    const { QueueStorage } = await import('../src/transport/storage')
    for (const change of [{ appId: 'b' }, { publicKey: 'key-b' }, { url: '/other' }]) {
      const other = new QueueStorage(
        scopeFor(createConfig({ ...config, ...change })),
        transportOptions(),
      )
      expect(await other.claim('other')).toBeUndefined()
    }
  })

  it('并发 claim 只授予一个消费者，非持有者不能删除任务', async () => {
    const queue = await storage()
    const task = createBatch(config, [event()])
    await queue.add(task)
    const results = await Promise.all([queue.claim('a'), queue.claim('b')])
    expect(results.filter(Boolean)).toHaveLength(1)
    await queue.settle({ ...task, leaseOwner: 'wrong' })
    // 用持有者更新重试时间，随后仍可取到原任务。
    await queue.settle(results.find(Boolean)!, task)
    expect((await queue.claim('c'))?.id).toBe(task.id)
  })

  it('过期记录被清理，重新腾出队列额度', async () => {
    const queue = await storage(transportOptions({ maxQueueTasks: 1, maxQueueAgeMs: 100 }))
    const old = { ...createBatch(config, [event()]), createdAt: Date.now() - 1000 }
    await queue.add(old)
    expect(await queue.claim('owner')).toBeUndefined()
    expect(await queue.add(createBatch(config, [event()]))).toBe(true)
  })

  it('打开数据库失败后可以再次尝试，不缓存永久 rejected Promise', async () => {
    const queue = await storage()
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('temporary')
    })
    await expect(queue.add(createBatch(config, [event()]))).rejects.toThrow('temporary')
    open.mockRestore()
    expect(await queue.add(createBatch(config, [event()]))).toBe(true)
  })
})
