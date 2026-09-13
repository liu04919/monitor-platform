import { safely } from '../../common/safe'
import type { StreamMeasurement } from './measurement'

// new Response 不会继承这三个属性；普通 clone() 也需要带上同一份响应元信息。
function keepResponseMetadata(
  target: Response,
  source: Pick<Response, 'url' | 'type' | 'redirected'>,
  getReadError: () => { reason: unknown } | undefined,
): Response {
  const metadata = { url: source.url, type: source.type, redirected: source.redirected }
  Object.defineProperties(target, {
    url: { configurable: true, value: metadata.url },
    type: { configurable: true, value: metadata.type },
    redirected: { configurable: true, value: metadata.redirected },
    clone: {
      configurable: true,
      value(this: Response) {
        return keepResponseMetadata(Response.prototype.clone.call(this), metadata, getReadError)
      },
    },
  })
  // Chromium 对自建 Response 的消费方法可能把源流 AbortError 改成 TypeError。
  // 只还原本次读取遇到的源错误；重复消费、锁冲突、JSON 解析等错误仍交给原生方法。
  for (const method of ['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes'] as const) {
    const read = target[method] as (() => Promise<unknown>) | undefined
    if (!read) continue
    Object.defineProperty(target, method, {
      configurable: true,
      value(this: Response) {
        const canRead = this === target && !this.bodyUsed && !this.body?.locked
        const result = read.call(this)
        if (!canRead) return result
        return result.catch((error: unknown) => {
          const failure = getReadError()
          if (error instanceof TypeError && failure) throw failure.reason
          throw error
        })
      },
    })
  }
  return target
}

export function observeStreamResponse(
  response: Response,
  measurement: StreamMeasurement,
): Response {
  // opaque/error、已使用或被别处锁定的响应不能重新包装。
  if (!response.body || response.status === 0 || response.bodyUsed || response.body.locked) {
    measurement.dispose()
    return response
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      safely(() => measurement.chunk(chunk))
      controller.enqueue(chunk)
    },
  })
  const transformWriter = transform.writable.getWriter()
  const transformReader = transform.readable.getReader()
  let sourceReader: ReadableStreamDefaultReader<Uint8Array>
  let bodyController: ReadableStreamDefaultController<Uint8Array>
  let bodyEnded = false
  let isPulling = false
  let readError: { reason: unknown } | undefined

  function releaseLocks() {
    safely(() => sourceReader.releaseLock())
    safely(() => transformReader.releaseLock())
    safely(() => transformWriter.releaseLock())
  }

  function failBody(error: unknown) {
    if (bodyEnded) return
    bodyEnded = true
    readError = { reason: error }
    measurement.finish('error', error)
    bodyController.error(error)
    safely(() => transformReader.cancel(error))
    if (!isPulling) releaseLocks()
  }

  // 取消或释放锁会拒绝 closed；错误通过 pull / 原始 reader 统一处理。
  void transformReader.closed.catch(() => {})
  void transformWriter.closed.catch(() => {})

  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        bodyController = controller
      },
      async pull(controller) {
        isPulling = true
        measurement.startWaiting()
        try {
          const chunk = await sourceReader.read()
          measurement.stopWaiting()
          if (bodyEnded) return
          if (chunk.done) {
            await transformWriter.close()
            if (bodyEnded) return
            bodyEnded = true
            measurement.finish('end')
            controller.close()
            return
          }
          // 先写入 Transform，同时读取它的输出，避免背压下等待 write 导致死锁。
          // 不用 pipeThrough 自动泵送：业务请求下一块时才读取上游。
          const writeTask = transformWriter.write(chunk.value)
          const readTask = transformReader.read()
          const results = await Promise.all([writeTask, readTask])
          const transformedChunk = results[1]
          if (!bodyEnded && !transformedChunk.done) controller.enqueue(transformedChunk.value)
        } catch (error) {
          failBody(error)
        } finally {
          measurement.stopWaiting()
          isPulling = false
          if (bodyEnded) releaseLocks()
        }
      },
      cancel(reason) {
        bodyEnded = true
        measurement.finish('cancel', reason)
        safely(() => transformReader.cancel(reason))
        // 保留业务取消的 reason 和原始取消结果，不在 SDK 销毁时执行这里。
        return sourceReader.cancel(reason).finally(() => {
          if (!isPulling) releaseLocks()
        })
      },
    },
    { highWaterMark: 0 },
  )

  try {
    // 所有可能失败的 Response 准备都放在锁定源流之前，失败可安全返回原响应。
    const wrapped = keepResponseMetadata(
      new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      response,
      () => readError,
    )
    sourceReader = response.body.getReader()
    // 即使业务暂停读取，原始流报错也能收尾，不必等错误穿过 Transform。
    void sourceReader.closed.catch(failBody)
    return wrapped
  } catch (error) {
    releaseLocks()
    throw error
  }
}
