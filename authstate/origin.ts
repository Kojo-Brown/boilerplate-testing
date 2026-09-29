/**
 * The fixture origin: a session server with opinions, and no socket.
 *
 * Everything this directory measures is decided by two things — what a browser
 * hands back to `storageState()`, and what a server does when the same account
 * signs in twice. The first needs a real browser. The second needs a server
 * that behaves like the ones people actually deploy, and the behaviour that
 * matters is the one most fixture servers leave out: **an account has one live
 * session, and a new sign-in ends the old one.**
 *
 * That single rule is what makes `session-eviction` writable at all. A fixture
 * server that mints an independent token per login cannot express it, so a
 * suite measured against one reports every auth strategy as equally safe — and
 * the whole reason teams reach for `storageState` is that theirs is not.
 *
 * The routes are here and the socket is in `server.ts`, for the same reason
 * `intercept/` splits the two: `respond` is a pure function of a request and a
 * state object, so the routing table is checked by `origin.test.ts` in the unit
 * run rather than through a port.
 *
 * There is one exception to the purity, and it is deliberate: `/api/barrier`
 * cannot answer from state alone, because its answer is "not until the other
 * worker gets here". It returns a `park` rather than a body, and `server.ts`
 * holds the socket open. That is how the isolation runs order two workers
 * against each other without a sleep — see `barriers` below.
 */

/** The port `server.ts` binds when nothing overrides it. */
export const ORIGIN_PORT = 41_733

/** Where the browser half points. */
export const ORIGIN_URL = `http://127.0.0.1:${ORIGIN_PORT}`

/** The cookie the server sets, and the only credential a page script cannot read. */
export const SESSION_COOKIE = 'authstate_sid'

/** Where the fixture application keeps its token, in each of the three places it keeps it. */
export const TOKEN_KEY = 'authstate.token'

/** The IndexedDB database, store and key the `/app/idb` page reads. */
export const IDB = { database: 'authstate', store: 'session', key: 'token' } as const

/** The password every fixture account has. Obviously not a real one. */
export const FIXTURE_PASSWORD = 'not-a-real-password'

/** A signed-in account, as the server knows it. */
export interface Account {
  readonly email: string
  /**
   * The one live session. `null` once it has been evicted or signed out.
   *
   * One field rather than a set is the whole behavioural claim: a second
   * login overwrites it, and the token it replaces stops working.
   */
  sessionId: string | null
  /** Notes written by whoever was holding this account's session. */
  notes: string[]
}

/** A worker's row in the ledger the isolation runs read back. */
export interface LedgerRow {
  readonly [key: string]: string | number | boolean | null
}

/** Everything one origin remembers. */
export interface OriginState {
  readonly accounts: Map<string, Account>
  /** Session id → account email, so a cookie or bearer token resolves in one lookup. */
  readonly sessions: Map<string, string>
  /** Rows posted by the fixture suites, in arrival order. */
  readonly ledger: LedgerRow[]
  /** How many times `/api/login` has been answered, which is the cost column. */
  logins: number
  /** Monotonic counter behind session ids; see `nextSession`. */
  counter: number
  /** Named barriers, each holding the requests parked on it. */
  readonly barriers: Map<string, BarrierState>
}

/** One named barrier: how many parties it waits for, and who is already here. */
export interface BarrierState {
  readonly parties: number
  /** Resolvers for the requests currently parked, in arrival order. */
  readonly waiting: (() => void)[]
}

export function createState(): OriginState {
  return {
    accounts: new Map(),
    sessions: new Map(),
    ledger: [],
    logins: 0,
    counter: 0,
    barriers: new Map(),
  }
}

/**
 * Session ids come from a counter, not from `randomUUID`.
 *
 * A random id would make every failure message different from the last one and
 * would put this directory in `determinism/registry.ts` for no benefit: nothing
 * here is measuring entropy, and a test that reports `session-3` is one a
 * reader can follow through a ledger.
 */
function nextSession(state: OriginState): string {
  state.counter += 1

  return `session-${state.counter}`
}

