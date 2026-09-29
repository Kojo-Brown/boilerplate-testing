/**
 * The fixture origin's routing table, checked without a port.
 *
 * `respond` is a pure function of a state object and a request, so everything
 * the origin promises the two measurements can be asserted here rather than
 * over a socket. That matters more than tidiness: if the eviction rule were
 * wrong, `session-eviction` would read `survives` for every strategy and the
 * isolation table would be a table about nothing. These are the tests that say
 * the instrument works before the measurement is believed.
 */

import { describe, expect, it } from 'vitest'

import {
  arriveAtBarrier,
  authenticate,
  createState,
  FIXTURE_PASSWORD,
  login,
  readBearer,
  readCookie,
  respond,
  SESSION_COOKIE,
  type OriginRequest,
  type OriginState,
} from './origin.ts'

const request = (
  method: string,
  url: string,
  overrides: Partial<OriginRequest> = {},
): OriginRequest => ({ method, url, body: '', headers: {}, ...overrides })

const signIn = (state: OriginState, email: string): string =>
  (
    JSON.parse(
      (
        respond(
          state,
          request('POST', '/api/login', {
            body: JSON.stringify({ email, password: FIXTURE_PASSWORD }),
          }),
        ) as { body: string }
      ).body,
    ) as { token: string }
  ).token

const withToken = (method: string, url: string, token: string, body = ''): OriginRequest =>
  request(method, url, { body, headers: { authorization: `Bearer ${token}` } })

describe('cookie and bearer parsing', () => {
  it('finds a named cookie among several', () => {
    expect(readCookie('a=1; authstate_sid=session-7; b=2', SESSION_COOKIE)).toBe('session-7')
  })

  it('returns null when the header is absent', () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull()
  })

  it('returns null for a cookie header with no pairs in it', () => {
    expect(readCookie('nonsense', SESSION_COOKIE)).toBeNull()
  })

  it('reads a bearer token case-insensitively', () => {
    expect(readBearer('BEARER session-2')).toBe('session-2')
  })

  it('rejects an Authorization header that is not a bearer', () => {
    expect(readBearer('Basic abc')).toBeNull()
  })

  it('rejects a bearer scheme with no token after it', () => {
    expect(readBearer('Bearer   ')).toBeNull()
  })
})

describe('signing in', () => {
  it('provisions an account on first sign-in', () => {
    const state = createState()

    signIn(state, 'new@example.test')

    expect(state.accounts.has('new@example.test')).toBe(true)
  })

  it('sets an HttpOnly session cookie', () => {
    const state = createState()
    const response = respond(
      state,
      request('POST', '/api/login', {
        body: JSON.stringify({ email: 'a@example.test', password: FIXTURE_PASSWORD }),
      }),
    )

    expect(response.headers['set-cookie']).toContain('HttpOnly')
  })

  it('refuses the wrong password', () => {
    const state = createState()
    const response = respond(
      state,
      request('POST', '/api/login', {
        body: JSON.stringify({ email: 'a@example.test', password: 'wrong' }),
      }),
    )

    expect(response.status).toBe(401)
  })

  it('refuses a body that is not JSON', () => {
    const state = createState()

    expect(respond(state, request('POST', '/api/login', { body: '{' })).status).toBe(401)
  })

  it('counts every sign-in, which is the cost column', () => {
    const state = createState()

    signIn(state, 'a@example.test')
    signIn(state, 'b@example.test')

    expect(state.logins).toBe(2)
  })
})

describe('one live session per account', () => {
  it('invalidates the previous session when the same account signs in again', () => {
    const state = createState()
    const first = signIn(state, 'a@example.test')

    signIn(state, 'a@example.test')

    expect(respond(state, withToken('GET', '/api/me', first)).status).toBe(401)
  })

  it('leaves the newer session working', () => {
    const state = createState()

    signIn(state, 'a@example.test')

    const second = signIn(state, 'a@example.test')

    expect(respond(state, withToken('GET', '/api/me', second)).status).toBe(200)
  })

  it('leaves a different account untouched', () => {
    const state = createState()
    const other = signIn(state, 'b@example.test')

    signIn(state, 'a@example.test')
    signIn(state, 'a@example.test')

    expect(respond(state, withToken('GET', '/api/me', other)).status).toBe(200)
  })

  it('accepts the session by cookie as well as by bearer token', () => {
    const state = createState()
    const token = signIn(state, 'a@example.test')
    const byCookie = request('GET', '/api/me', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    })

    expect(respond(state, byCookie).status).toBe(200)
  })

  it('resolves an unknown session id to nobody', () => {
    const state = createState()

    expect(authenticate(state, withToken('GET', '/api/me', 'session-999'))).toBeNull()
  })
})

