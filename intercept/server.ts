/**
 * The fixture origin, bound to a socket.
 *
 * This is the only file in `intercept/` that imports `node:http`, and it is
 * kept to the binding for that reason: `origin.ts` holds the seven routes and
 * is testable without a port, so the shape census counts one integration test
 * here rather than the whole directory.
 *
 * Two entry points, because there are two ways this origin is needed:
 *
 *   - `startOrigin()` — used by `record.ts`, which needs the server in the
 *     same process as the browser it is driving.
 *   - `node intercept/server.ts` — used by the Playwright config's
 *     `webServer`, which starts it as a child process and waits for the port.
 *
 * `INTERCEPT_SCHEMA` overrides the version served. Nothing but `record.ts`
 * sets it; it exists so the committed HAR can be recorded against the origin's
 * *previous* shape without a second copy of the routes.
 */

import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import { createState, respond, ORIGIN_PORT, CURRENT_SCHEMA } from './origin.ts'

/** Read the served schema version from the environment, falling back to today's. */
export function schemaFromEnv(value: string | undefined): number {
  if (value === undefined) {
    return CURRENT_SCHEMA
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`INTERCEPT_SCHEMA must be a positive integer, got ${JSON.stringify(value)}`)
  }

  return parsed
}

/**
 * Bind the origin and resolve once it is accepting connections.
 *
 * The state map is created per server rather than per module, so two origins
 * in one process — which `record.ts` never needs but a future suite might —
 * do not share the `/api/flaky` ledger.
 */
export function startOrigin(schema: number = CURRENT_SCHEMA): Promise<Server> {
  const state = createState()

  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []

    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const response = respond(
        {
          method: incoming.method ?? 'GET',
          url: incoming.url ?? '/',
          body: Buffer.concat(chunks).toString('utf8'),
        },
        state,
        schema,
      )

      outgoing.writeHead(response.status, {
        'content-type': response.contentType,
        // The recording and the replay have to agree on the bytes, and a
        // `content-length` that disagrees with a body Playwright re-serialises
        // is the kind of mismatch that reads as a hung request. Letting Node
        // compute it keeps the two consistent.
        'cache-control': 'no-store',
      })
      outgoing.end(response.body)
    })
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(ORIGIN_PORT, () => resolve(server))
  })
}

// `import.meta.main` is Node 24 and later; the supported range starts at 22,
// so the check is the portable one — this module was started directly rather
// than imported. `record.ts` imports it and starts the origin itself, and
// would otherwise bind the port twice.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startOrigin(schemaFromEnv(process.env['INTERCEPT_SCHEMA']))
}