/** What `respond` hands back to whatever is holding the socket. */
export type OriginResponse =
  | {
      readonly kind: 'body'
      readonly status: number
      readonly headers: Readonly<Record<string, string>>
      readonly body: string
    }
  | {
      /** Hold the socket; `release` settles when the barrier opens. */
      readonly kind: 'park'
      readonly release: Promise<void>
      readonly status: number
      readonly headers: Readonly<Record<string, string>>
      readonly body: string
    }

/** A request, reduced to the parts any of these routes looks at. */
export interface OriginRequest {
  readonly method: string
  readonly url: string
  readonly body: string
  readonly headers: Readonly<Record<string, string | undefined>>
}

const json = (status: number, payload: unknown): OriginResponse => ({
  kind: 'body',
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(payload),
})

const html = (status: number, body: string): OriginResponse => ({
  kind: 'body',
  status,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  body,
})

/** Read one cookie out of a `Cookie:` header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) {
    return null
  }

  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')

    if (index === -1) {
      continue
    }

    if (pair.slice(0, index).trim() === name) {
      return pair.slice(index + 1).trim()
    }
  }

  return null
}

/** Read a bearer token out of an `Authorization:` header. */
export function readBearer(header: string | undefined): string | null {
  if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
    return null
  }

  const token = header.slice('bearer '.length).trim()

  return token === '' ? null : token
}

/**
 * Resolve a request to an account, by cookie or by bearer token.
 *
 * Both credentials are the same session id, which is the fixture application's
 * design and not an accident: it is what lets one probe ask "is this session
 * alive" without first deciding which of the two survived `storageState`.
 */
export function authenticate(state: OriginState, request: OriginRequest): Account | null {
  const sessionId =
    readCookie(request.headers['cookie'], SESSION_COOKIE) ??
    readBearer(request.headers['authorization'])

  if (sessionId === null) {
    return null
  }

  const email = state.sessions.get(sessionId)

  return email === undefined ? null : (state.accounts.get(email) ?? null)
}

/** Find or provision an account. Accounts are created on first login. */
function accountFor(state: OriginState, email: string): Account {
  const existing = state.accounts.get(email)

  if (existing !== undefined) {
    return existing
  }

  const created: Account = { email, sessionId: null, notes: [] }

  state.accounts.set(email, created)

  return created
}

/**
 * Sign in, evicting whatever session the account was already holding.
 *
 * The eviction is the point. `state.sessions.delete` is what makes the previous
 * token — the one some other worker may have saved to `.auth/` thirty seconds
 * ago — answer 401 rather than carrying on working.
 */
export function login(state: OriginState, email: string): { sessionId: string } {
  const account = accountFor(state, email)

  if (account.sessionId !== null) {
    state.sessions.delete(account.sessionId)
  }

  const sessionId = nextSession(state)

  account.sessionId = sessionId
  state.sessions.set(sessionId, email)
  state.logins += 1

  return { sessionId }
}

/**
 * Arrive at a named barrier.
 *
 * Returns a promise that settles when `parties` requests have arrived. This is
 * the only asynchrony in the origin, and it exists so that two Playwright
 * workers can be ordered against each other without a sleep: worker A cannot
 * ask "has my session been evicted" until worker B has had its chance to evict
 * it, and "has had its chance" is a rendezvous rather than a duration.
 *
 * A barrier that never fills would hang the run, so `server.ts` gives each
 * parked request a deadline and answers `504` — a loud failure with the
 * barrier's name in it, rather than a suite that times out somewhere else.
 */
export function arriveAtBarrier(state: OriginState, name: string, parties: number): Promise<void> {
  const barrier = state.barriers.get(name) ?? { parties, waiting: [] }

  state.barriers.set(name, barrier)

  if (barrier.parties !== parties) {
    return Promise.reject(
      new Error(
        `Barrier "${name}" was opened for ${barrier.parties} parties and then joined for ${parties}. ` +
          'Every party must agree on the count, or the barrier cannot say when it is full.',
      ),
    )
  }

  const parked = new Promise<void>((resolve) => barrier.waiting.push(resolve))

  if (barrier.waiting.length >= barrier.parties) {
    for (const release of barrier.waiting.splice(0)) {
      release()
    }
  }

  return parked
}

const PAGE_HEAD =
  '<!doctype html><meta charset="utf-8"><title>authstate fixture</title>' +
  '<body><h1 id="heading">authstate</h1><p id="state" data-state="pending">pending</p>'

