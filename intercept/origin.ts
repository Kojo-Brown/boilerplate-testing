/**
 * The fixture origin, as a function rather than as a server.
 *
 * Everything this directory measures is a statement about what happens
 * *between* a browser and an origin, so there has to be an origin. It is small
 * on purpose — seven routes and two control endpoints — but two of its
 * properties are load-bearing and neither is decoration:
 *
 *   - **Every response says who produced it.** A JSON body carries
 *     `source: 'origin'`; a hand-written stub carries `source: 'stub'`. Without
 *     that stamp a replayed response and a real one are the same bytes, which
 *     is precisely the finding `README.md` opens with — the stamp is a
 *     measuring instrument, not something a real API would have.
 *   - **It has two versions.** `schema: 1` is what `har/origin.har` was
 *     recorded against; `schema: 2` is what it serves now. The drift is real
 *     data rather than a simulated condition, and `har.test.ts` fails if the
 *     committed recording ever stops being the older one.
 *
 * The routing lives here, with no `node:http` in sight, so it can be asserted
 * on by an ordinary unit test. `server.ts` binds it to a socket and is the only
 * file in this directory that opens one.
 */

/** The schema version the origin serves today. */
export const CURRENT_SCHEMA = 2

/** The schema version `har/origin.har` was recorded against. */
export const RECORDED_SCHEMA = 1

/** The port the fixture origin binds, and therefore the one baked into the HAR.
 *
 * Fixed rather than ephemeral, and that is forced: `page.routeFromHAR` matches
 * a request against a recorded entry by URL, and a URL contains a port. A
 * recording made against `localhost:0` would replay against nothing. 3111 to
 * sit clear of `ct/`'s bundler on 3100 and the application config's 5173.
 */
export const ORIGIN_PORT = 3111

/** The origin's base URL, as both the config and the recorder need it. */
export const ORIGIN_URL = `http://localhost:${ORIGIN_PORT}`

/** A response the origin is prepared to give. */
export interface OriginResponse {
  readonly status: number
  readonly contentType: string
  readonly body: string
}

/** A request, reduced to the three things any of these routes looks at. */
export interface OriginRequest {
  readonly method: string
  /** Path and query, exactly as it arrived — `/api/profile?cb=3`. */
  readonly url: string
  /** The request body, or `''` for a request that has none. */
  readonly body: string
}

/**
 * State the origin keeps between requests.
 *
 * Two fields, and both exist to be asked about from outside the browser.
 *
 * `log` is the request ledger. It is the only instrument that can tell a
 * replayed response from a real one — the bytes cannot, because a recording is
 * a copy of those bytes — and the specs read it over a socket of their own,
 * which no route handler is in a position to intercept.
 *
 * `flakyServed` makes `/api/flaky` fail the first request after a reset and
 * succeed every one after it. That is the only honest way to put a
 * first-attempt failure in front of a client retry: a client that decides when
 * to fail is testing its own mock.
 */
export interface OriginState {
  log: string[]
  flakyServed: boolean
}

export const createState = (): OriginState => ({ log: [], flakyServed: false })

/** The control endpoints, which exist for the specs and never for the page.
 *
 * Never requested through the browser, so they are absent from the recording
 * and no wiring has an opinion about them. `record.ts` uses `reset` for the
 * same reason the specs do, and neither ever navigates to one.
 */
export const CONTROL_PATHS = { log: '/__probe/log', reset: '/__probe/reset' } as const

const json = (value: unknown, status = 200): OriginResponse => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(value),
})

/**
 * The document.
 *
 * Deliberately inert: no inline script, one stylesheet, one element. Every
 * request this directory measures is issued by a spec through `page.evaluate`
 * rather than by the page itself, so that the *page* is never the reason a
 * probe did or did not fire. The stylesheet is the exception, and it is there
 * to be the one subresource a document load pulls in on its own — the
 * `static-asset` probe.
 */
