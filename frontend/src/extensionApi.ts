/**
 * Extension bridge: lets the page ask the NicheLens extension to make
 * authenticated XHS/Douyin API calls from inside the user's logged-in tab,
 * bypassing the server-IP blocks (-104 etc.) that hit our backend.
 *
 * The extension's bridge.js content script (injected on nichelens.ai) listens
 * for window.postMessage with `NICHELENS_FETCH` / `NICHELENS_PING` and replies
 * with `NICHELENS_FETCH_RESULT` / `NICHELENS_PONG`.
 */

export type ExtensionPlatform = 'xhs' | 'douyin'

export interface ExtensionFetchOptions {
  path: string
  method?: 'GET' | 'POST'
  params?: Record<string, string | number | undefined>
  body?: unknown
}

export interface ExtensionFetchResult<T = unknown> {
  ok: boolean
  status?: number
  body?: T
  error?: string
}

let extensionVersion: string | null = null
let detectionPromise: Promise<string | null> | null = null

function rid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Returns the extension version (string) or null if not installed. Cached. */
export function detectExtension(timeoutMs = 1500): Promise<string | null> {
  if (extensionVersion !== null) return Promise.resolve(extensionVersion)
  if (detectionPromise) return detectionPromise
  detectionPromise = new Promise(resolve => {
    const requestId = rid()
    const timer = setTimeout(() => {
      window.removeEventListener('message', listener)
      extensionVersion = ''
      resolve(null)
    }, timeoutMs)
    function listener(ev: MessageEvent) {
      if (ev.source !== window || !ev.data) return
      const { type, version, requestId: rid2 } = ev.data
      if (type === 'NICHELENS_PONG' && rid2 === requestId) {
        clearTimeout(timer)
        window.removeEventListener('message', listener)
        extensionVersion = version || ''
        resolve(version || '')
      } else if (type === 'NICHELENS_READY' && extensionVersion === null) {
        // Bridge announced itself before our ping was processed.
        clearTimeout(timer)
        window.removeEventListener('message', listener)
        extensionVersion = version || ''
        resolve(version || '')
      }
    }
    window.addEventListener('message', listener)
    window.postMessage({ type: 'NICHELENS_PING', requestId }, window.location.origin)
  })
  return detectionPromise
}

/** Send a fetch request through the extension. Resolves with the body or throws. */
export async function extensionFetch<T = unknown>(
  platform: ExtensionPlatform,
  opts: ExtensionFetchOptions,
  timeoutMs = 30000
): Promise<T> {
  const version = await detectExtension()
  if (!version) {
    throw new Error('NICHELENS_EXTENSION_NOT_FOUND')
  }
  return new Promise((resolve, reject) => {
    const requestId = rid()
    const timer = setTimeout(() => {
      window.removeEventListener('message', listener)
      reject(new Error('Extension fetch timeout'))
    }, timeoutMs)
    function listener(ev: MessageEvent) {
      if (ev.source !== window || !ev.data) return
      const { type, requestId: rid2, result } = ev.data
      if (type !== 'NICHELENS_FETCH_RESULT' || rid2 !== requestId) return
      clearTimeout(timer)
      window.removeEventListener('message', listener)
      if (!result || result.ok === false) {
        reject(new Error(result?.error || `HTTP ${result?.status || 0}`))
        return
      }
      resolve(result.body as T)
    }
    window.addEventListener('message', listener)
    window.postMessage(
      {
        type: 'NICHELENS_FETCH',
        requestId,
        platform,
        path: opts.path,
        method: opts.method || 'GET',
        params: opts.params,
        body: opts.body,
      },
      window.location.origin
    )
  })
}