describe('notes, which is where a shared account becomes visible', () => {
  it('keeps notes per account', () => {
    const state = createState()
    const a = signIn(state, 'a@example.test')
    const b = signIn(state, 'b@example.test')

    respond(state, withToken('POST', '/api/notes', a, JSON.stringify({ note: 'alpha' })))

    const read = respond(state, withToken('GET', '/api/notes', b))

    expect(JSON.parse((read as { body: string }).body)).toEqual({
      email: 'b@example.test',
      notes: [],
    })
  })

  it('shows one holder of an account what another holder wrote', () => {
    const state = createState()
    const first = signIn(state, 'shared@example.test')

    respond(state, withToken('POST', '/api/notes', first, JSON.stringify({ note: 'alpha' })))

    // A second sign-in evicts the first, which is how two workers sharing an
    // account actually end up here — and the notes stay with the account.
    const second = signIn(state, 'shared@example.test')
    const read = respond(state, withToken('GET', '/api/notes', second))

    expect(JSON.parse((read as { body: string }).body).notes).toEqual(['alpha'])
  })

  it('refuses a note with no session', () => {
    const state = createState()

    expect(respond(state, request('POST', '/api/notes')).status).toBe(401)
  })

  it('refuses a note with no note in it', () => {
    const state = createState()
    const token = signIn(state, 'a@example.test')

    expect(respond(state, withToken('POST', '/api/notes', token, '{}')).status).toBe(400)
  })
})

describe('the ledger', () => {
  it('accepts a row with no credential, so an evicted worker can still report', () => {
    const state = createState()
    const response = respond(
      state,
      request('POST', '/api/ledger', { body: JSON.stringify({ marker: 'alpha' }) }),
    )

    expect(response.status).toBe(200)
  })

  it('hands rows back in arrival order', () => {
    const state = createState()

    respond(state, request('POST', '/api/ledger', { body: JSON.stringify({ marker: 'alpha' }) }))
    respond(state, request('POST', '/api/ledger', { body: JSON.stringify({ marker: 'beta' }) }))

    const read = JSON.parse((respond(state, request('GET', '/api/ledger')) as { body: string }).body)

    expect(read.rows.map((row: { marker: string }) => row.marker)).toEqual(['alpha', 'beta'])
  })

  it('reports the login count alongside the rows', () => {
    const state = createState()

    signIn(state, 'a@example.test')

    const read = JSON.parse((respond(state, request('GET', '/api/ledger')) as { body: string }).body)

    expect(read.logins).toBe(1)
  })
})

describe('barriers', () => {
  it('holds the first party until the second arrives', async () => {
    const state = createState()
    let released = false
    const first = arriveAtBarrier(state, 'signed-in', 2).then(() => {
      released = true
    })

    // A microtask turn is enough to show it has not settled: nothing in the
    // barrier is timer-driven, so if it were going to release it would have.
    await Promise.resolve()
    expect(released).toBe(false)

    await Promise.all([arriveAtBarrier(state, 'signed-in', 2), first])
    expect(released).toBe(true)
  })

  it('releases a barrier of one immediately', async () => {
    const state = createState()

    await expect(arriveAtBarrier(state, 'alone', 1)).resolves.toBeUndefined()
  })

  it('rejects a party that disagrees about the count', async () => {
    const state = createState()

    void arriveAtBarrier(state, 'signed-in', 2)

    await expect(arriveAtBarrier(state, 'signed-in', 3)).rejects.toThrow(/every party must agree/i)
  })

  it('parks the request rather than answering it', () => {
    const state = createState()

    expect(respond(state, request('GET', '/api/barrier?name=x&parties=2')).kind).toBe('park')
  })

  it('refuses a barrier with no party count', () => {
    const state = createState()

    expect(respond(state, request('GET', '/api/barrier?name=x')).status).toBe(400)
  })
})

describe('the gate pages', () => {
  it('renders signed-in on the server gate for a live cookie', () => {
    const state = createState()
    const token = signIn(state, 'a@example.test')
    const page = respond(
      state,
      request('GET', '/app/server', { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    )

    expect((page as { body: string }).body).toContain('data-gate="signed-in"')
  })

  it('renders signed-out on the server gate for no cookie at all', () => {
    const state = createState()

    expect((respond(state, request('GET', '/app/server')) as { body: string }).body).toContain(
      'data-gate="signed-out"',
    )
  })

  it('leaves the two client gates undecided in the HTML, so the browser decides', () => {
    const state = createState()

    for (const path of ['/app/spa', '/app/idb']) {
      expect((respond(state, request('GET', path)) as { body: string }).body).toContain(
        'data-gate="pending"',
      )
    }
  })

  it('serves the sign-in form at both / and /login', () => {
    const state = createState()

    for (const path of ['/', '/login']) {
      expect((respond(state, request('GET', path)) as { body: string }).body).toContain(
        'id="submit"',
      )
    }
  })
})

describe('resetting', () => {
  it('clears accounts, sessions, ledger and counters', () => {
    const state = createState()

    signIn(state, 'a@example.test')
    respond(state, request('POST', '/api/ledger', { body: '{}' }))
    respond(state, request('POST', '/api/reset'))

    expect({
      accounts: state.accounts.size,
      sessions: state.sessions.size,
      ledger: state.ledger.length,
      logins: state.logins,
    }).toEqual({ accounts: 0, sessions: 0, ledger: 0, logins: 0 })
  })
})

describe('unknown routes', () => {
  it('answers 404 with the path, rather than a bare status', () => {
    const state = createState()
    const response = respond(state, request('GET', '/nope'))

    expect(JSON.parse((response as { body: string }).body)).toEqual({
      error: 'no-route',
      path: '/nope',
    })
  })
})

describe('login() directly', () => {
  it('hands back the session id it stored', () => {
    const state = createState()
    const { sessionId } = login(state, 'a@example.test')

    expect(state.sessions.get(sessionId)).toBe('a@example.test')
  })
})
