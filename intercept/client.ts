/**
 * The code that runs inside the page.
 *
 * Every function here is handed to `page.evaluate`, which serialises it and
 * evaluates the source in the browser. That imposes one rule the type checker
 * cannot: **a function in this file may not close over anything**. No imports,
 * no module constants, no helper defined beside it — the closure does not
 * travel, and a reference to something outside the function body is a
 * `ReferenceError` in the page rather than an error here. Everything a
 * function needs arrives as its single argument.
 *
 * The alternative was a bundled fixture application, and this is better for
 * the thing being measured: a request issued by `page.evaluate` is issued by
 * the page, goes through exactly the same routing, and is visible to
 * `page.on('request')` in exactly the same way — without a build step whose
 * own caching would become part of the result.
 */

/** What the page saw when it asked for something. */
export interface FetchOutcome {
  /** True when the request failed at the network layer — no response at all. */
  readonly failed: boolean
  /** The error `fetch` rejected with, for the failure cases. */
  readonly error: string
  readonly status: number
  /** The parsed JSON body, or `null` for a failure or a non-JSON response. */
  readonly body: unknown
}

/** What a retrying client saw, and how many attempts it took. */
export interface RetryOutcome extends FetchOutcome {
  readonly attempts: number
}

/** What the page believes about its connection. */
export interface ConnectionState {
  readonly onLine: boolean
  /** `offline` events seen since {@link watchConnection} was called. */
  readonly offlineEvents: number
  /** `online` events seen since {@link watchConnection} was called. */
  readonly onlineEvents: number
}

/** Where {@link watchConnection} keeps its counters, on the page's `window`. */
export const CONNECTION_COUNTER = '__interceptConnectionEvents'

/**
 * Issue one request and describe what came back.
 *
 * A rejected `fetch` is reported rather than thrown: "the request failed" is
 * an outcome this directory measures in eight different wirings, and a probe
 * that threw would make the spec's error handling the subject instead.
 */
export async function probeFetch(input: {
  url: string
  method: string
  body: string | null
}): Promise<FetchOutcome> {
  try {
    const response = await fetch(input.url, {
      method: input.method,
      ...(input.body === null
        ? {}
        : { body: input.body, headers: { 'content-type': 'application/json' } }),
    })

    let parsed: unknown = null

    try {
      parsed = (await response.json()) as unknown
    } catch {
      parsed = null
    }

    return { failed: false, error: '', status: response.status, body: parsed }
  } catch (error) {
    return {
      failed: true,
      error: error instanceof Error ? error.message : String(error),
      status: 0,
      body: null,
    }
  }
}

/**
 * Issue a request, and issue it once more if the first answer was a 5xx.
 *
 * One retry, no backoff, no jitter. The delay is what a production client
 * would add and what this measurement must not have: a `setTimeout` here would
 * be the only scheduler call in the directory and would buy nothing — the
 * question is whether the second attempt happens at all, not when.
 */
export async function probeFetchWithRetry(input: { url: string }): Promise<RetryOutcome> {
  let attempts = 0
  let last: {
    failed: boolean
    error: string
    status: number
    body: unknown
  } = { failed: true, error: 'never attempted', status: 0, body: null }

  while (attempts < 2) {
    attempts += 1

    try {
      const response = await fetch(input.url, { method: 'GET' })

      let parsed: unknown = null

      try {
        parsed = (await response.json()) as unknown
      } catch {
        parsed = null
      }

      last = { failed: false, error: '', status: response.status, body: parsed }

      if (response.status < 500) {
        break
      }
    } catch (error) {
      last = {
        failed: true,
        error: error instanceof Error ? error.message : String(error),
        status: 0,
        body: null,
      }
      break
    }
  }

  return { ...last, attempts }
}

/**
 * Start counting connection events.
 *
 * Installed before a wiring is applied, because `setOffline(true)` fires
 * `offline` at the moment it is called and a listener added afterwards would
 * miss the only event there is.
 */
export function watchConnection(counterKey: string): void {
  const store = { offline: 0, online: 0 }

  ;(globalThis as unknown as Record<string, unknown>)[counterKey] = store

  globalThis.addEventListener('offline', () => {
    store.offline += 1
  })
  globalThis.addEventListener('online', () => {
    store.online += 1
  })
}

/** Read `navigator.onLine` and the counters {@link watchConnection} installed. */
export function readConnection(counterKey: string): ConnectionState {
  const store = (globalThis as unknown as Record<string, unknown>)[counterKey] as
    | { offline: number; online: number }
    | undefined

  return {
    onLine: navigator.onLine,
    offlineEvents: store?.offline ?? 0,
    onlineEvents: store?.online ?? 0,
  }
}

/**
 * The colour the document's own stylesheet sets, as the page computed it.
 *
 * The one request in this directory the *page* makes rather than a spec, and
 * therefore the only way to ask whether a wiring reaches subresources. A
 * stylesheet that did not arrive leaves the element at the user-agent default,
 * which is a different string.
 */
export function readAppColour(selector: string): string {
  const element = document.querySelector(selector)

  return element === null ? '' : globalThis.getComputedStyle(element).color
}
