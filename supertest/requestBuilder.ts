/**
 * TypedRequestBuilder — immutable, fluent HTTP request builder built on top of
 * a supertest agent. Each call to `withToken` / `withHeader` returns a NEW
 * builder so the original is never mutated and can be reused across tests.
 *
 * @example
 *   const req = createRequestBuilder(agent)
 *   const authed = req.withToken(jwtToken)
 *
 *   // Unauthenticated GET
 *   const health = await req.get<{ status: string }>('/health').expect(200).json()
 *
 *   // Authenticated GET
 *   const user = await authed.get<User>('/users/1').expect(200).json()
 *
 *   // POST with body
 *   const created = await authed
 *     .post<User>('/users')
 *     .send({ email: 'test@example.com', name: 'Test' })
 *     .expect(201)
 *     .json()
 *
 *   // DELETE
 *   await authed.delete('/users/1').expect(204)
 */

import type { SuperAgentTest, Test } from 'supertest'
import type { Response } from 'superagent'

// ---------------------------------------------------------------------------
// TypedTest — thin wrapper around a supertest Test chain
// ---------------------------------------------------------------------------

/**
 * Wraps a single supertest `Test` request. Supports chaining via `.send()` and
 * `.expect()`, and resolves to a typed JSON body via `.json()`. Awaiting the
 * instance directly yields the raw supertest `Response`.
 */
export class TypedTest<T = unknown> {
  private req: Test

  constructor(req: Test) {
    this.req = req
  }

  /** Sets the JSON request body. Content-Type is inferred as application/json. */
  send(body: Record<string, unknown> | unknown[]): this {
    this.req = this.req.send(body)
    return this
  }

  /** Asserts the response HTTP status code. */
  expect(statusCode: number): this {
    this.req = this.req.expect(statusCode)
    return this
  }

  /** Asserts a response header field matches the given string or pattern. */
  expectHeader(field: string, value: string | RegExp): this {
    this.req = this.req.expect(field, value)
    return this
  }

  /**
   * Resolves the request and returns the parsed JSON body as `T`.
   * Combine with `.expect()` for assertion + extraction in one step:
   *
   *   const user = await req.get<User>('/users/1').expect(200).json()
   */
  async json(): Promise<T> {
    const res = await this.req
    return res.body as T
  }

  /** Resolves the request and returns the raw supertest `Response`. */
  async raw(): Promise<Response> {
    return this.req
  }

  // Make TypedTest directly awaitable (resolves to raw Response)
  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.req.then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<Response | TResult> {
    return this.req.catch(onrejected)
  }
}

// ---------------------------------------------------------------------------
// RequestBuilder — immutable fluent builder
// ---------------------------------------------------------------------------

export class RequestBuilder {
  constructor(
    private readonly agent: SuperAgentTest,
    private readonly defaultHeaders: ReadonlyMap<string, string> = new Map(),
  ) {}

  /**
   * Returns a new builder that sends `Authorization: Bearer <token>` on every
   * subsequent request. The original builder is unchanged.
   */
  withToken(token: string): RequestBuilder {
    return this.withHeader('Authorization', `Bearer ${token}`)
  }

  /**
   * Returns a new builder that sends an extra header on every subsequent
   * request. The original builder is unchanged.
   */
  withHeader(key: string, value: string): RequestBuilder {
    const next = new Map(this.defaultHeaders)
    next.set(key, value)
    return new RequestBuilder(this.agent, next)
  }

  get<T = unknown>(path: string): TypedTest<T> {
    return new TypedTest<T>(this.applyHeaders(this.agent.get(path)))
  }

  post<T = unknown>(path: string): TypedTest<T> {
    return new TypedTest<T>(this.applyHeaders(this.agent.post(path)))
  }

  put<T = unknown>(path: string): TypedTest<T> {
    return new TypedTest<T>(this.applyHeaders(this.agent.put(path)))
  }

  patch<T = unknown>(path: string): TypedTest<T> {
    return new TypedTest<T>(this.applyHeaders(this.agent.patch(path)))
  }

  delete<T = unknown>(path: string): TypedTest<T> {
    return new TypedTest<T>(this.applyHeaders(this.agent.delete(path)))
  }

  private applyHeaders(req: Test): Test {
    let r = req
    for (const [key, value] of this.defaultHeaders) {
      r = r.set(key, value)
    }
    return r
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new `RequestBuilder` wrapping the given supertest agent.
 * Optionally seed it with headers that every request will carry.
 *
 * @example
 *   const req = createRequestBuilder(agent)
 *   const admin = createRequestBuilder(agent, { 'X-Internal-Key': secret })
 */
export function createRequestBuilder(
  agent: SuperAgentTest,
  defaultHeaders: Record<string, string> = {},
): RequestBuilder {
  return new RequestBuilder(agent, new Map(Object.entries(defaultHeaders)))
}
