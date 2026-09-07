/**
 * What `withReuse()` actually does, and what it costs.
 *
 * Three claims, each of which somebody will otherwise take on trust:
 *
 *   1. A second start adopts the running container rather than making another.
 *      Nothing in the API tells you which happened — both return a started
 *      container — so the only way to know is to compare ids.
 *   2. The match is on a hash of the container's whole creation request. Change
 *      any of it, including a label, and reuse silently starts a second
 *      container instead of failing. That is the mode this is most likely to be
 *      wrong in: not "reuse broke something" but "reuse quietly stopped
 *      happening and the suite just got slower".
 *   3. A reused container carries no `org.testcontainers.session-id`, so the
 *      reaper will never remove it. That is the price of (1), it is not a bug,
 *      and it is why `pnpm containers:prune` exists.
 *
 * Redis is the subject throughout: it is the cheapest of the three to start,
 * and none of these claims is about what is inside the container.
 */

import { afterAll, describe, expect, it } from 'vitest'

import { PROJECT_LABEL } from './daemon.ts'
import { SESSION_LABEL } from './readiness.ts'
import { startUsableStore, type StartedStore } from './stores.ts'

const started: StartedStore[] = []

/** Every container this file starts is stopped here, reused or not. */
const track = async (container: Promise<StartedStore>): Promise<StartedStore> => {
  const resolved = await container

  if (!started.some((existing) => existing.containerId === resolved.containerId)) {
    started.push(resolved)
  }

  return resolved
}

afterAll(async () => {
  await Promise.all(started.map((container) => container.stop()))
  started.length = 0
})

describe('withReuse', () => {
  it('adopts the running container on the second start', async () => {
    const first = await track(startUsableStore('redis', { reuse: true, variant: 'adoption' }))
    const second = await track(startUsableStore('redis', { reuse: true, variant: 'adoption' }))

    expect(second.containerId).toBe(first.containerId)
  })

  it('starts a second container when any part of the creation request differs', async () => {
    const original = await track(startUsableStore('redis', { reuse: true, variant: 'hash-a' }))
    const changed = await track(startUsableStore('redis', { reuse: true, variant: 'hash-b' }))

    // One label. Labels are merged into the creation options before the hash is
    // taken, so this is a different container and the only visible symptom of
    // that, in a real suite, is the wall clock.
    expect(changed.containerId).not.toBe(original.containerId)
  })

  it('leaves the reused container unlabelled for the reaper', async () => {
    const reused = await track(startUsableStore('redis', { reuse: true, variant: 'reaper' }))
    const fresh = await track(startUsableStore('redis', { reuse: false }))

    expect(fresh.container.getLabels()[SESSION_LABEL]).toBeDefined()
    expect(reused.container.getLabels()[SESSION_LABEL]).toBeUndefined()
  })

  it('keeps this directory’s own label on both, so prune can find either', async () => {
    const reused = await track(startUsableStore('redis', { reuse: true, variant: 'reaper' }))
    const fresh = await track(startUsableStore('redis', { reuse: false }))

    expect(reused.container.getLabels()[PROJECT_LABEL]).toBe('true')
    expect(fresh.container.getLabels()[PROJECT_LABEL]).toBe('true')
  })
})
