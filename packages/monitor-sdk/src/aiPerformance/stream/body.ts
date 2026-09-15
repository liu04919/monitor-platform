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

  let bodyController: ReadableStreamDefaultController<Uint8Array>
  let bodyEnded = false
  let readError: { reason: unknown } | undefined

  function failBody(error: unknown) {
    if (bodyEnded) return
    bodyEnded = true
    readError = { reason: error }
    measurement.finish('error', error)
    bodyController.error(error)
    safely(() => sourceReader.releaseLock())
  }

  // 业务读取一块，就从原始响应读取一块，统计后直接交还，不额外预读。
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        bodyController = controller
      },
      async pull(controller) {
        measurement.startWaiting()
        try {
          const chunk = await sourceReader.read()
          if (bodyEnded) return
          if (chunk.done) {
            bodyEnded = true
            measurement.finish('end')
            controller.close()
            sourceReader.releaseLock()
          } else {
            safely(() => measurement.chunk(chunk.value))
            controller.enqueue(chunk.value)
          }
        } catch (error) {
          failBody(error)
        } finally {
          measurement.stopWaiting()
        }
      },
      cancel(reason) {
        bodyEnded = true
        measurement.finish('cancel', reason)
        // 保留业务传入的 reason，并等待原始流的取消结果。
        return sourceReader.cancel(reason).finally(() => sourceReader.releaseLock())
      },
    },
    { highWaterMark: 0 },
  )

  // Response 准备完成后才锁定源流；准备失败时入口可直接返回原始响应。
  const wrapped = keepResponseMetadata(
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    response,
    () => readError,
  )
  const sourceReader = response.body.getReader()
  // 业务暂停读取时也能观察到断流，不必等下一次 read。
  void sourceReader.closed.catch(failBody)
  return wrapped
}
