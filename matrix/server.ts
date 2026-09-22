/**
 * `page.ts`, bound to a socket.
 *
 * The same split as `intercept/server.ts` one directory over, for the same
 * reason: the page is a constant and testable without a port, so this file is
 * only the binding. It serves one document at every path — the probes never
 * navigate anywhere else, and a 404 route would be a branch nothing takes.
 */

import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import { PAGE_HTML, PAGE_PORT } from './page.ts'

export function startPage(port: number = PAGE_PORT): Promise<Server> {
  const server = createServer((_incoming, outgoing) => {
    outgoing.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // The probes measure the page, not a cache.
      'cache-control': 'no-store',
    })
    outgoing.end(PAGE_HTML)
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await startPage()
  process.stdout.write(`emulation probe page on ${PAGE_PORT}\n`)
}
