// @vitest-environment node
//
// `fixture.ts` resolves the fixture directory from `import.meta.url`, which the
// project-default jsdom environment rewrites to an http: URL that
// `fileURLToPath` rejects. Nothing here needs a DOM — a shard partition is
// arithmetic over file names.

/**
 * The first link of the chain: the hand-written tables against the model.
 *
 * Browser-free and instant. `partition.test.ts` is the second link, and runs
 * the real CLI.
 */

import { describe, expect, it } from 'vitest'

import { FIXTURE_FILES, SINGLE_PROJECT, MATRIX_PROJECTS } from './fixture.ts'
import {
  FINDINGS,
  FIXTURE_TEST_COUNT,
  GROUP_SHAPES,
  SETUP_RUNS,
  SHARD_BALANCE,
  type Unit,
} from './grouping.ts'
import { dependencyNames, groupsOf, shardContents, shardSizes } from './shard.ts'

/** Group sizes one fixture file produces under one configuration. */
function sizesFor(file: string, fullyParallel: boolean, shardTotal: number): number[] {
  const spec = FIXTURE_FILES.find((candidate) => candidate.file === file)

  if (!spec) {
    throw new Error(`no fixture file named ${file}`)
  }

  return groupsOf('solo', [spec], { fullyParallel, shardTotal }).map(
    (group) => group.testIds.length,
  )
}

/** The unit a set of group sizes implies, for a file of `tests` tests. */
function unitOf(tests: number, sizes: readonly number[]): Unit {
  if (sizes.length === 1) {
    return sizes[0] === tests ? 'file' : 'chunk'
  }

  return sizes.every((size) => size === 1) ? 'test' : 'chunk'
}

describe('group shapes', () => {
  it.each(GROUP_SHAPES)('$file groups as the table says under both configs', (row) => {
    expect(sizesFor(row.file, false, 3)).toEqual(row.sequential)
    expect(sizesFor(row.file, true, 3)).toEqual(row.parallelAt3)
    expect(sizesFor(row.file, true, 6)).toEqual(row.parallelAt6)
  })

  it.each(GROUP_SHAPES)('$file adds up to its own test count', (row) => {
    const total = (sizes: readonly number[]): number => sizes.reduce((a, b) => a + b, 0)

    expect(total(row.sequential)).toBe(row.tests)
    expect(total(row.parallelAt3)).toBe(row.tests)
    expect(total(row.parallelAt6)).toBe(row.tests)
  })

  it.each(GROUP_SHAPES)('$file has the unit the table names', (row) => {
    // `serial` is the one shape whose unit is not readable from the sizes: a
    // block of every test in the file is indistinguishable from the file. The
    // table distinguishes them because the *reason* differs, and the reason is
    // what a reader needs — a serial block stays one group after somebody
    // turns `fullyParallel` on, and a plain file does not.
    const named = row.shape === 'serial' ? 'file' : row.sequentialUnit

    expect(unitOf(row.tests, row.sequential)).toBe(named)
    expect(unitOf(row.tests, row.parallelAt3)).toBe(
      row.shape === 'serial' ? 'file' : row.parallelUnit,
    )
  })

  it('covers every unit the type admits except one', () => {
    const units = new Set<Unit>([
      ...GROUP_SHAPES.map((row) => row.sequentialUnit),
      ...GROUP_SHAPES.map((row) => row.parallelUnit),
    ])

    // 'block' is carried by `serial` alone, and is a claim about *why* rather
    // than about sizes; the other three are each measured by a file above.
    expect([...units].sort()).toEqual(['block', 'chunk', 'file', 'test'])
  })
})

describe('shard balance', () => {
  it('measures a 23-test fixture', () => {
    expect(FIXTURE_TEST_COUNT).toBe(23)
  })

  it.each(SHARD_BALANCE)('$shards shards land as the table says', (row) => {
    const sizes = (fullyParallel: boolean): number[] =>
      Array.from({ length: row.shards }, (_unused, at) =>
        shardContents(SINGLE_PROJECT, at + 1, row.shards, { fullyParallel }).length,
      )

    expect(shardSizes(FIXTURE_TEST_COUNT, row.shards)).toEqual(row.nominal)
    expect(sizes(false)).toEqual(row.sequential)
    expect(sizes(true)).toEqual(row.parallel)
  })

  it.each(SHARD_BALANCE)('$shards shards partition the suite without loss', (row) => {
    for (const fullyParallel of [false, true]) {
      const seen = Array.from({ length: row.shards }, (_unused, at) =>
        shardContents(SINGLE_PROJECT, at + 1, row.shards, { fullyParallel }),
      ).flat()

      expect(seen).toHaveLength(FIXTURE_TEST_COUNT)
      expect(new Set(seen).size).toBe(FIXTURE_TEST_COUNT)
    }
  })
})

describe('dependency projects', () => {
  it('names setup as the one project excluded from the cut', () => {
    expect([...dependencyNames(MATRIX_PROJECTS)]).toEqual(['setup'])
  })

  it.each(SETUP_RUNS)('runs setup $runs times across $shards shards', (row) => {
    for (const fullyParallel of [false, true]) {
      const runs = Array.from({ length: row.shards }, (_unused, at) =>
        shardContents(MATRIX_PROJECTS, at + 1, row.shards, { fullyParallel }),
      ).filter((contents) => contents.some((id) => id.startsWith('setup › '))).length

      expect(runs).toBe(row.runs)
    }
  })

  it('leaves a shard holding no dependent tests without the dependency', () => {
    // The multiplication is "once per shard that kept a dependent test", not
    // "once per shard". `SETUP_RUNS` cannot tell those apart, because in the
    // fixture's matrix shape every shard keeps one. Dropping `mobile`'s
    // dependency separates them: the shards that are all `mobile` now skip
    // setup, and the ones holding any `desktop` test still pay for it.
    const oneDependent = MATRIX_PROJECTS.map((project) =>
      project.name === 'mobile' ? { ...project, dependencies: [] } : project,
    )

    const shards = Array.from({ length: 4 }, (_unused, at) =>
      shardContents(oneDependent, at + 1, 4, { fullyParallel: true }),
    )

    const hasSetup = shards.map((contents) => contents.some((id) => id.startsWith('setup › ')))
    const hasDesktop = shards.map((contents) => contents.some((id) => id.startsWith('desktop › ')))

    expect(hasSetup).toEqual(hasDesktop)
    expect(hasSetup).toContain(false)
  })

  it('shards a project nobody depends on like any other', () => {
    // `dependencies` is what excludes a project from the cut — not its name,
    // not `testMatch`. Remove every dependency and `setup` stops being special:
    // its one test is sharded into exactly one shard, like every other test.
    const independent = MATRIX_PROJECTS.map((project) => ({ ...project, dependencies: [] }))

    const runs = Array.from({ length: 4 }, (_unused, at) =>
      shardContents(independent, at + 1, 4, { fullyParallel: true }),
    ).filter((contents) => contents.some((id) => id.startsWith('setup › '))).length

    expect(runs).toBe(1)
  })
})

describe('findings', () => {
  it.each(Object.entries(FINDINGS))('%s holds over the tables', (_name, holds) => {
    expect(holds()).toBe(true)
  })
})
