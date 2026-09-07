/**
 * Vitest global setup for the container project.
 *
 * It does one thing: ask the daemon whether it is there, before any suite
 * tries to start something against it. A missing runtime is otherwise reported
 * as a start-up timeout inside whichever file Vitest happened to schedule
 * first, which is a two-minute wait followed by a message about Postgres — and
 * the problem was never Postgres.
 *
 * It deliberately does *not* start the containers. They are started lazily by
 * `suite.ts`, in the worker, so a run filtered down to `images.test.ts` starts
 * nothing at all.
 */

import { containerRuntimeInfo, reuseEnabled } from './daemon.ts'

export async function setup(): Promise<void> {
  const info = await containerRuntimeInfo()

  if (!info.available) {
    throw new Error(
      'No container runtime is reachable, so the container suites cannot run.\n' +
        `The runtime client reported: ${info.reason}\n` +
        'Start Docker (or set DOCKER_HOST / TESTCONTAINERS_HOST_OVERRIDE) and run `pnpm test:containers` again. ' +
        '`pnpm test` does not need a runtime and is unaffected.',
    )
  }

  console.info(`[containers] runtime: ${info.description}; reuse ${reuseEnabled() ? 'on' : 'off'}`)
}