/**
 * The three gate pages.
 *
 * They exist because "is the session restored" has three different answers in
 * the same browser, depending on where the application looks — and which of the
 * three an application is decides whether the canonical `storageState` recipe
 * works for it. Each page renders `signed-in` or `signed-out` into one element,
 * so a probe is one `getAttribute` rather than a screenshot.
 *
 * `/app/server` is the server's answer: it reads the cookie and renders the
 * verdict into the HTML, with no script at all.
 * `/app/spa` is the token-in-`localStorage` answer, the shape most single-page
 * applications have.
 * `/app/idb` is the IndexedDB answer, which is Firebase Authentication's and a
 * growing number of SDKs'.
 */
function gatePage(state: OriginState, request: OriginRequest, which: 'server' | 'spa' | 'idb'): OriginResponse {
  if (which === 'server') {
    const account = authenticate(state, request)
    const verdict = account === null ? 'signed-out' : 'signed-in'

    return html(
      200,
      `${PAGE_HEAD}<p id="gate" data-gate="${verdict}">${verdict}</p>` +
        `<p id="who">${account?.email ?? ''}</p>`,
    )
  }

  // The two client-side gates share everything but where they read the token,
  // so the read is the only thing that differs between these two scripts.
  const read =
    which === 'spa'
      ? `async () => localStorage.getItem(${JSON.stringify(TOKEN_KEY)})`
      : `() => new Promise((resolve) => {
           const open = indexedDB.open(${JSON.stringify(IDB.database)}, 1)
           open.onupgradeneeded = () => open.result.createObjectStore(${JSON.stringify(IDB.store)})
           open.onerror = () => resolve(null)
           open.onsuccess = () => {
             const db = open.result
             const read = db.transaction(${JSON.stringify(IDB.store)}, 'readonly')
               .objectStore(${JSON.stringify(IDB.store)})
               .get(${JSON.stringify(IDB.key)})
             read.onerror = () => resolve(null)
             read.onsuccess = () => resolve(typeof read.result === 'string' ? read.result : null)
           }
         })`

  return html(
    200,
    `${PAGE_HEAD}<p id="gate" data-gate="pending">pending</p><p id="who"></p>` +
      `<script type="module">
         const token = await (${read})()
         const gate = document.getElementById('gate')
         const who = document.getElementById('who')

         if (token === null) {
           gate.dataset.gate = 'signed-out'
           gate.textContent = 'signed-out'
         } else {
           // A token that no longer resolves is signed-out too: a gate that
           // trusted the presence of a string would report an evicted session
           // as a live one, which is the failure this whole directory is about.
           const response = await fetch('/api/me', { headers: { authorization: 'Bearer ' + token } })
           const ok = response.status === 200
           gate.dataset.gate = ok ? 'signed-in' : 'signed-out'
           gate.textContent = gate.dataset.gate
           who.textContent = ok ? (await response.json()).email : ''
         }
       </script>`,
  )
}

/**
 * The sign-in page, which is what the `ui-login` wiring drives.
 *
 * It writes the token to all three client-side stores on success. That is not
 * how a careful application would be written — it is how this one is written on
 * purpose, so that a single login populates every location a capture wiring
 * might or might not preserve, and the matrix reports what `storageState` kept
 * rather than what the page happened to set.
 */
function loginPage(): OriginResponse {
  return html(
    200,
    `${PAGE_HEAD}
     <form id="login">
       <input id="email" name="email" value="" />
       <input id="password" name="password" type="password" value="" />
       <button id="submit" type="submit">sign in</button>
     </form>
     <script type="module">
       document.getElementById('login').addEventListener('submit', async (event) => {
         event.preventDefault()
         const email = document.getElementById('email').value
         const password = document.getElementById('password').value
         const response = await fetch('/api/login', {
           method: 'POST',
           headers: { 'content-type': 'application/json' },
           body: JSON.stringify({ email, password }),
         })

         if (response.status !== 200) {
           document.getElementById('state').dataset.state = 'failed'
           return
         }

         const { token } = await response.json()

         localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, token)
         sessionStorage.setItem(${JSON.stringify(TOKEN_KEY)}, token)

         await new Promise((resolve, reject) => {
           const open = indexedDB.open(${JSON.stringify(IDB.database)}, 1)
           open.onupgradeneeded = () => open.result.createObjectStore(${JSON.stringify(IDB.store)})
           open.onerror = () => reject(open.error)
           open.onsuccess = () => {
             const write = open.result.transaction(${JSON.stringify(IDB.store)}, 'readwrite')
               .objectStore(${JSON.stringify(IDB.store)})
               .put(token, ${JSON.stringify(IDB.key)})
             write.onerror = () => reject(write.error)
             write.onsuccess = () => resolve()
           }
         })

         document.getElementById('state').dataset.state = 'signed-in'
       })
     </script>`,
  )
}

