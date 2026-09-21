/**
 * Typed fetch wrapper for the Billing API.
 *
 * What it encodes so pages do not have to:
 *
 *  - `Authorization: Bearer <ses_key>` from the portal session, minted on demand,
 *    and one silent retry on 401 with a fresh key (a key can be revoked before
 *    its local expiry).
 *  - Company context (cmp_id, fy_id, bo_id) on every scoped call, as query
 *    parameters and — for JSON bodies — in the body too, which is what the
 *    backend's Http::param() reads.
 *  - The fleet's envelopes: `{data}`, `{data, meta}`, and errors as ApiError.
 */

import { getApiBaseUrl } from '../config'
import { ensureSesKey } from '../auth/portal'

export interface CompanyScope {
  cmp_id: number
  fy_id: number
  /** 0 = consolidated, all branches. */
  bo_id: number
}

export interface ListMeta {
  total: number
  limit: number
  offset: number
  [key: string]: unknown
}

export interface ListResponse<T> {
  data: T[]
  meta: ListMeta
}

export interface ItemResponse<T> {
  data: T
}

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /**
   * True when pressing the same button again could reasonably work.
   *
   * The backend says so explicitly for cross-service failures, because the
   * difference between "Books was unreachable" and "Books refused this" decides
   * whether the UI offers Retry or asks the user to change something.
   */
  get retryable(): boolean {
    if (typeof this.details.retryable === 'boolean') return this.details.retryable
    return this.status === 0 || this.status === 503 || this.status === 502
  }
}

/** The company scope, registered once by CompanyProvider and read by every call. */
let scope: CompanyScope | null = null

export function setScope(next: CompanyScope | null): void {
  scope = next
}

export function getScope(): CompanyScope | null {
  return scope
}

function buildUrl(path: string, params: QueryParams | undefined, scoped: boolean): string {
  const url = new URL(`${getApiBaseUrl()}/${path.replace(/^\//, '')}`, window.location.origin)

  if (scoped && scope) {
    url.searchParams.set('cmp_id', String(scope.cmp_id))
    url.searchParams.set('fy_id', String(scope.fy_id))
    url.searchParams.set('bo_id', String(scope.bo_id))
  }

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  params?: QueryParams
  body?: unknown
  /** Pass false for calls that take no company context. */
  scoped?: boolean
  signal?: AbortSignal
}

async function send<T>(path: string, options: RequestOptions, sesKey: string): Promise<T> {
  const scoped = options.scoped !== false
  const method = options.method ?? 'GET'

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${sesKey}`,
  }

  let body: string | undefined
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    // Context travels in the body as well: a POST that carries it only in the
    // query string works until someone reads the body first, and then fails in
    // a way that looks like the company was never chosen.
    const payload =
      scoped && scope && typeof options.body === 'object' && options.body !== null && !Array.isArray(options.body)
        ? { ...scope, ...(options.body as Record<string, unknown>) }
        : options.body
    body = JSON.stringify(payload)
  }

  const response = await fetch(buildUrl(path, options.params, scoped), {
    method,
    headers,
    body,
    signal: options.signal,
  })

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const envelope = parsed as
      | { error?: { code?: string; message?: string; details?: Record<string, unknown> }; message?: string }
      | null
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? 'error',
      envelope?.error?.message ?? envelope?.message ?? `Request failed (${response.status})`,
      envelope?.error?.details ?? {},
    )
  }

  return parsed as T
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const sesKey = await ensureSesKey()

  try {
    return await send<T>(path, options, sesKey)
  } catch (error) {
    // Exactly one retry, and only for 401: a key can be revoked server-side
    // before it expires locally, and making the user sign in again for that is
    // a bad trade. Anything else is the caller's to handle.
    if (error instanceof ApiError && error.status === 401) {
      const freshKey = await ensureSesKey(true)
      return await send<T>(path, options, freshKey)
    }
    throw error
  }
}

export const api = {
  get: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', params, signal }),

  list: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    request<ListResponse<T>>(path, { method: 'GET', params, signal }),

  one: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    request<ItemResponse<T>>(path, { method: 'GET', params, signal }),

  post: <T>(path: string, body?: unknown, params?: QueryParams) =>
    request<ItemResponse<T>>(path, { method: 'POST', body: body ?? {}, params }),

  put: <T>(path: string, body?: unknown, params?: QueryParams) =>
    request<ItemResponse<T>>(path, { method: 'PUT', body: body ?? {}, params }),

  del: <T>(path: string, params?: QueryParams) => request<ItemResponse<T>>(path, { method: 'DELETE', params }),

  /**
   * A file, fetched with the session key and handed to the browser.
   *
   * An <a download> cannot carry the Authorization header, and putting the
   * session key in a query string would write it into every proxy log between
   * here and the server. So the file is fetched like any other call and handed
   * over as a blob.
   */
  async download(path: string, params?: QueryParams): Promise<{ blob: Blob; filename: string }> {
    const sesKey = await ensureSesKey()
    const response = await fetch(buildUrl(path, params, true), {
      method: 'GET',
      headers: { Authorization: `Bearer ${sesKey}` },
    })

    if (!response.ok) {
      // An error body is JSON even when the happy path is a file.
      let envelope: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null
      try {
        envelope = JSON.parse(await response.text())
      } catch {
        envelope = null
      }
      throw new ApiError(
        response.status,
        envelope?.error?.code ?? 'error',
        envelope?.error?.message ?? `Could not build that file (${response.status})`,
        envelope?.error?.details ?? {},
      )
    }

    const disposition = response.headers.get('Content-Disposition') ?? ''
    const match = /filename="?([^";]+)"?/i.exec(disposition)

    return { blob: await response.blob(), filename: match?.[1] ?? 'export.csv' }
  },

  /**
   * A file, posted with the session key and the company scope.
   *
   * Content-Type is deliberately NOT set: the browser has to write the
   * multipart boundary itself, and setting it by hand produces a body the
   * server cannot take apart. The scope rides in the query string, which is
   * where it already goes for every other call — a multipart body is not JSON
   * and the backend's Http::param() reads the URL first for exactly this case.
   */
  async upload<T>(path: string, form: FormData, params?: QueryParams): Promise<ItemResponse<T>> {
    const send = async (sesKey: string): Promise<ItemResponse<T>> => {
      const response = await fetch(buildUrl(path, params, true), {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${sesKey}` },
        body: form,
      })

      const text = await response.text()
      let parsed: unknown = null
      if (text) {
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = null
        }
      }

      if (!response.ok) {
        const envelope = parsed as
          | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
          | null
        throw new ApiError(
          response.status,
          envelope?.error?.code ?? 'error',
          envelope?.error?.message ?? `That file was not accepted (${response.status})`,
          envelope?.error?.details ?? {},
        )
      }

      return parsed as ItemResponse<T>
    }

    const sesKey = await ensureSesKey()
    try {
      return await send(sesKey)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return await send(await ensureSesKey(true))
      }
      throw error
    }
  },

  /**
   * Context-free: the health check, the portal relay, and the company switcher.
   *
   * Takes a signal because the switcher pages through Manage and can be
   * unmounted mid-flight; without it those pages keep arriving and setting
   * state on a component that is gone.
   */
  unscoped: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', params, scoped: false, signal }),
}
