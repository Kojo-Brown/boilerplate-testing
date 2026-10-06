// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ORIGIN_PORT, portFromEnv, route, startOrigin, type Origin } from './server.ts'

// ---------------------------------------------------------------------------
// route — the whole table, without a socket
// ---------------------------------------------------------------------------

describe('route', () => {
  it('serves the health endpoint load-test.ts calls', () => {
    const reply = route('GET', '/health')

    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body)).toMatchObject({ status: 'ok' })
  })

  it('serves a paginated list honouring page and limit', () => {
    const reply = route('GET', '/v1/users?page=3&limit=2')
    const body = JSON.parse(reply.body)

    expect(reply.status).toBe(200)
    expect(body).toMatchObject({ page: 3, limit: 2 })
    expect(body.data).toHaveLength(2)
    expect(body.data[0].id).toBe('user-5')
  })

  it('creates with 201, which is what the scenario checks for', () => {
    expect(route('POST', '/v1/users').status).toBe(201)
  })

  it('uses obviously fake tokens', () => {
    const body = JSON.parse(route('GET', '/v1/users?limit=1').body)

    expect(body.data[0].token).toMatch(/^mock-access-token-/)
  })

  it('delays /slow by the requested milliseconds', () => {
    expect(route('GET', '/slow?ms=250').delayMs).toBe(250)
    expect(route('GET', '/slow').delayMs).toBe(500)
  })

  it('fails /fail with the requested status', () => {
    expect(route('GET', '/fail').status).toBe(500)
    expect(route('GET', '/fail?status=503').status).toBe(503)
  })

  it('replies instantly on every route but /slow', () => {
    for (const path of ['/health', '/v1/users', '/fail', '/nope']) {
      expect(route('GET', path).delayMs, path).toBe(0)
    }
  })

  it('404s an unknown path rather than throwing', () => {
    expect(route('GET', '/nope').status).toBe(404)
  })

  it('404s a known path on the wrong method', () => {
    expect(route('DELETE', '/health').status).toBe(404)
  })

  it('clamps a nonsensical query parameter instead of erroring', () => {
    // A load test that 400s because a generated query string was odd measures
    // the generator, not the system.
    for (const query of ['page=0', 'page=-1', 'page=abc', 'page=1.5', 'page=']) {
      const body = JSON.parse(route('GET', `/v1/users?${query}&limit=1`).body)
      expect(body.page, query).toBe(1)
    }
  })

  it('caps limit so a single request cannot ask for an unbounded body', () => {
    expect(JSON.parse(route('GET', '/v1/users?limit=99999').body).limit).toBe(1000)
  })

  it('always replies with parseable JSON', () => {
    for (const [method, path] of [
      ['GET', '/health'],
      ['GET', '/v1/users'],
      ['POST', '/v1/users'],
      ['GET', '/slow'],
      ['GET', '/fail'],
      ['GET', '/nope'],
    ] as const) {
      expect(() => JSON.parse(route(method, path).body), `${method} ${path}`).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// portFromEnv
// ---------------------------------------------------------------------------

describe('portFromEnv', () => {
  it('defaults when unset or empty', () => {
    expect(portFromEnv(undefined)).toBe(ORIGIN_PORT)
    expect(portFromEnv('')).toBe(ORIGIN_PORT)
  })

  it('reads a port', () => {
    expect(portFromEnv('9001')).toBe(9001)
  })

  it('allows 0, which asks the OS for a free port', () => {
    expect(portFromEnv('0')).toBe(0)
  })

  it.each(['-1', '65536', '8080.5', 'eight thousand'])('rejects %j', (value) => {
    expect(() => portFromEnv(value)).toThrow('must be a TCP port')
  })

  it('reports the 0 case in its error, so the rule is discoverable', () => {
    expect(() => portFromEnv('-1')).toThrow('or 0 to let the OS pick one')
  })
})

// ---------------------------------------------------------------------------
// startOrigin — one bound socket
// ---------------------------------------------------------------------------

describe('startOrigin', () => {
  let origin: Origin

  beforeAll(async () => {
    // Port 0 so the suite cannot collide with a developer's own 8799, or with
    // a k6 run left behind by `pnpm k6:check`.
    origin = await startOrigin(0)
  })

  afterAll(async () => {
    await origin.close()
  })

  it('resolves only once it is accepting connections', async () => {
    const response = await fetch(`${origin.baseUrl}/health`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' })
  })

  it('reports the port it actually bound, not the one it was asked for', () => {
    expect(origin.port).toBeGreaterThan(0)
    expect(origin.baseUrl).toBe(`http://localhost:${origin.port}`)
  })

  it('answers a POST without leaving the request body half-read', async () => {
    // An undrained request body is reported by k6 as a failed request rather
    // than a slow one, which would move http_req_failed and nothing else.
    const response = await fetch(`${origin.baseUrl}/v1/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fixture User', role: 'viewer' }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ role: 'viewer' })
  })

  it('serves /slow with the delay it was asked for in the body', async () => {
    // What `route` decides is covered above without a socket. This checks the
    // bound server carries it through — not that `setTimeout` sleeps, which is
    // Node's contract rather than this fixture's, and asserting it here would
    // read a clock to measure someone else's code.
    const response = await fetch(`${origin.baseUrl}/slow?ms=60`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ slept: 60 })
  })

  it('serves a failing status when asked, so a breach can be provoked', async () => {
    const response = await fetch(`${origin.baseUrl}/fail?status=503`)

    expect(response.status).toBe(503)
  })

  it('handles concurrent requests, since a load test is nothing else', async () => {
    const responses = await Promise.all(
      Array.from({ length: 40 }, () => fetch(`${origin.baseUrl}/health`)),
    )

    expect(responses.map((response) => response.status)).toEqual(Array(40).fill(200))
    await Promise.all(responses.map((response) => response.json()))
  })

  it('rejects a port already in use rather than silently serving nothing', async () => {
    await expect(startOrigin(origin.port)).rejects.toThrow(/EADDRINUSE/)
  })
})