const DOCUMENT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<title>intercept fixture</title>',
  '<link rel="stylesheet" href="/assets/app.css">',
  '</head>',
  '<body><main id="app">fixture</main></body>',
  '</html>',
  '',
].join('\n')

const STYLESHEET = '#app { color: rgb(17, 17, 17); }\n'

/** The feed's payload, which is the one thing that changed between versions.
 *
 * Not a cosmetic bump: at schema 1 an item is a string, at schema 2 it is an
 * object with a title. A consumer written against the recording does not merely
 * read a stale headline, it reads `undefined` — which is what makes a stale HAR
 * worth a column rather than a footnote.
 */
export function feedItems(schema: number): readonly unknown[] {
  return schema >= 2
    ? [{ id: 'a1', title: 'Analytical Engine' }, { id: 'a2', title: 'Note G' }]
    : ['Analytical Engine', 'Note G']
}

/**
 * Answer one request.
 *
 * `schema` is a parameter rather than a module constant so the recorder can
 * run the same routes at version 1 — `record.ts` is the only caller that passes
 * anything but {@link CURRENT_SCHEMA}.
 */
export function respond(
  request: OriginRequest,
  state: OriginState,
  schema: number = CURRENT_SCHEMA,
): OriginResponse {
  const [path = '/'] = request.url.split('?')

  // The control endpoints are answered before anything is written down: a
  // ledger that recorded the reads of itself would answer a different question
  // on the second look.
  if (request.method === 'GET' && path === CONTROL_PATHS.log) {
    return json({ log: [...state.log] })
  }

  if (request.method === 'POST' && path === CONTROL_PATHS.reset) {
    state.log.length = 0
    state.flakyServed = false
    return json({ reset: true })
  }

  // The query string is kept: `GET /api/profile` and `GET /api/profile?cb=7`
  // are two different requests, and the `reaches-origin` probe asks about
  // exactly one of them.
  state.log.push(`${request.method} ${request.url}`)

  if (request.method === 'GET' && path === '/') {
    return { status: 200, contentType: 'text/html; charset=utf-8', body: DOCUMENT }
  }

  if (request.method === 'GET' && path === '/assets/app.css') {
    return { status: 200, contentType: 'text/css', body: STYLESHEET }
  }

  if (request.method === 'GET' && path === '/api/profile') {
    // The query string is dropped on purpose: `?cb=…` is a cache-buster, the
    // origin answers the same either way, and whether the *fake* answers the
    // same way is the `query-variance` probe.
    return json({ source: 'origin', probe: 'profile', name: 'Ada Lovelace' })
  }

  if (request.method === 'GET' && path === '/api/feed') {
    return json({ source: 'origin', probe: 'feed', schema, items: feedItems(schema) })
  }

  if (request.method === 'GET' && path === '/api/notifications') {
    return json({ source: 'origin', probe: 'notifications', unread: 3 })
  }

  if (request.method === 'GET' && path === '/api/flaky') {
    if (!state.flakyServed) {
      state.flakyServed = true
      return json({ source: 'origin', probe: 'flaky', attempt: 'first', ok: false }, 503)
    }

    return json({ source: 'origin', probe: 'flaky', attempt: 'later', ok: true })
  }

  if (request.method === 'POST' && path === '/api/echo') {
    const word = readWord(request.body)

    return json({ source: 'origin', probe: 'echo', echoed: word.toUpperCase() })
  }

  return json({ source: 'origin', probe: 'none', error: 'no such route' }, 404)
}

/**
 * The `word` field of an echo request.
 *
 * Returns `''` for anything unparseable rather than throwing: the origin's job
 * in this directory is to be boring, and a fixture that 500s on a malformed
 * body would make a failed probe ambiguous between "the fake sent something
 * odd" and "the origin fell over".
 */
export function readWord(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)

    if (typeof parsed === 'object' && parsed !== null && 'word' in parsed) {
      const word = (parsed as { word: unknown }).word

      return typeof word === 'string' ? word : ''
    }
  } catch {
    return ''
  }

  return ''
}
