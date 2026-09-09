/**
 * The provider this repository's contracts are verified against.
 *
 * Until now there wasn't one. `users.provider.pact.verify.test.ts` was a
 * copy-me template pointed at `PROVIDER_BASE_URL` with every state handler
 * commented out, and it skipped itself whenever that variable was unset —
 * which was always. So the consumer half of contract testing was demonstrated
 * and the provider half was described, and the half that is described is the
 * half where contract testing actually fails: a consumer test passes against a
 * mock the consumer wrote, and says nothing about anybody's provider.
 *
 * This is a real HTTP service, small enough to read in one sitting and honest
 * enough to be worth verifying: routing, bearer auth, an in-memory store the
 * provider states mutate, and the eight responses the two consumer suites
 * describe. It is not a mock of a provider. Nothing here reads the pact file.
 *
 * ---------------------------------------------------------------------------
 * Changes as flags, not as copies
 * ---------------------------------------------------------------------------
 * `pipeline/` measures which contract-testing wiring notices which change, and
 * that needs a corpus of providers that differ from this one in exactly one
 * behaviour. Following `property/faults.ts` and `fuzz/faults.ts`, those are
 * flags on this single implementation rather than eight edited copies: a copy
 * drifts from the original until the fault is no longer the bug it claims to
 * be, with nothing to say so. {@link CORRECT} is the all-correct setting and
 * `app.test.ts` pins it — every response this file gives under `CORRECT` must
 * satisfy the real pact, so a change here fails the suite until the corpus
 * follows.
 *
 * One flag is deliberately *not* a fault. `extraUserField` adds a field the
 * consumer never asked for, which consumer-driven contract testing is supposed
 * to permit; it is in the corpus so that "the matrix is all-red because every
 * probe fails everything" is falsifiable rather than assumed.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** A user row as the store holds it. Serialisation is {@link serialiseUser}. */
export interface UserRow {
  readonly id: number
  readonly email: string
  readonly name: string
  readonly role: 'admin' | 'user' | 'moderator'
  readonly createdAt: string
  /** Not serialised. Compared verbatim — hashing is not what is being shown. */
  readonly password: string
}

/**
 * A JWT-shaped token built from readable words.
 *
 * The contract asks for three dot-separated base64url segments and nothing
 * else, so that is all this produces. Nothing here signs anything; a provider
 * that did would need a key, and a key in a fixture is the failure mode this
 * repository's secret scanning exists to catch.
 *
 * It is *computed* rather than written out, and that is the point rather than
 * a flourish. The first version of this file committed the two encoded strings
 * as literals, and GitGuardian flagged both as "Generic High Entropy Secret"
 * on the pull request. It was right to. The values are not secrets — they
 * decode to `mock-header`, `mock-payload` / `mock-refresh` and
 * `mock-signature` — but CLAUDE.md asks fixtures to *look* obviously fake, and
 * a base64 blob only looks fake to somebody who decodes it first. A scanner
 * cannot, a reviewer will not, and "that one is fine" is the habit that gets a
 * real credential waved through eventually. So the plaintext is what the
 * source shows and the encoding happens here; the strings produced are
 * byte-identical to the literals they replace, which `app.test.ts` checks by
 * decoding them.
 */
function mockJwt(payload: string): string {
  const segment = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
  return [segment('mock-header'), segment(payload), segment('mock-signature')].join('.')
}

export const MOCK_ACCESS_TOKEN = mockJwt('mock-payload')
export const MOCK_REFRESH_TOKEN = mockJwt('mock-refresh')

/** Seconds an access token is good for. Matches the contract's `integer(900)`. */
export const ACCESS_TOKEN_TTL_SECONDS = 900

// ---------------------------------------------------------------------------
// Behaviour flags
// ---------------------------------------------------------------------------

/**
 * One flag per single-behaviour change a provider team plausibly makes.
 *
 * Every field's correct value is `false`; {@link CORRECT} is the all-false
 * record. `pipeline/changes.ts` names each one and says which pipeline stage
 * is supposed to notice it.
 */
