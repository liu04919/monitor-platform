interface APIEnvelope<T> {
  data: T
}

interface APIErrorEnvelope {
  error?: {
    code?: string
    message?: string
    details?: {
      field?: string
    }
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

export async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJSON<T>(path, {
    headers: { Accept: 'application/json' },
    signal,
  })
}

export async function postJSON<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJSON<T>(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
}

export async function deleteRequest(path: string, signal?: AbortSignal): Promise<void> {
  await requestJSON<void>(path, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    signal,
  })
}

async function requestJSON<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...init,
  })

  if (!response.ok) {
    let body: APIErrorEnvelope | undefined
    try {
      body = (await response.json()) as APIErrorEnvelope
    } catch {
      body = undefined
    }

    const fallback = response.status === 401
      ? '登录状态已失效，请重新登录。'
      : `请求失败（HTTP ${response.status}）`
    throw new APIError(
      body?.error?.message || fallback,
      response.status,
      body?.error?.code,
      body?.error?.details?.field,
    )
  }

  if (response.status === 204) return undefined as T

  return ((await response.json()) as APIEnvelope<T>).data
}
