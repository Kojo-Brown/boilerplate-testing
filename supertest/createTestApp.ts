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
import supertest, { type SuperAgentTest } from 'supertest'

export interface TestApp {
  /** Persistent supertest agent with cookie jar — reuse across requests. */
  agent: SuperAgentTest
  /** Gracefully closes the underlying HTTP server (no-op if already closed). */
  close(): Promise<void>
}

// Supertest accepts http.Server or anything that has a `listen` method (e.g. Express app).
// Using `unknown` + cast keeps our signature clean without pulling in @types/express.
type HttpHandler = Server | Record<string, unknown>

/**
 * Wraps an Express application or Node `http.Server` with a persistent
 * supertest agent. The server does **not** need to be listening — supertest
 * binds its own ephemeral port per request.
 */
export function createTestApp(server: HttpHandler): TestApp {
  const agent = supertest.agent(server as Parameters<typeof supertest>[0])

  return {
    agent,
    close: () =>
      new Promise<void>((resolve, reject) => {
        const s = server as Server
        if (typeof s.close === 'function' && s.listening) {
          s.close((err) => (err ? reject(err) : resolve()))
        } else {
          resolve()
        }
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
 * @example
 *   const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
 *   const nestApp = moduleRef.createNestApplication()
 *   const { agent, close } = await createNestTestApp(nestApp)
 *
 *   afterAll(() => close())
 */
export async function createNestTestApp(app: NestLike): Promise<TestApp> {
  await app.init()
  const server = app.getHttpServer() as Server

  return {
    agent: supertest.agent(server),
    close: () => app.close(),
  }
}
