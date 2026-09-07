/**
 * The container runtime as this directory sees it: is there one, do we reuse
 * containers against it, and how is our own rubbish labelled.
 *
 * ---------------------------------------------------------------------------
 * Why reuse is off in CI
 * ---------------------------------------------------------------------------
 * `withReuse()` is usually presented as a straight speed-up, and on a laptop it
 * is. On a CI runner it is not a speed-up at all — it is a liability with the
 * upside removed — and both halves of that are mechanical rather than a matter
 * of taste.
 *
 * The upside is removed because reuse can only find a container that is
 * already running, and a fresh runner's daemon has none. Every reuse lookup on
 * a hosted runner misses, every container is created cold, and the saving is
 * exactly zero on every run.
 *
 * The liability is that reuse opts a container out of the reaper. Ryuk works by
 * the session label `org.testcontainers.session-id`, which
 * `GenericContainer#start` attaches on the *non*-reuse path only: the reuse
 * path returns before that line is reached, which is the point — a container
 * labelled with this session's id would be destroyed when this session ends,
 * and then there would be nothing to reuse. So a reused container is one
 * nothing will ever clean up. That is the correct trade on a developer machine
 * (`pnpm containers:prune` is one command, and the container is the thing you
 * wanted to keep) and the wrong one anywhere a process might be sharing a
 * daemon with somebody else's build.
 *
 * Hence: reuse when a human is watching, cold containers when CI is. Both are
 * overridable with `CONTAINERS_REUSE`, because the measurement in `cost.ts`
 * has to be able to ask for either.
 */

import { getContainerRuntimeClient } from 'testcontainers'

/**
 * The label every container started from this directory carries.
 *
 * Testcontainers' own `org.testcontainers=true` is on all of them already, and
 * that is not specific enough to prune against: on a shared daemon it also
 * matches somebody else's suite. This one names the directory.
 */
export const PROJECT_LABEL = 'com.boilerplate-testing.containers'

/** Value of {@link PROJECT_LABEL} on containers this directory starts. */
export const PROJECT_LABEL_VALUE = 'true'

/**
 * Whether containers are started with `withReuse()`.
 *
 * `CONTAINERS_REUSE` wins when set to `1`/`true` or `0`/`false`; otherwise the
 * policy above applies. `CI` is the variable every hosted runner sets and is
 * what `process.env.CI` means everywhere else in this repository.
 */
export function reuseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env['CONTAINERS_REUSE']

  if (explicit === '1' || explicit === 'true') {
    return true
  }

  if (explicit === '0' || explicit === 'false') {
    return false
  }

  return env['CI'] === undefined || env['CI'] === ''
}

/**
 * Ask the daemon whether it is there.
 *
 * Called once by the project's global setup so that a missing daemon is one
 * legible sentence rather than a container-start timeout in whichever suite
 * happened to run first. The client is a singleton inside Testcontainers, so
 * this also front-loads its one-off probing of the socket.
 */
export async function containerRuntimeInfo(): Promise<
  { readonly available: true; readonly description: string } | { readonly available: false; readonly reason: string }
> {
  try {
    const client = await getContainerRuntimeClient()
    const { containerRuntime } = client.info

    return {
      available: true,
      description:
        `${containerRuntime.operatingSystemType} ${containerRuntime.serverVersion} at ${containerRuntime.host}, ` +
        `${containerRuntime.cpus} CPU(s)`,
    }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
