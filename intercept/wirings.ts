/**
 * The eight ways of faking the network, as configuration rather than as prose.
 *
 * ---------------------------------------------------------------------------
 * Why they are applied through a port
 * ---------------------------------------------------------------------------
 * Everything below takes a {@link RoutingContext} — three methods, structurally
 * satisfied by Playwright's `BrowserContext` and by the fake in
 * `wirings.test.ts`. That is not indirection for its own sake. A wiring is a
 * *decision about what to install*, and the decisions are where these eight
 * differ: which URLs they claim, what they do with a request they do not
 * recognise, whether they touch the connection state at all. All of that is
 * ordinary logic, and testing it by launching a browser would mean eight
 * browser runs to find out whether a glob has a typo in it.
 *
 * So `wirings.test.ts` asserts the installation, in milliseconds, against a
 * context that records calls; the specs assert what the *browser* then does,
 * which is the half only a browser can answer. Neither suite is a substitute
 * for the other, and the split is the same one `ct/README.md` argues for.
 *
 * ---------------------------------------------------------------------------
 * On `fallback()` as the default for an unrecognised request
 * ---------------------------------------------------------------------------
 * Two of these wirings hold a table of responses that does not cover
 * everything, and both hand an unrecognised request to `route.fallback()`
 * rather than failing it. That is what people write, and it is the reason the
 * `unrecorded-get` column exists: falling back is invisible while there is a
 * network behind it, and `severed` is what it looks like when there is not.
 */

/** The subset of Playwright's `Route` these wirings use. */
export interface RouteLike {
  request(): { url(): string; method(): string; postData(): string | null }
  fulfill(response: { status?: number; contentType?: string; body?: string }): Promise<void>
  abort(errorCode?: string): Promise<void>
  fallback(): Promise<void>
}

/** The subset of Playwright's `BrowserContext` these wirings use.
 *
 * `route` is declared as returning `Promise<unknown>` rather than
 * `Promise<void>`: Playwright resolves it with a `Disposable` that unroutes the
 * handler again, nothing here unroutes anything — a context lives for one cell
 * and is closed — and a port that insisted on `void` would simply not be
 * satisfied by the real thing.
 */
export interface RoutingContext {
  route(url: string, handler: (route: RouteLike) => Promise<void>): Promise<unknown>
  routeFromHAR(
    har: string,
    options: { url?: string; notFound?: 'abort' | 'fallback'; update?: boolean },
  ): Promise<void>
  setOffline(offline: boolean): Promise<void>
}

/** Everything a wiring needs from the run it is being installed into. */
export interface WiringOptions {
  /** Absolute path of the HAR to replay. */
  readonly harPath: string
}

/** One way of faking the network. */
export interface Wiring {
  readonly name: string
  /** What it is, in one line, in the words its `apply` is written in. */
  readonly summary: string
  /** Why somebody reaches for it. */
  readonly rationale: string
  readonly apply: (context: RoutingContext, options: WiringOptions) => Promise<void>
}

/** Every URL a `**\/api\/**` glob claims. Stated once so the table and the
 * globs cannot disagree, and so `wirings.test.ts` can assert on it. */
export const API_GLOB = '**/api/**'

/** The hand-written stub table, keyed by path.
 *
 * Four entries, and the gap is deliberate: `/api/notifications` is the
 * endpoint the app started calling after this table was written, which is the
 * situation the `unrecorded-get` probe is about. A table with no gap would
 * measure a fake nobody has ever actually had.
 */
export const STUB_BODIES: Readonly<Record<string, unknown>> = {
  '/api/profile': { source: 'stub', probe: 'profile', name: 'Stub Person' },
  '/api/feed': {
    source: 'stub',
    probe: 'feed',
    schema: 2,
    items: [{ id: 's1', title: 'Stubbed' }],
  },
  '/api/echo': { source: 'stub', probe: 'echo', echoed: 'STUBBED' },
  // Always 200, which is the whole point of the `retry-recovers` column: a
  // stub written from the happy path has no failure in it, so the retry the
  // client carries is never asked to do anything.
  '/api/flaky': { source: 'stub', probe: 'flaky', ok: true },
}

/**
 * The stub for a URL, or `null` when the table does not cover it.
 *
 * The query string is stripped before the lookup, so `?cb=7` gets the same
 * answer as no query at all. A hand-written table matches on the path because
 * a person wrote it about an endpoint; a recording matches on the URL because
 * a machine wrote it about a request. That difference is the `query-variance`
 * column, and it is visible here rather than hidden in a glob.
 */
export function stubFor(url: string): unknown | null {
  const path = new URL(url).pathname

  return STUB_BODIES[path] ?? null
}

