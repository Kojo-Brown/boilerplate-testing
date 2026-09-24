/**
 * `page.ts`, bound to a socket.
 *
 * The same split as `matrix/server.ts` and `intercept/server.ts`, for the same
 * reason: the journey is a constant and testable without a port, so this file
 * is only the binding.
 *
 * It serves the same document at every path, which is not laziness — it is what
 * a client-rendered application deploys. `/details` has to return the app shell
 * so that a per-page strategy can `goto` it directly, and the page's own script
 * reads `location.pathname` to decide which view to show. A server that only
 * answered `/` would make the per-page strategies fail to load rather than fail
 * to see, and those are different findings.
 */

import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import { PAGE_HTML, PAGE_PORT } from './page.ts'

export function startJourney(port: number = PAGE_PORT): Promise<Server> {
  const server = createServer((_incoming, outgoing) => {
    outgoing.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // The scans measure the journey, not a cache.
      'cache-control': 'no-store',
    })
    outgoing.end(PAGE_HTML)
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await startJourney()
  process.stdout.write(`a11y journey fixture on ${PAGE_PORT}\n`)
}
