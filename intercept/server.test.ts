// @vitest-environment node
//
// Binds a real socket, so it needs the node environment rather than jsdom.

/**
 * The twelve lines that put `origin.ts` on a port.
 *
 * `origin.test.ts` proves the routes answer; this proves the bytes survive the
 * trip. That is a short list and every item on it has bitten somebody:
 * a body assembled from the wrong chunks, a status that does not reach the
 * wire, a `content-type` the browser then refuses to parse, and a served
 * schema read from an environment variable that nobody validates.
 *
 * The suite binds the real port rather than a random one, because the port is
 * part of what is being asserted — `ORIGIN_PORT` is baked into the committed
 * recording, and a server that quietly listened somewhere else would replay
 * against nothing. It runs serially with the rest of the file for the same
 * reason.
 */

import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CONTROL_PATHS, CURRENT_SCHEMA, ORIGIN_URL, RECORDED_SCHEMA } from './origin'
import { schemaFromEnv, startOrigin } from './server'

let server: Server

beforeAll(async () => {
  server = await startOrigin()
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('schemaFromEnv', () => {
  it('serves today’s schema when the variable is unset', () => {
    expect(schemaFromEnv(undefined)).toBe(CURRENT_SCHEMA)
  })

  it('serves the version the recorder asks for', () => {
    expect(schemaFromEnv(String(RECORDED_SCHEMA))).toBe(RECORDED_SCHEMA)
  })

  it('refuses a value that is not a positive integer, rather than serving NaN', () => {
    // Silently falling back would make a mis-typed re-record produce a
    // recording at today's schema, which is precisely the failure
    // `har.test.ts` exists to catch — and it would catch it a commit later.
    expect(() => schemaFromEnv('one')).toThrow(/positive integer/)
    expect(() => schemaFromEnv('0')).toThrow(/positive integer/)
    expect(() => schemaFromEnv('1.5')).toThrow(/positive integer/)
  })
})

describe('the bound origin', () => {
  it('serves the document on the port the recording was taken against', async () => {
    const response = await fetch(`${ORIGIN_URL}/`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('<main id="app">')
  })

  it('serves JSON with a content type a browser will parse', async () => {
    const response = await fetch(`${ORIGIN_URL}/api/profile`)

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toMatchObject({ source: 'origin' })
  })

  it('reads a POST body that arrives in more than one chunk', async () => {
    // The handler concatenates `data` events. A body read from the first chunk
    // alone passes every test with a short fixture and truncates a real one.
    const word = 'a'.repeat(50_000)
    const response = await fetch(`${ORIGIN_URL}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ word }),
    })

    expect(await response.json()).toMatchObject({ echoed: word.toUpperCase() })
  })

  it('carries a non-2xx status through to the client', async () => {
    await fetch(`${ORIGIN_URL}${CONTROL_PATHS.reset}`, { method: 'POST' })

    expect((await fetch(`${ORIGIN_URL}/api/flaky`)).status).toBe(503)
    expect((await fetch(`${ORIGIN_URL}/api/flaky`)).status).toBe(200)
  })

  it('tells caches to keep nothing, so a probe measures routing and not a cache', async () => {
    const response = await fetch(`${ORIGIN_URL}/api/profile`)

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('reports the ledger over the same socket the specs use', async () => {
    await fetch(`${ORIGIN_URL}${CONTROL_PATHS.reset}`, { method: 'POST' })
    await fetch(`${ORIGIN_URL}/api/notifications`)

    const payload = (await (await fetch(`${ORIGIN_URL}${CONTROL_PATHS.log}`)).json()) as {
      log: string[]
    }

    expect(payload.log).toEqual(['GET /api/notifications'])
  })
})
