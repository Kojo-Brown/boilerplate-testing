/**
 * The fixture origin, bound to a socket.
 *
 * The only file in `lighthouse/` that imports `node:http`, for the reason
 * `fixture.ts` gives. Two entry points, because there are two ways it is
 * needed:
 *
 *   - `startOrigin()` — used by `check.ts`, which needs the origin in the same
 *     process as the Lighthouse run it is driving.
 *   - `node lighthouse/server.ts` — for running `lhci` against it by hand:
 *
 *         node lighthouse/server.ts &
 *         CHROME_PATH=$(which chromium) pnpm lighthouse:ci
 *
 * `Cache-Control: no-store` on everything is load-bearing. Lighthouse's own
 * `uses-long-cache-ttl` audit would flag it, which is why that audit is not
 * among the ones the published config asserts — but a cached asset would make
 * the second of two runs measure a different page from the first, and the
 * resource-summary rows are the whole measurement.
 */

import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import type { Budget } from './budgets.ts'
import { loadBudgets } from './load.ts'
import { ORIGIN_PORT, route } from './fixture.ts'

export interface Origin {
  readonly port: number
  readonly baseUrl: string
  close(): Promise<void>
}

export function portFromEnv(value: string | undefined = process.env['LH_ORIGIN_PORT']): number {
  if (value === undefined || value === '') return ORIGIN_PORT

  const parsed = Number(value)

  // 0 is allowed, and is how `check.ts` and this module's suite ask the OS for
  // a free port rather than racing for a fixed one.
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`LH_ORIGIN_PORT must be a non-negative integer, got ${JSON.stringify(value)}`)
  }

  return parsed
}

export function startOrigin(
  port = portFromEnv(),
  budgets: readonly Budget[] = loadBudgets(),
): Promise<Origin> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const { status, contentType, body } = route(path, budgets)

    req.resume()
    res.writeHead(status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    })
    res.end(body)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        reject(new Error('Origin bound to a pipe rather than a TCP port'))
        return
      }

      resolve({
        port: address.port,
        baseUrl: `http://localhost:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const origin = await startOrigin()
  process.stdout.write(`Lighthouse fixture origin ready on ${origin.baseUrl}\n`)
}
