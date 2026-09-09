/**
 * The broker client, against a stub broker rather than a real one.
 *
 * The real broker is where `pipeline/` exercises this, and that is the right
 * place for "does publishing work". What a stub is better at is the handful of
 * things a real broker makes *hard* to provoke on demand: a 500, a 404 on a
 * delete, an environment that already exists, and the exact bytes of an
 * `Authorization` header.
 *
 * The stub is a real HTTP server, not a mocked `fetch`. Mocking the transport
 * would stop this file from noticing the two bugs it did catch — a doubled
 * slash from a trailing-slash base URL, and a `recordDeployment` path built
 * with the environment's name where the broker wants its uuid.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { BrokerError, PactBrokerClient, type BrokerAuth } from './client'

interface Recorded {
  readonly method: string
  readonly url: string
  readonly headers: NodeJS.Dict<string | string[]>
  readonly body: string
}

interface Stub {
  readonly client: PactBrokerClient
  readonly requests: Recorded[]
  stop(): Promise<void>
}

/** A broker that answers from a routing table keyed by `METHOD path`. */
async function stubBroker(
  routes: Record<string, { status: number; body?: unknown }>,
  auth?: BrokerAuth,
  baseSuffix = '',
): Promise<Stub> {
  const requests: Recorded[] = []

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const route = routes[`${req.method} ${req.url}`]
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'no stub route' }))
        return
      }
      res.writeHead(route.status, { 'Content-Type': 'application/hal+json' })
      res.end(route.body === undefined ? '' : JSON.stringify(route.body))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    client: new PactBrokerClient(`http://127.0.0.1:${port}${baseSuffix}`, auth),
    requests,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

let open: Stub | undefined
afterEach(async () => {
  await open?.stop()
  open = undefined
})

describe('Base URL handling', () => {
  it('strips trailing slashes so paths do not double up', async () => {
    open = await stubBroker(
      { 'GET /diagnostic/status/heartbeat': { status: 200, body: { ok: true } } },
      undefined,
      '///',
    )
    expect(await open.client.heartbeat()).toBe(true)
    expect(open.requests[0]?.url).toBe('/diagnostic/status/heartbeat')
  })
})

describe('Authentication', () => {
  it('sends basic credentials as a base64 pair', async () => {
    open = await stubBroker(
      { 'GET /diagnostic/status/heartbeat': { status: 200, body: { ok: true } } },
      { kind: 'basic', username: 'mock-user', password: 'mock-password' },
    )
    await open.client.heartbeat()

    const expected = Buffer.from('mock-user:mock-password').toString('base64')
    expect(open.requests[0]?.headers['authorization']).toBe(`Basic ${expected}`)
  })

  it('sends a token as a bearer header', async () => {
    open = await stubBroker(
      { 'GET /diagnostic/status/heartbeat': { status: 200, body: { ok: true } } },
      { kind: 'bearer', token: 'mock-broker-token' },
    )
    await open.client.heartbeat()
    expect(open.requests[0]?.headers['authorization']).toBe('Bearer mock-broker-token')
  })

  it('sends no authorization header when there are no credentials', async () => {
    open = await stubBroker({
      'GET /diagnostic/status/heartbeat': { status: 200, body: { ok: true } },
    })
    await open.client.heartbeat()
    expect(open.requests[0]?.headers['authorization']).toBeUndefined()
  })
})

describe('Heartbeat', () => {
  it('reports false rather than throwing when the broker is not there', async () => {
    const client = new PactBrokerClient('http://127.0.0.1:9')
    expect(await client.heartbeat()).toBe(false)
  })

  it('reports false when the broker answers without ok', async () => {
    open = await stubBroker({
      'GET /diagnostic/status/heartbeat': { status: 200, body: { ok: false } },
    })
    expect(await open.client.heartbeat()).toBe(false)
  })
})