export interface ProviderFlags {
  /** Drop `role` from user responses. A field the consumer reads, deleted. */
  readonly omitUserRole: boolean
  /** Serialise `createdAt` as `created_at`. The rename that reads as cosmetic. */
  readonly snakeCaseCreatedAt: boolean
  /** Serialise `id` as a string. The change a JSON-column migration makes. */
  readonly stringifyUserId: boolean
  /**
   * Serialise `id` as a string that is not a number.
   *
   * Not a corpus row — no team ships this. It is the control for the finding
   * in `pipeline/README.md` that `stringifyUserId` is missed by every wiring:
   * with this flag the same interaction *fails*, which is what shows the miss
   * is the `integer` matcher coercing `"1"` rather than the response body
   * going unchecked. `coercion.test.ts` runs both.
   */
  readonly bogusUserId: boolean
  /** Add a field nobody asked for. Not a fault — see the file header. */
  readonly extraUserField: boolean
  /** Answer `POST /v1/users` with 200 rather than 201. */
  readonly createUserReturns200: boolean
  /** Emit `role: 'member'`, outside the enum the consumer matches on. */
  readonly renameUserRoleValue: boolean
  /** Require an `X-Scope` header the consumer has never sent. */
  readonly requireScopeHeader: boolean
  /** Stop routing `POST /v1/auth/logout`. The endpoint nobody thought was used. */
  readonly removeLogoutRoute: boolean
}

/** The setting under which this provider satisfies the contract. */
export const CORRECT: ProviderFlags = {
  omitUserRole: false,
  snakeCaseCreatedAt: false,
  stringifyUserId: false,
  bogusUserId: false,
  extraUserField: false,
  createUserReturns200: false,
  renameUserRoleValue: false,
  requireScopeHeader: false,
  removeLogoutRoute: false,
}

/** The scope `requireScopeHeader` demands. No consumer sends it. */
export const REQUIRED_SCOPE = 'users:write'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * The provider's database.
 *
 * In-memory and deliberately so: what provider verification exercises is the
 * provider's *HTTP surface* under a named state, and a real datastore here
 * would add a container to the critical path without changing a single
 * assertion. `containers/` is where this repository shows the other thing.
 */
export class UserStore {
  #users = new Map<number, UserRow>()
  #refreshTokens = new Set<string>()
  #nextId = 1

  reset(): void {
    this.#users.clear()
    this.#refreshTokens.clear()
    this.#nextId = 1
  }

  upsert(user: Omit<UserRow, 'createdAt'> & { createdAt?: string }): UserRow {
    const row: UserRow = {
      ...user,
      createdAt: user.createdAt ?? '2024-01-01T00:00:00.000Z',
    }
    this.#users.set(row.id, row)
    this.#nextId = Math.max(this.#nextId, row.id + 1)
    return row
  }

  insert(user: Omit<UserRow, 'id' | 'createdAt'>): UserRow {
    const row: UserRow = {
      ...user,
      id: this.#nextId,
      createdAt: '2024-01-02T00:00:00.000Z',
    }
    this.#users.set(row.id, row)
    this.#nextId += 1
    return row
  }

  byId(id: number): UserRow | undefined {
    return this.#users.get(id)
  }

