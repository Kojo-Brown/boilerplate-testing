/**
 * `subject.ts`, bound to a socket.
 *
 * The same split as `a11y/server.ts`, `matrix/server.ts` and
 * `intercept/server.ts`, for the same reason: the document is a pure function
 * and auditable without a port, so this file is only the binding.
 *
 * The revision and the nonce come in as query parameters rather than as paths,
 * because they are not resources — they are two knobs on one page, and a cell
 * asks for the same page twice with one of them moved.
 *
 * `cache-control: no-store` is not hygiene here, it is the measurement: a
 * cached second render would be byte-identical to the first, and every noise
 * cell would come back `clean` for a reason that has nothing to do with the
 * wiring under test.
 */

import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import { BASELINE_NONCE, render } from './subject.ts'

export const SUBJECT_PORT = 3113
export const SUBJECT_URL = `http://127.0.0.1:${SUBJECT_PORT}`

/** The URL for one revision of the subject. */
export function subjectUrl(change: string | null, nonce: number = BASELINE_NONCE): string {
  const query = new URLSearchParams({ nonce: String(nonce) })

  if (change !== null) {
    query.set('change', change)
  }

  return `${SUBJECT_URL}/?${query.toString()}`
}

export function startSubject(port: number = SUBJECT_PORT): Promise<Server> {
  const server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', SUBJECT_URL)
    const change = url.searchParams.get('change')
    const nonce = Number(url.searchParams.get('nonce') ?? BASELINE_NONCE)

    let body: string

    try {
      body = render({ change, nonce: Number.isFinite(nonce) ? nonce : BASELINE_NONCE })
    } catch (error) {
      // An unknown revision is a typo in a spec, and answering it with the
      // baseline would report `same` for every cell that used it.
      outgoing.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      outgoing.end((error as Error).message)

      return
    }

    outgoing.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    outgoing.end(body)
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await startSubject()
  process.stdout.write(`visual subject fixture on ${SUBJECT_PORT}\n`)
}
