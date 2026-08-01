// @vitest-environment node
/**
 * Tests for createTestApp and createRequestBuilder.
 *
 * A minimal Node http.createServer() stands in for Express/NestJS so this
 * file has no framework dependencies and runs in any Node environment.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createTestApp, createNestTestApp } from './createTestApp'
import { createRequestBuilder } from './requestBuilder'
import type { TestApp, NestLike } from './index'

// ---------------------------------------------------------------------------
// Minimal test server
// ---------------------------------------------------------------------------

function makeServer(): Server {
  return createServer((req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'
    const auth = req.headers['authorization'] ?? ''
    const tenant = req.headers['x-tenant-id'] ?? ''

    // GET /health
    if (url === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    // POST /echo — reflects body back
    if (url === '/echo' && method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body || '{}')
      })
      return
    }

    // GET /protected — requires Bearer token
    if (url === '/protected' && method === 'GET') {
      if (!auth.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'Unauthorized' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: auth.replace('Bearer ', ''), tenant }))
      return
    }

    // GET /users/:id
    if (url.startsWith('/users/') && method === 'GET') {
      const id = url.slice('/users/'.length)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id, email: `${id}@example.com` }))
      return
    }

    // DELETE /items/:id — 204 No Content
    if (url.startsWith('/items/') && method === 'DELETE') {
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'Not found' }))
  })
}

// ---------------------------------------------------------------------------
// createTestApp
// ---------------------------------------------------------------------------

describe('createTestApp', () => {
  let app: TestApp | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('returns an agent that makes GET requests', async () => {
    app = createTestApp(makeServer())
    const res = await app.agent.get('/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('returns 404 for unknown routes', async () => {
    app = createTestApp(makeServer())
    await app.agent.get('/unknown').expect(404)
  })

  it('agent persists headers across requests (cookie-jar pattern)', async () => {
    app = createTestApp(makeServer())
    await app.agent.get('/health').expect(200)
    await app.agent.get('/health').expect(200)
  })

  it('close() resolves and releases the listener', async () => {
    const server = makeServer()
    app = createTestApp(server)
    await expect(app.close()).resolves.toBeUndefined()
    expect(server.listening).toBe(false)
  })

  it('close() is idempotent', async () => {
    app = createTestApp(makeServer())
    await expect(app.close()).resolves.toBeUndefined()
    await expect(app.close()).resolves.toBeUndefined()
  })

  // ---------------------------------------------------------------------
  // Server ownership. createTestApp binds the server itself so supertest
  // never does — supertest closes any server *it* bound as soon as the first
  // request finishes, which resets sibling requests still in flight. See the
  // comment on listenOnEphemeralPort in createTestApp.ts.
  // ---------------------------------------------------------------------

  // Synchronously, on return from createTestApp — not after an await. If
  // address() were still null here, supertest would bind (and close) its own
  // server on the first request and the race would be back.
  it('binds the server synchronously so the caller does not have to', () => {
    const server = makeServer()
    expect(server.listening).toBe(false)

    app = createTestApp(server)

    expect(server.listening).toBe(true)
    const addr = server.address()
    expect(addr).not.toBeNull()
    expect(typeof addr === 'object' ? addr?.port : undefined).toBeGreaterThan(0)
  })

  it('reuses a server the caller already bound instead of opening a second port', async () => {
    const server = makeServer()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr = server.address()
    const portBefore = typeof addr === 'object' ? addr?.port : undefined

    app = createTestApp(server)

    const addrAfter = server.address()
    expect(typeof addrAfter === 'object' ? addrAfter?.port : undefined).toBe(portBefore)
    await app.agent.get('/health').expect(200)
  })

  it('survives concurrent requests through a single agent', async () => {
    app = createTestApp(makeServer())
    const responses = await Promise.all([
      app.agent.get('/health').expect(200),
      app.agent.get('/health').expect(200),
      app.agent.get('/health').expect(200),
    ])
    for (const res of responses) {
      expect(res.body).toEqual({ status: 'ok' })
    }
  })

  it('rejects a handler with no listen() method', () => {
    expect(() => createTestApp({ notAServer: true })).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// createNestTestApp
// ---------------------------------------------------------------------------

describe('createNestTestApp', () => {
  it('calls init() and wraps the http server', async () => {
    const server = makeServer()
    let initCalled = false
    let closeCalled = false

    const mockNest: NestLike = {
      async init() {
        initCalled = true
      },
      getHttpServer() {
        return server
      },
      // A real INestApplication.close() tears the HTTP server down; the mock
      // does the same so this test does not leak a bound port.
      async close() {
        closeCalled = true
        await new Promise<void>((resolve) => server.close(() => resolve()))
      },
    }

    const nestApp = await createNestTestApp(mockNest)
    expect(initCalled).toBe(true)
    // init() does not bind, so createNestTestApp must have.
    expect(server.listening).toBe(true)

    const res = await nestApp.agent.get('/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })

    await nestApp.close()
    expect(closeCalled).toBe(true)
    expect(server.listening).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createRequestBuilder — basic HTTP methods
// ---------------------------------------------------------------------------

describe('createRequestBuilder — HTTP methods', () => {
  let app: TestApp | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('GET resolves with typed JSON body', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const data = await req.get<{ status: string }>('/health').expect(200).json()
    expect(data.status).toBe('ok')
  })

  it('POST sends a JSON body and echoes it back', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const payload = { email: 'test@example.com', role: 'admin' }
    const data = await req.post<typeof payload>('/echo').send(payload).expect(200).json()
    expect(data).toEqual(payload)
  })

  it('DELETE returns 204 with no body', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const res = await req.delete('/items/42').expect(204)
    expect(res.status).toBe(204)
  })

  it('awaiting the TypedTest directly yields the raw Response', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const res = await req.get('/health')
    expect(res.status).toBe(200)
    expect((res.body as { status: string }).status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// createRequestBuilder — authentication
// ---------------------------------------------------------------------------

describe('createRequestBuilder — withToken', () => {
  let app: TestApp | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('sends Authorization: Bearer header on every request', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const authed = req.withToken('my-jwt-abc')
    const data = await authed.get<{ token: string }>('/protected').expect(200).json()
    expect(data.token).toBe('my-jwt-abc')
  })

  it('unauthenticated builder gets 401 on protected route', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    await req.get('/protected').expect(401)
  })

  it('withToken does NOT mutate the original builder', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const authed = req.withToken('token-xyz')
    // original builder remains unauthenticated
    await req.get('/protected').expect(401)
    const data = await authed.get<{ token: string }>('/protected').expect(200).json()
    expect(data.token).toBe('token-xyz')
  })

  it('withHeader sets an arbitrary header', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const authed = req
      .withToken('tok-1')
      .withHeader('X-Tenant-Id', 'tenant-42')
    const data = await authed.get<{ token: string; tenant: string }>('/protected').expect(200).json()
    expect(data.token).toBe('tok-1')
    expect(data.tenant).toBe('tenant-42')
  })

  it('seed headers from createRequestBuilder options apply to every request', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent, {
      Authorization: 'Bearer seeded-token',
    })
    const data = await req.get<{ token: string }>('/protected').expect(200).json()
    expect(data.token).toBe('seeded-token')
  })

  it('builder chaining preserves immutability across multiple calls', async () => {
    app = createTestApp(makeServer())
    const base = createRequestBuilder(app.agent)
    const a = base.withToken('token-a')
    const b = base.withToken('token-b')

    const [dataA, dataB] = await Promise.all([
      a.get<{ token: string }>('/protected').expect(200).json(),
      b.get<{ token: string }>('/protected').expect(200).json(),
    ])

    expect(dataA.token).toBe('token-a')
    expect(dataB.token).toBe('token-b')
  })
})

// ---------------------------------------------------------------------------
// createRequestBuilder — typed routes
// ---------------------------------------------------------------------------

describe('createRequestBuilder — typed responses', () => {
  let app: TestApp | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('TypedTest.json() returns correctly typed response', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)

    interface User {
      id: string
      email: string
    }

    const user = await req.get<User>('/users/user-123').expect(200).json()
    expect(user.id).toBe('user-123')
    expect(user.email).toBe('user-123@example.com')
  })

  it('TypedTest.raw() returns the full supertest Response', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    const res = await req.get('/health').raw()
    expect(res.status).toBe(200)
    expect(res.type).toBe('application/json')
  })

  it('expectHeader() asserts a response header', async () => {
    app = createTestApp(makeServer())
    const req = createRequestBuilder(app.agent)
    await req.get('/health').expectHeader('content-type', /application\/json/)
  })
})
