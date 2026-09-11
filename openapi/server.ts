/**
 * The `node:http` shell around `service.ts`.
 *
 * Its own file because it is the only thing in this directory that opens a
 * socket, and `shape/boundaries.ts` classifies a test by what it reaches
 * transitively. Folded back into `service.ts` this one import would make a unit
 * test of `handle()` — which touches nothing outside its own heap — count as an
 * integration test, along with every test of the drift corpus that imports an
 * order id from it. The boundary is real; the point of the split is that only
 * the code that actually crosses it pays.
 */

import { createServer, type Server } from 'node:http'

import { handle, serialise, type ServerOptions, type ServiceRequest } from './service.ts'
import type { Json } from './spec.ts'

function parseBody(raw: string, contentType: string | undefined): Json | undefined {
  if (raw === '') return undefined
  if (contentType !== undefined && !contentType.includes('json')) return raw

  try {
    return JSON.parse(raw) as Json
  } catch {
    // Deliberately not a throw. A handler that receives unparseable JSON has to
    // answer something, and `placeOrder` answering 400 is the behaviour the
    // spec's `400` response describes.
    return raw
  }
}

/**
 * The service as a `node:http` server, unbound.
 *
 * `supertest/createTestApp.ts` binds it and owns the listener — see the note
 * there for why binding up front rather than per request matters.
 */
export function createOrdersServer(options: ServerOptions = {}): Server {
  const transform = options.transform ?? ((response) => response)

  return createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []

    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const url = new URL(incoming.url ?? '/', 'http://service.invalid')
      const headers: Record<string, string> = {}

      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers[name] = value
      }

      const request: ServiceRequest = {
        method: incoming.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers,
        body: parseBody(Buffer.concat(chunks).toString('utf8'), headers['content-type']),
      }

      const response = transform(
        options.placement === undefined ? handle(request) : handle(request, options.placement),
        request,
      )
      const body = serialise(response)

      outgoing.writeHead(response.status, {
        ...response.headers,
        'content-length': Buffer.byteLength(body),
      })
      outgoing.end(body)
    })
  })
}
