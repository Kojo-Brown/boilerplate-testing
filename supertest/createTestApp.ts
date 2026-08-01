/**
 * createTestApp — factory helpers for wrapping Express and NestJS apps with a
 * persistent supertest agent. Each TestApp owns a cookie jar so session-based
 * or JWT-cookie auth works naturally across requests.
 *
 * Express usage:
 *   import express from 'express'
 *   const app = express()
 *   const { agent, close } = createTestApp(app)
 *   await agent.get('/health').expect(200)
 *   await close()
 *
 * NestJS usage:
 *   import { Test } from '@nestjs/testing'
 *   import { AppModule } from '@/app.module'
 *   const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
 *   const { agent, close } = await createNestTestApp(moduleRef.createNestApplication())
 *   await agent.get('/v1/health').expect(200)
 *   await close()
 */

import type { Server } from 'node:http'
import supertest from 'supertest'

// `SuperAgentTest` is a legacy alias in @types/supertest 6 and is no longer
// what `supertest.agent()` returns (it now yields `TestAgent<Test>`). Deriving
// the type from the factory keeps this correct across future type releases.
export type SupertestAgent = ReturnType<typeof supertest.agent>

export interface TestApp {
  /** Persistent supertest agent with cookie jar — reuse across requests. */
  agent: SupertestAgent
  /** Gracefully closes the underlying HTTP server (no-op if already closed). */
  close(): Promise<void>
}

// Supertest accepts http.Server or anything that has a `listen` method (e.g. Express app).
// Using `unknown` + cast keeps our signature clean without pulling in @types/express.
type HttpHandler = Server | Record<string, unknown>

/**
 * Binds `handler` to an ephemeral loopback port and returns the listening
 * `http.Server`, so that supertest never has to bind one itself.
 *
 * This is the whole reason `createTestApp` exists rather than calling
 * `supertest.agent(app)` directly. Supertest resolves a base URL per request
 * (`lib/test.js#serverAddress`):
 *
 *     const addr = app.address()
 *     if (!addr) this._server = app.listen(0)
 *
 * and whichever `Test` bound the server closes it again the moment *that*
 * request finishes (`lib/test.js#end`). With one request in flight that is
 * invisible. With two — `Promise.all([a.get(...), b.get(...)])` against a
 * single agent — the first response tears down the listener under the second
 * request's open socket. On Node 22 and 24 the reset lands after the second
 * response has already been read and nothing is observed; on Node 26 it
 * surfaces as `read ECONNRESET`. The race is supertest's, not Node's; Node 26
 * only changed the timing that used to hide it.
 *
 * Binding up front means `app.address()` is always non-null, so supertest
 * never assigns `this._server` and never closes anything. Lifetime belongs to
 * `TestApp.close()` instead — one listener per TestApp, not one per request.
 *
 * `listen()` sets up the handle synchronously (the `listening` *event* is what
 * is deferred), so `address()` is readable on return and `createTestApp` can
 * stay synchronous. Verified on Node 22, 24 and 26.
 */
function listenOnEphemeralPort(handler: HttpHandler): Server {
  const server = handler as Server

  if (typeof server.listen !== 'function') {
    throw new TypeError(
      'createTestApp: expected an http.Server or an Express-style app with a listen() method',
    )
  }

  // Already bound by the caller — reuse it rather than opening a second port.
  if (server.listening) return server

  // `http.Server.listen()` returns itself; an Express app returns the new
  // `http.Server` it just created. Either way this is the object to close.
  //
  // No host argument, deliberately. Passing one sends `listen()` through
  // `dns.lookup()` — asynchronous even for an IP literal — so `address()`
  // would still be null on return and `createTestApp` would have to become
  // async, changing its public signature. The default host binds synchronously
  // and is what supertest itself would have used.
  return server.listen(0) as Server
}

/**
 * Wraps an Express application or Node `http.Server` with a persistent
 * supertest agent.
 *
 * The server does **not** need to be listening — `createTestApp` binds it to an
 * ephemeral loopback port and hands the bound server to supertest. That makes
 * concurrent requests through the returned agent safe:
 *
 *     const req = createRequestBuilder(app.agent)
 *     await Promise.all([req.get('/a'), req.get('/b')])   // both complete
 *
 * A server the caller already bound is reused as-is. `close()` releases the
 * listener either way.
 */
export function createTestApp(server: HttpHandler): TestApp {
  const listening = listenOnEphemeralPort(server)
  const agent = supertest.agent(listening)

  return {
    agent,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!listening.listening) {
          resolve()
          return
        }
        // `close()` stops accepting and then waits for live sockets to end.
        // Node keeps agent sockets alive by default (`keepAlive: true` since
        // Node 19), so without this the promise would not settle until the
        // 5s keep-alive timer expired on every TestApp teardown.
        listening.close((err) => (err ? reject(err) : resolve()))
        listening.closeIdleConnections()
      }),
  }
}

/** Minimal interface satisfied by `INestApplication`. */
export interface NestLike {
  /** Bootstraps the application (registers pipes, guards, interceptors, etc.). */
  init(): Promise<unknown>
  /** Returns the underlying `http.Server` for supertest to bind. */
  getHttpServer(): unknown
  /** Tears down the application and closes the server. */
  close(): Promise<void>
}

/**
 * NestJS variant: calls `app.init()`, then wraps the underlying HTTP server
 * with a persistent supertest agent. The returned `close()` delegates to
 * `app.close()` so NestJS shutdown hooks fire correctly.
 *
 * `init()` prepares the server but does not bind it, so the same supertest
 * server-ownership race described on `listenOnEphemeralPort` applies here too —
 * hence the explicit bind before the agent is created. `app.close()` closes the
 * underlying server, so the listener is still released exactly once.
 *
 * @example
 *   const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
 *   const nestApp = moduleRef.createNestApplication()
 *   const { agent, close } = await createNestTestApp(nestApp)
 *
 *   afterAll(() => close())
 */
export async function createNestTestApp(app: NestLike): Promise<TestApp> {
  await app.init()
  const server = listenOnEphemeralPort(app.getHttpServer() as Server)

  return {
    agent: supertest.agent(server),
    close: () => app.close(),
  }
}
