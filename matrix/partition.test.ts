// @vitest-environment node
//
// This suite spawns `playwright test --list`, which needs a filesystem and a
// child process rather than a DOM. It needs no browser: `--list` resolves the
// config and loads the spec files without launching one, which is why the
// whole sharding half of this directory runs in `pnpm test` while the
// emulation half needs its own job.

import { describe, expect, it } from 'vitest'

import { FIXTURE_CONFIG, MATRIX_PROJECTS, SINGLE_PROJECT } from './fixture.ts'
import { listTests } from './list.ts'
import { shardContents, type ProjectSpec } from './shard.ts'

/** The two project shapes the fixture config can be asked for. */
const SHAPES = {
  single: SINGLE_PROJECT,
  matrix: MATRIX_PROJECTS,
} satisfies Record<string, readonly ProjectSpec[]>

type ShapeName = keyof typeof SHAPES

interface Case {
  readonly projects: ShapeName
  readonly fullyParallel: boolean
  readonly shards: number
}

/**
 * Which partitions get checked against the real CLI, and why these.
 *
 * Four shards is where the default config's balance is at its worst
 * (`[8, 4, 10, 1]`), so it is the case a wrong model is most likely to get
 * right by accident. Eight is where a shard goes empty. Three is the one the
 * `matrix` shape is checked at, because what that shape adds — a dependency
 * project re-attached after the cut — does not vary with the shard count.
 *
 * Twenty-four CLI calls, run concurrently per case. The full cross product of
 * {1,2,3,4,6,8} shards, both configs and both shapes is 64 and was run by hand
 * while the model was being written; what is kept here is the subset that
 * covers every branch of `groupsOf` and both branches of `shardContents`.
 */
const CASES: readonly Case[] = [
  { projects: 'single', fullyParallel: false, shards: 4 },
  { projects: 'single', fullyParallel: true, shards: 4 },
  { projects: 'single', fullyParallel: true, shards: 8 },
  { projects: 'matrix', fullyParallel: false, shards: 3 },
  { projects: 'matrix', fullyParallel: true, shards: 3 },
]

async function realShard(test: Case, current: number): Promise<string[]> {
  const ids = await listTests({
    config: FIXTURE_CONFIG,
    shard: { current, total: test.shards },
    fullyParallel: test.fullyParallel,
    projects: test.projects,
  })

  return [...ids].sort()
}

function modelledShard(test: Case, current: number): string[] {
  return [
    ...shardContents(SHAPES[test.projects], current, test.shards, {
      fullyParallel: test.fullyParallel,
    }),
  ].sort()
}

describe('the model against playwright itself', () => {
  it.each(CASES)(
    '$projects, fullyParallel=$fullyParallel, $shards shards: every shard matches the model',
    async (test) => {
      const shards = Array.from({ length: test.shards }, (_unused, at) => at + 1)
      const real = await Promise.all(shards.map((current) => realShard(test, current)))

      expect(real).toEqual(shards.map((current) => modelledShard(test, current)))
    },
    60_000,
  )

  it(
    'accounts for every test exactly once across the shards it cuts',
    async () => {
      const test = CASES[0]

      if (!test) {
        throw new Error('no cases')
      }

      const shards = Array.from({ length: test.shards }, (_unused, at) => at + 1)
      const sharded = (await Promise.all(shards.map((current) => realShard(test, current)))).flat()
      const whole = await listTests({
        config: FIXTURE_CONFIG,
        fullyParallel: test.fullyParallel,
        projects: test.projects,
      })

      // Disjointness and coverage, which is the only property of sharding that
      // is unconditionally safe to rely on — and the one the rest of this
      // directory exists to say is not enough.
      expect(sharded).toHaveLength(whole.length)
      expect([...new Set(sharded)].sort()).toEqual([...whole].sort())
    },
    60_000,
  )

  it(
    'runs the dependency project in every shard of the matrix shape',
    async () => {
      const shards = [1, 2, 3]
      const contents = await Promise.all(
        shards.map((current) =>
          realShard({ projects: 'matrix', fullyParallel: true, shards: 3 }, current),
        ),
      )

      const setups = contents.map(
        (ids) => ids.filter((id) => id.startsWith('setup › ')).length,
      )

      // Once per shard, not once per run: the same login, three times.
      expect(setups).toEqual([1, 1, 1])
    },
    60_000,
  )
})
