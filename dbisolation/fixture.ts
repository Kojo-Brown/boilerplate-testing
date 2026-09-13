/**
 * The container this directory runs against, which is the one `containers/`
 * already started.
 *
 * ---------------------------------------------------------------------------
 * Why this borrows a container rather than starting one
 * ---------------------------------------------------------------------------
 * `containers/suite.ts` starts one Postgres per run, lazily, and hands it to
 * every suite that asks. Starting a second one here would cost another cold
 * start for no coverage, and it would quietly contradict the conclusion that
 * directory reached — a container per suite is what its whole matrix argues
 * against.
 *
 * What this directory needs on top of that is the *administrative* connection:
 * every strategy here gets a database of its own, created and dropped around
 * it, so the fixture is a `Server` rather than a schema. The container's
 * `POSTGRES_USER` is the image's superuser, so `CREATE DATABASE` is available
 * without any further arrangement.
 *
 * ---------------------------------------------------------------------------
 * The nonce
 * ---------------------------------------------------------------------------
 * Every database this directory creates carries `RUN_ID`, for the reason
 * `containers/suite.ts` gives about schema names: a name derived from the
 * strategy alone is unique within a run and identical across runs, which is
 * exactly the state a *reused* container preserves. With reuse on — the default
 * on a developer machine — a second `pnpm test:containers` would collide with
 * the first run's leftovers on its first `CREATE DATABASE`.
 */

import { RUN_ID, sharedStore } from '@/containers/suite.ts'

import type { Server } from './strategies.ts'
import { serverAt } from './strategies.ts'

/**
 * The Postgres server for this suite.
 *
 * Returns an accessor rather than the server, because the container is started
 * in `beforeAll` and there is nothing to hand back at describe time. Calling it
 * from a test body is always safe; calling it at describe time is the mistake
 * the thrown message names.
 */
export function usePostgresServer(suiteName: string): () => Server {
  let server: Server | null = null

  beforeAll(async () => {
    const started = await sharedStore('postgres')

    server = serverAt(started.address)
  }, 300_000)

  return () => {
    if (server === null) {
      throw new Error(`The ${suiteName} Postgres server is only available inside a test or a hook after beforeAll`)
    }

    return server
  }
}

/** A database-name fragment unique to this run and this suite. */
export const nonceFor = (suiteName: string): string =>
  `${suiteName.toLowerCase().replace(/[^a-z0-9]+/g, '')}${RUN_ID.replace(/-/g, '')}`.slice(0, 24)
