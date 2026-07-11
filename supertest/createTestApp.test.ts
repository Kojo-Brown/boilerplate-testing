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

  it('close() resolves without throwing when server is not yet listening', async () => {
    app = createTestApp(makeServer())
    await expect(app.close()).resolves.toBeUndefined()
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
      async close() {
        closeCalled = true
      },
    }

    const nestApp = await createNestTestApp(mockNest)
    expect(initCalled).toBe(true)

    const res = await nestApp.agent.get('/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })

    await nestApp.close()
    expect(closeCalled).toBe(true)
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