const fulfillJson = (route: RouteLike, body: unknown): Promise<void> =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/**
 * Sever the browser's route to the network.
 *
 * Registered *before* a wiring's own handlers, which is what makes it a
 * backstop rather than a blanket: Playwright tries route handlers newest
 * first, so a wiring installed afterwards gets every request first and this
 * one receives only what the wiring declined — whether by not matching the URL
 * or by calling `fallback()`.
 *
 * It models a CI runner with no egress, and it models it at the browser rather
 * than by stopping the origin, so the specs can still ask the origin what it
 * was asked. `failed` is the error code Chromium reports for a host it cannot
 * reach.
 */
export async function severNetwork(context: RoutingContext): Promise<void> {
  await context.route('**/*', async (route) => {
    await route.abort('failed')
  })
}

export const WIRINGS = [
  {
    name: 'live',
    summary: 'Nothing is intercepted.',
    rationale:
      'The control. Every other row is only interesting as a difference from ' +
      'this one, and under `severed` it is the reason the other seven exist.',
    apply: async () => {
      // Deliberately empty: a control that installs something is not a control.
    },
  },
  {
    name: 'stub-fulfill',
    summary: "`route(API_GLOB)` answering from a hand-written table, `fallback()` for the rest.",
    rationale:
      'The fake people write first, because it needs no tooling and no ' +
      'recording. Its bodies are the ones the author imagined rather than the ' +
      'ones the origin sends.',
    apply: async (context) => {
      await context.route(API_GLOB, async (route) => {
        const body = stubFor(route.request().url())

        if (body === null) {
          await route.fallback()
          return
        }

        await fulfillJson(route, body)
      })
    },
  },
  {
    name: 'har-abort',
    summary: "`routeFromHAR(har, { url: API_GLOB, notFound: 'abort' })`.",
    rationale:
      'The recording, scoped to the API and closed: anything it does not hold ' +
      'fails. The honest HAR wiring, and the one whose failures are loud.',
    apply: async (context, options) => {
      await context.routeFromHAR(options.harPath, { url: API_GLOB, notFound: 'abort' })
    },
  },
  {
    name: 'har-fallback',
    summary: "`routeFromHAR(har, { url: API_GLOB, notFound: 'fallback' })`.",
    rationale:
      "Playwright's default, and one word apart from the row above. The word " +
      'decides whether a suite that has outgrown its recording tells you so or ' +
      'quietly resumes using the network.',
    apply: async (context, options) => {
      await context.routeFromHAR(options.harPath, { url: API_GLOB, notFound: 'fallback' })
    },
  },
  {
    name: 'har-whole-page',
    summary: "`routeFromHAR(har, { notFound: 'abort' })` — no URL filter.",
    rationale:
      'The same recording with the scope taken off, so the document and its ' +
      'stylesheet replay too. Almost nobody writes this one, and it is the only ' +
      'wiring here that is a complete offline replay of the application.',
    apply: async (context, options) => {
      await context.routeFromHAR(options.harPath, { notFound: 'abort' })
    },
  },
  {
    name: 'abort-api',
    summary: "`route(API_GLOB, route => route.abort('internetdisconnected'))`.",
    rationale:
      'What "simulate the network being down" usually means in a test suite. ' +
      'The error code is the one Chromium reports for a disconnected machine, ' +
      'which is as far as the resemblance goes.',
    apply: async (context) => {
      await context.route(API_GLOB, async (route) => {
        await route.abort('internetdisconnected')
      })
    },
  },
  {
    name: 'offline',
    summary: '`setOffline(true)`.',
    rationale:
      "Chromium's own offline emulation, which is a statement about the " +
      'connection rather than about any URL — and therefore the only wiring ' +
      'here the page can detect.',
    apply: async (context) => {
      await context.setOffline(true)
    },
  },
  {
    name: 'offline-har',
    summary: "`setOffline(true)` plus `routeFromHAR(har, { notFound: 'fallback' })`.",
    rationale:
      'The combination an offline-capable application actually needs: the page ' +
      'is told it is offline, and the requests it makes anyway are still ' +
      'answered, because a fulfilled route never touches the connection the ' +
      'emulation switched off.',
    apply: async (context, options) => {
      await context.setOffline(true)
      await context.routeFromHAR(options.harPath, { notFound: 'fallback' })
    },
  },
] as const satisfies readonly Wiring[]

export type WiringName = (typeof WIRINGS)[number]['name']

export const WIRING_NAMES: readonly WiringName[] = WIRINGS.map((wiring) => wiring.name)

export const wiringByName = (name: string): Wiring | undefined =>
  WIRINGS.find((wiring) => wiring.name === name)

/** The two conditions every wiring is measured under. */
export const CONDITIONS = ['connected', 'severed'] as const

export type Condition = (typeof CONDITIONS)[number]

export const CONDITION_NOTES: Readonly<Record<Condition, string>> = {
  connected:
    'The browser can reach the origin. Everything a wiring declines ends up ' +
    'on a socket, which is what makes a leaky fake invisible.',
  severed:
    'Every request the wiring declines is aborted before it leaves the ' +
    'browser — a runner with no egress, or a laptop on a train. The origin is ' +
    'still running, so the specs can still ask it what it was asked.',
}
