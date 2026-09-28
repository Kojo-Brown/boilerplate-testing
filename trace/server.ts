/**
 * `subject.ts`, bound to a socket, plus the three endpoints its variants fetch.
 *
 * The same split as `visual/server.ts`, `a11y/server.ts` and
 * `intercept/server.ts`: the document is a pure function and auditable without
 * a port, so this file is the binding and the API.
 *
 * `/api/slow` never answers. It holds the socket open for the whole run rather
 * than answering slowly, because a timeout measured against a delay is a race
 * against `actionTimeout` — on a loaded runner the delay wins sometimes and the
 * assertion wins sometimes, and a directory whose subject is *why a CI failure
 * happened* cannot ship a fixture that is itself flaky. The pending requests
 * are tracked so the process can exit: an unanswered request keeps the
 * connection alive, and `close()` would otherwise hang until the client gives
 * up.
 */

import { createServer, type Server, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

import {
  BROKEN_PATH,
  SLOW_PATH,
  SUMMARY,
  SUMMARY_PATH,
  isFaultName,
  render,
  type FaultName,
} from './subject.ts'

export const SUBJECT_PORT = 3114
export const SUBJECT_URL = `http://127.0.0.1:${SUBJECT_PORT}`

/** The URL of the page exhibiting one fault. */
export function subjectUrl(fault: FaultName): string {
  return `${SUBJECT_URL}/?fault=${encodeURIComponent(fault)}`
}

export function startSubject(port: number = SUBJECT_PORT): Promise<Server> {
  /** Requests to `/api/slow`, kept so they can be destroyed on shutdown. */
  const hanging = new Set<ServerResponse>()

  const server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', SUBJECT_URL)

    if (url.pathname === SUMMARY_PATH) {
      outgoing.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      outgoing.end(JSON.stringify(SUMMARY))

      return
    }

    if (url.pathname === BROKEN_PATH) {
      // A body, because a 500 with an empty body and a 500 with a stack trace
      // are different debugging experiences and the network channel is where
      // the difference shows up.
      outgoing.writeHead(500, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      outgoing.end(JSON.stringify({ error: 'summary projection unavailable' }))

      return
    }

    if (url.pathname === SLOW_PATH) {
      hanging.add(outgoing)
      outgoing.on('close', () => hanging.delete(outgoing))

      return
    }

    if (url.pathname !== '/') {
      outgoing.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      outgoing.end('not found')

      return
    }

    const requested = url.searchParams.get('fault') ?? 'none'

    if (!isFaultName(requested)) {
      // Answering an unknown fault with the healthy page would make every test
      // that mistyped one pass for the wrong reason.
      outgoing.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      outgoing.end(`unknown fault: ${requested}`)

      return
    }

    outgoing.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    outgoing.end(render(requested))
  })

  server.on('close', () => {
    for (const pending of hanging) {
      pending.destroy()
    }
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await startSubject()
  process.stdout.write(`trace subject fixture on ${SUBJECT_PORT}\n`)
}