describe('Publishing contracts', () => {
  it('base64-encodes the pact and returns the broker’s notices', async () => {
    open = await stubBroker({
      'POST /contracts/publish': {
        status: 200,
        body: { notices: [{ type: 'success', text: 'published' }] },
      },
    })

    const notices = await open.client.publishContracts({
      consumerName: 'c',
      consumerVersion: '1',
      branch: 'main',
      tags: ['main'],
      contracts: [{ consumerName: 'c', providerName: 'p', content: { interactions: [] } }],
    })

    expect(notices).toEqual([{ type: 'success', text: 'published' }])

    const sent = JSON.parse(open.requests[0]?.body ?? '{}') as {
      branch: string
      tags: string[]
      contracts: { content: string; specification: string }[]
    }
    expect(sent.branch).toBe('main')
    expect(sent.tags).toEqual(['main'])
    expect(sent.contracts[0]?.specification).toBe('pact')
    expect(JSON.parse(Buffer.from(sent.contracts[0]?.content ?? '', 'base64').toString())).toEqual({
      interactions: [],
    })
  })

  it('omits tags entirely when none are given', async () => {
    open = await stubBroker({ 'POST /contracts/publish': { status: 200, body: {} } })
    await open.client.publishContracts({
      consumerName: 'c',
      consumerVersion: '1',
      branch: 'main',
      contracts: [],
    })
    expect(JSON.parse(open.requests[0]?.body ?? '{}')).not.toHaveProperty('tags')
  })

  it('throws a BrokerError carrying the status and body', async () => {
    open = await stubBroker({
      'POST /contracts/publish': { status: 500, body: { error: 'broker exploded' } },
    })

    const failing = open.client.publishContracts({
      consumerName: 'c',
      consumerVersion: '1',
      branch: 'main',
      contracts: [],
    })

    await expect(failing).rejects.toBeInstanceOf(BrokerError)
    await expect(failing).rejects.toThrow(/500.*broker exploded/)
  })
})

describe('can-i-deploy', () => {
  it('answers deployable with the broker’s own reason', async () => {
    open = await stubBroker({
      'GET /can-i-deploy?pacticipant=p&version=1&environment=production': {
        status: 200,
        body: { summary: { deployable: true, reason: 'all good' } },
      },
    })

    expect(await open.client.canIDeploy('p', '1', 'production')).toEqual({
      deployable: true,
      reason: 'all good',
    })
  })

  it('treats an unknown answer as not deployable', async () => {
    open = await stubBroker({
      'GET /can-i-deploy?pacticipant=p&version=1&environment=production': {
        status: 200,
        body: { summary: { deployable: null, reason: 'unknown' } },
      },
    })

    // `null` means the broker cannot tell. A truthiness check would read it as
    // false anyway; the explicit `=== true` is here so that a future broker
    // answering `"true"` does not read as deployable either.
    expect((await open.client.canIDeploy('p', '1', 'production')).deployable).toBe(false)
  })
})

describe('Recording a deployment', () => {
  it('addresses the environment by uuid, not by name', async () => {
    open = await stubBroker({
      'GET /environments': {
        status: 200,
        body: { _embedded: { environments: [{ uuid: 'env-uuid-1', name: 'production' }] } },
      },
      'POST /pacticipants/p/versions/1/deployed-versions/environment/env-uuid-1': {
        status: 201,
        body: {},
      },
    })

    await expect(open.client.recordDeployment('p', '1', 'production')).resolves.toBeUndefined()
    expect(open.requests.map((request) => request.url)).toContain(
      '/pacticipants/p/versions/1/deployed-versions/environment/env-uuid-1',
    )
  })

  it('creates the environment when the broker has none by that name', async () => {
    open = await stubBroker({
      'GET /environments': { status: 200, body: { _embedded: { environments: [] } } },
      'POST /environments': { status: 201, body: { uuid: 'created-uuid' } },
      'POST /pacticipants/p/versions/1/deployed-versions/environment/created-uuid': {
        status: 201,
        body: {},
      },
    })

    await open.client.recordDeployment('p', '1', 'staging')
    const created = JSON.parse(open.requests[1]?.body ?? '{}') as {
      name: string
      production: boolean
    }
    expect(created.name).toBe('staging')
    expect(created.production).toBe(false)
  })
})

describe('Deleting a pacticipant', () => {
  it('treats a 404 as the desired state', async () => {
    open = await stubBroker({})
    await expect(open.client.deletePacticipant('gone')).resolves.toBeUndefined()
  })

  it('rethrows anything that is not a 404', async () => {
    open = await stubBroker({ 'DELETE /pacticipants/p': { status: 403, body: { error: 'no' } } })
    await expect(open.client.deletePacticipant('p')).rejects.toBeInstanceOf(BrokerError)
  })
})
