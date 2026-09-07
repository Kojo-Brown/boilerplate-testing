/**
 * Remove the containers this directory left running.
 *
 * There is normally nothing to remove, and the case where there is has one
 * cause: reuse. `GenericContainer#start` attaches the reaper's session label on
 * the path that does *not* reuse, so a reused container is deliberately
 * unknown to Ryuk — otherwise the end of the session that created it would
 * destroy the thing the next session was going to reuse. That is the right
 * trade on a developer machine and it means the cleanup is manual, which means
 * it needs to be one command.
 *
 * Scoped to this repository's own label rather than to `org.testcontainers`,
 * because the second one also matches whatever else on this machine happens to
 * use Testcontainers, and a prune that stops somebody's unrelated database is
 * a worse problem than the one it solves.
 *
 * Run with `pnpm containers:prune`.
 */

import { getContainerRuntimeClient } from 'testcontainers'

import { PROJECT_LABEL, PROJECT_LABEL_VALUE } from './daemon.ts'

export interface PrunedContainer {
  readonly id: string
  readonly image: string
  readonly state: string
}

/** Remove every container carrying this directory's label. Returns what went. */
export async function prune(): Promise<readonly PrunedContainer[]> {
  const client = await getContainerRuntimeClient()
  const containers = await client.container.list()
  const ours = containers.filter((container) => container.Labels[PROJECT_LABEL] === PROJECT_LABEL_VALUE)
  const removed: PrunedContainer[] = []

  for (const info of ours) {
    const container = client.container.getById(info.Id)

    if (info.State === 'running') {
      await client.container.stop(container, { timeout: 10 })
    }

    await client.container.remove(container, { removeVolumes: true })
    removed.push({ id: info.Id.slice(0, 12), image: info.Image, state: info.State })
  }

  return removed
}

async function main(): Promise<void> {
  const removed = await prune()

  if (removed.length === 0) {
    console.info('Nothing to prune: no container carries', PROJECT_LABEL)

    return
  }

  for (const container of removed) {
    console.info(`Removed ${container.id} (${container.image}, was ${container.state})`)
  }
}

// Only when run as a script, so `prune.test.ts` can import `prune` without the
// import removing anything.
if (process.argv[1]?.endsWith('prune.ts') === true) {
  await main()
}
