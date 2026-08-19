interface APIEnvelope<T> {
  data: T
}

interface APIErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

export async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/management-api/api/v1${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    let body: APIErrorEnvelope | undefined
    try {
      body = (await response.json()) as APIErrorEnvelope
    } catch {
      body = undefined
    }

    const fallback = response.status === 401
      ? '管理端鉴权失败，请确认 Go 服务和 Vite 使用了相同的 MANAGEMENT_API_TOKEN。'
      : `请求失败（HTTP ${response.status}）`
    throw new APIError(body?.error?.message || fallback, response.status, body?.error?.code)
  }

  return ((await response.json()) as APIEnvelope<T>).data
}
