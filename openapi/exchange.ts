/**
 * Capturing exchanges: one real request over a real socket per drift, recorded
 * as a value the six wirings can each judge.
 *
 * ---------------------------------------------------------------------------
 * Why a socket at all
 * ---------------------------------------------------------------------------
 * `service.ts` exposes a pure `handle()`, and calling it in a loop would make
 * this file four lines long and the whole module run in milliseconds. It would
 * also stop measuring the thing the module is named after. Half of what a
 * conformance check looks at only exists on the wire: the content type, the
 * response headers, the fact that a number went out as a string and came back
 * as a string, the fact that Node lower-cases header names and an OpenAPI
 * document does not. A check that has only ever seen a JavaScript object has
 * not been tested against an HTTP response.
 *
 * So the server is bound, supertest drives it, and the response is read as raw
 * text before anything interprets it — see `parseBody` for why the parsing is
 * done here rather than left to superagent.
 *
 * ---------------------------------------------------------------------------
 * One request per drift, and no retries
 * ---------------------------------------------------------------------------
 * Every cell in the matrix is a deterministic function of bytes that a
 * deterministic service produced from a fixed store with an injected clock.
 * There is nothing here for a second sample to disagree with, so a repeat count
 * would buy noise-free noise. `concurrency/` is the module in this repository
 * where sampling is the right shape, and the reason it is not here is worth
 * being explicit about: repeat counts get copied between suites long after the
 * property that justified one has gone.
 */

import { createTestApp } from '@/supertest/createTestApp'

import type { Drift, RequestPlan } from './drifts.ts'
import { createOrdersServer } from './server.ts'
import { baseMediaType } from './strategies.ts'
import type { Json } from './spec.ts'

export interface CapturedRequest {
  readonly method: string
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  /** Lower-cased, as Node writes them. */
  readonly headers: Readonly<Record<string, string>>
  readonly body: Json | undefined
}

export interface CapturedResponse {
  readonly status: number
  /** Lower-cased, as Node reports them. */
  readonly headers: Readonly<Record<string, string>>
  /** Exactly what came back, before anything interpreted it. */
  readonly text: string
  /** The parsed body, or `undefined` when the response was not JSON. */
  readonly body: Json | undefined
}

export interface Exchange {
  /** Which corpus entry produced this. `none` is the conforming baseline. */
  readonly drift: string
  /** The status the test author expected — see `RequestPlan.expect`. */
  readonly expectedStatus: number
  readonly request: CapturedRequest
  readonly response: CapturedResponse
}

/**
 * Parse the body here rather than letting superagent do it.
 *
 * Superagent picks a parser from the content type and, for anything it does not
 * recognise, leaves `res.body` as an empty object. An empty object is a
 * perfectly good JSON value, so a wiring handed `res.body` cannot tell "the
 * service sent `{}`" from "the service sent something that is not JSON at all"
 * — and the second of those is the `wrong-content-type` row. Parsing from the
 * raw text keeps `undefined` meaning what it says.
 */
function parseBody(text: string, contentType: string | undefined): Json | undefined {
  if (!baseMediaType(contentType).endsWith('json')) return undefined

  try {
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}

function lowerCased(headers: Readonly<Record<string, string | string[] | undefined>>): Record<string, string> {
  const flattened: Record<string, string> = {}

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') flattened[name.toLowerCase()] = value
    else if (Array.isArray(value)) flattened[name.toLowerCase()] = value.join(', ')
  }

  return flattened
}

/** Every drift's request against one drifting service, captured. */
export async function captureExchange(drift: Drift): Promise<Exchange> {
  const app = createTestApp(createOrdersServer({ transform: drift.transform }))

  try {
    return await send(drift.key, drift.request, app.agent)
  } finally {
    await app.close()
  }
}

type Agent = ReturnType<typeof createTestApp>['agent']

async function send(driftKey: string, plan: RequestPlan, agent: Agent): Promise<Exchange> {
  const query = plan.query ?? {}
  const requestHeaders: Record<string, string> = {}

  let pending =
    plan.method === 'GET'
      ? agent.get(plan.path)
      : plan.method === 'DELETE'
        ? agent.delete(plan.path)
        : agent.post(plan.path)

  pending = pending.query(query)

  if (plan.body !== undefined) {
    requestHeaders['content-type'] = 'application/json'
    pending = pending.set('content-type', 'application/json').send(JSON.stringify(plan.body))
  }

  // `buffer(true)` plus a parser that only accumulates: superagent hands back
  // the bytes and decides nothing. See `parseBody`.
  const response = await pending.buffer(true).parse((incoming, callback) => {
    let text = ''

    incoming.setEncoding('utf8')
    incoming.on('data', (chunk: string) => {
      text += chunk
    })
    incoming.on('end', () => callback(null, text))
  })

  const headers = lowerCased(response.headers)
  const text = typeof response.body === 'string' ? response.body : response.text

  return {
    drift: driftKey,
    expectedStatus: plan.expect,
    request: {
      method: plan.method,
      path: plan.path,
      query,
      headers: requestHeaders,
      body: plan.body,
    },
    response: {
      status: response.status,
      headers,
      text,
      body: parseBody(text, headers['content-type']),
    },
  }
}

/** Capture the whole corpus, one service per drift. */
export async function captureCorpus(drifts: readonly Drift[]): Promise<readonly Exchange[]> {
  const exchanges: Exchange[] = []

  // Sequential on purpose. Each drift needs its own server because the drift is
  // the server's behaviour, and running twelve listeners at once to save two
  // hundred milliseconds is how a suite acquires a port-exhaustion flake that
  // only ever reproduces on somebody else's machine.
  for (const drift of drifts) exchanges.push(await captureExchange(drift))

  return exchanges
}