/** Parse a JSON body, returning `null` rather than throwing on rubbish. */
function parseBody(body: string): Record<string, unknown> | null {
  if (body.trim() === '') {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(body)

    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The routing table.
 *
 * A plain `switch` over method and pathname rather than a framework: the whole
 * point of `origin.test.ts` being a unit test is that this function reaches
 * nothing, and a router with middleware would be a second thing to be right
 * about in a directory whose subject is somewhere else entirely.
 */
export function respond(state: OriginState, request: OriginRequest): OriginResponse {
  const url = new URL(request.url, ORIGIN_URL)
  const path = url.pathname
  const { method } = request

  if (method === 'GET' && (path === '/' || path === '/login')) {
    return loginPage()
  }

  if (method === 'GET' && path === '/app/server') {
    return gatePage(state, request, 'server')
  }

  if (method === 'GET' && path === '/app/spa') {
    return gatePage(state, request, 'spa')
  }

  if (method === 'GET' && path === '/app/idb') {
    return gatePage(state, request, 'idb')
  }

  if (method === 'POST' && path === '/api/login') {
    const body = parseBody(request.body)
    const email = typeof body?.['email'] === 'string' ? body['email'] : null
    const password = typeof body?.['password'] === 'string' ? body['password'] : null

    if (email === null || email === '' || password !== FIXTURE_PASSWORD) {
      return json(401, { error: 'bad-credentials' })
    }

    const { sessionId } = login(state, email)

    return {
      kind: 'body',
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        // `HttpOnly` is load-bearing: it is what makes this cookie unreadable
        // to every script in the fixture application, and therefore the one
        // credential no page-level workaround could have saved by hand.
        'set-cookie': `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
      },
      body: JSON.stringify({ token: sessionId, email }),
    }
  }

  if (method === 'GET' && path === '/api/me') {
    const account = authenticate(state, request)

    return account === null
      ? json(401, { error: 'no-session' })
      : json(200, { email: account.email })
  }

  if (path === '/api/notes') {
    const account = authenticate(state, request)

    if (account === null) {
      return json(401, { error: 'no-session' })
    }

    if (method === 'GET') {
      return json(200, { email: account.email, notes: [...account.notes] })
    }

    if (method === 'POST') {
      const body = parseBody(request.body)
      const note = typeof body?.['note'] === 'string' ? body['note'] : null

      if (note === null) {
        return json(400, { error: 'no-note' })
      }

      account.notes.push(note)

      return json(200, { email: account.email, notes: [...account.notes] })
    }
  }

  if (method === 'POST' && path === '/api/ledger') {
    const body = parseBody(request.body)

    if (body === null) {
      return json(400, { error: 'bad-row' })
    }

    state.ledger.push(body as LedgerRow)

    return json(200, { rows: state.ledger.length })
  }

  if (method === 'GET' && path === '/api/ledger') {
    return json(200, { rows: [...state.ledger], logins: state.logins })
  }

  if (method === 'POST' && path === '/api/reset') {
    state.accounts.clear()
    state.sessions.clear()
    state.ledger.length = 0
    state.barriers.clear()
    state.logins = 0
    state.counter = 0

    return json(200, { reset: true })
  }

  if (method === 'GET' && path === '/api/barrier') {
    const name = url.searchParams.get('name')
    const parties = Number(url.searchParams.get('parties'))

    if (name === null || !Number.isInteger(parties) || parties < 1) {
      return json(400, { error: 'bad-barrier' })
    }

    return {
      kind: 'park',
      release: arriveAtBarrier(state, name, parties),
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ barrier: name, parties }),
    }
  }

  return json(404, { error: 'no-route', path })
}