  byEmail(candidate: string): UserRow | undefined {
    for (const user of this.#users.values()) if (user.email === candidate) return user
    return undefined
  }

  all(): readonly UserRow[] {
    return [...this.#users.values()].sort((a, b) => a.id - b.id)
  }

  delete(id: number): boolean {
    return this.#users.delete(id)
  }

  deleteByEmail(candidate: string): void {
    const existing = this.byEmail(candidate)
    if (existing) this.#users.delete(existing.id)
  }

  issueRefreshToken(token: string): void {
    this.#refreshTokens.add(token)
  }

  hasRefreshToken(token: string): boolean {
    return this.#refreshTokens.has(token)
  }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** The user representation the API returns, after {@link ProviderFlags}. */
export function serialiseUser(user: UserRow, flags: ProviderFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: flags.bogusUserId ? 'abc' : flags.stringifyUserId ? String(user.id) : user.id,
    email: user.email,
    name: user.name,
  }

  if (!flags.omitUserRole) {
    body['role'] = flags.renameUserRoleValue ? 'member' : user.role
  }

  const createdAtKey = flags.snakeCaseCreatedAt ? 'created_at' : 'createdAt'
  body[createdAtKey] = user.createdAt

  if (flags.extraUserField) {
    body['lastSeenAt'] = '2024-03-01T12:00:00.000Z'
  }

  return body
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** A started provider, and the two things a caller needs from it. */
export interface RunningProvider {
  /** Base URL, e.g. `http://127.0.0.1:41235`. No trailing slash. */
  readonly url: string
  /** The store the provider-state handlers mutate. */
  readonly store: UserStore
  /** Close the listener. Idempotent from the caller's point of view. */
  stop(): Promise<void>
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function unauthorised(res: ServerResponse, message: string): void {
  send(res, 401, { statusCode: 401, error: 'Unauthorized', message })
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

/**
 * Routes one request. Split out from the listener so the routing table is
 * readable as a table, and so `app.test.ts` can exercise it without a socket.
 */
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: UserStore,
  flags: ProviderFlags,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://provider.invalid')
  const path = url.pathname
  const method = req.method ?? 'GET'

  // ---- /v1/users*: bearer-authenticated ----------------------------------
  if (path.startsWith('/v1/users')) {
    const auth = req.headers.authorization
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      return unauthorised(res, 'Missing bearer token')
    }
    if (flags.requireScopeHeader && req.headers['x-scope'] !== REQUIRED_SCOPE) {
      return send(res, 403, {
        statusCode: 403,
        error: 'Forbidden',
        message: `Requires scope ${REQUIRED_SCOPE}`,
      })
    }

    const idMatch = /^\/v1\/users\/(\d+)$/.exec(path)

    if (method === 'GET' && idMatch) {
      const user = store.byId(Number(idMatch[1]))
      if (!user) return send(res, 404, { statusCode: 404, error: 'Not Found', message: 'No such user' })
      return send(res, 200, serialiseUser(user, flags))
    }

    if (method === 'DELETE' && idMatch) {
      const deleted = store.delete(Number(idMatch[1]))
      if (!deleted) return send(res, 404, { statusCode: 404, error: 'Not Found', message: 'No such user' })
      return send(res, 204)
    }

    if (method === 'GET' && path === '/v1/users') {
      const users = store.all()
      return send(res, 200, {
        data: users.map((user) => serialiseUser(user, flags)),
        meta: { cursor: 'next-cursor-token', hasMore: true, total: users.length },
      })
    }

    if (method === 'POST' && path === '/v1/users') {
      const body = await readJsonBody(req)
      const email = String(body['email'] ?? '')
      if (store.byEmail(email)) {
        return send(res, 409, { statusCode: 409, error: 'Conflict', message: 'Email already registered' })
      }
      const created = store.insert({
        email,
        name: String(body['name'] ?? ''),
        role: 'user',
        password: String(body['password'] ?? ''),
      })
      return send(res, flags.createUserReturns200 ? 200 : 201, serialiseUser(created, flags))
    }

    return send(res, 404, { statusCode: 404, error: 'Not Found', message: 'No such route' })
  }

  // ---- /v1/auth*: unauthenticated ----------------------------------------
  if (method === 'POST' && path === '/v1/auth/login') {
    const body = await readJsonBody(req)
    const user = store.byEmail(String(body['email'] ?? ''))
    if (!user || user.password !== String(body['password'] ?? '')) {
      return unauthorised(res, 'Invalid credentials')
    }
    store.issueRefreshToken(MOCK_REFRESH_TOKEN)
    return send(res, 200, {
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    })
  }

  if (method === 'POST' && path === '/v1/auth/refresh') {
    const body = await readJsonBody(req)
    if (!store.hasRefreshToken(String(body['refreshToken'] ?? ''))) {
      return unauthorised(res, 'Invalid refresh token')
    }
    return send(res, 200, {
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    })
  }

  if (method === 'POST' && path === '/v1/auth/logout' && !flags.removeLogoutRoute) {
    const body = await readJsonBody(req)
    if (!store.hasRefreshToken(String(body['refreshToken'] ?? ''))) {
      return unauthorised(res, 'Invalid refresh token')
    }
    return send(res, 204)
  }

  send(res, 404, { statusCode: 404, error: 'Not Found', message: 'No such route' })
}

/**
 * Starts the provider on an ephemeral port.
 *
 * Bound to 127.0.0.1 rather than `::` so that a verifier resolving `localhost`
 * to an address this listener is not on cannot turn a contract failure into a
 * connection refused — which is the same colour and a much worse message.
 */
export async function startProvider(flags: ProviderFlags = CORRECT): Promise<RunningProvider> {
  const store = new UserStore()

  const server: Server = createServer((req, res) => {
    handle(req, res, store, flags).catch((error: unknown) => {
      // A throw here is a bug in this file, not a contract failure. Say so in
      // the body: the verifier prints the response it got, and "Internal
      // Server Error" would send the reader looking at the pact.
      send(res, 500, {
        statusCode: 500,
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    store,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
