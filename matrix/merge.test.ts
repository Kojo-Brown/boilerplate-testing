// @vitest-environment node
//
// Spawns real `playwright test` runs and `playwright merge-reports`. No
// browser: nothing in `fixture/specs/` asks for a page, which `fixture.test.ts`
// keeps true.

import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FIXTURE_CONFIG, FIXTURE_FILES } from './fixture.ts'
import { mergeReports, runShard, scratchDir, type MergedReport } from './reports.ts'

const SHARDS = 3
const TOTAL = FIXTURE_FILES.reduce((count, file) => count + file.titles.length, 0)

let scratch = ''
let everyBlob = ''
let missingOne = ''
let sharedDir = ''
let emptyShardExit = -1
let merged: MergedReport
let partial: MergedReport

beforeAll(async () => {
  scratch = scratchDir()
  everyBlob = join(scratch, 'every')
  missingOne = join(scratch, 'missing-one')
  sharedDir = join(scratch, 'shared')
  mkdirSync(everyBlob, { recursive: true })
  mkdirSync(missingOne, { recursive: true })

  // Three shards, three directories — one per machine, as a real matrix runs.
  const runs = await Promise.all(
    Array.from({ length: SHARDS }, (_unused, at) =>
      runShard({
        config: FIXTURE_CONFIG,
        shard: { current: at + 1, total: SHARDS },
        blobDir: join(scratch, `shard-${at + 1}`),
        fullyParallel: true,
        projects: 'single',
      }),
    ),
  )

  for (const [at, shard] of runs.entries()) {
    for (const name of readdirSync(shard.blobDir)) {
      cpSync(join(shard.blobDir, name), join(everyBlob, name))

      // The artifact set a CI job would end up with if one shard's upload
      // failed, or one runner was lost, or somebody edited the matrix.
      if (at > 0) {
        cpSync(join(shard.blobDir, name), join(missingOne, name))
      }
    }
  }

  // Shard 7 of 8 is the one `grouping.ts` records as empty.
  const empty = await runShard({
    config: FIXTURE_CONFIG,
    shard: { current: 7, total: 8 },
    blobDir: join(scratch, 'empty'),
    fullyParallel: true,
    projects: 'single',
  })

  emptyShardExit = empty.exitCode

  // Two shards pointed at one directory, which is what running a matrix
  // locally to "check the sharding works" looks like.
  for (const current of [1, 2]) {
    await runShard({
      config: FIXTURE_CONFIG,
      shard: { current, total: SHARDS },
      blobDir: sharedDir,
      fullyParallel: true,
      projects: 'single',
    })
  }

  merged = await mergeReports(everyBlob)
  partial = await mergeReports(missingOne)
}, 180_000)

afterAll(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true })
  }
})

describe('putting a sharded run back together', () => {
  it('recovers the whole suite from the blob reports', () => {
    expect(merged.expected).toBe(TOTAL)
    expect(merged.titles).toHaveLength(TOTAL)
    expect(merged.unexpected).toBe(0)
  })

  it('reports a lost shard as a smaller run, not a failed one', () => {
    // This is the finding. Drop one shard's report and the merge still says
    // zero failures — it simply describes a smaller suite. Nothing in the
    // report knows how many tests there were supposed to be, so "all jobs
    // green" is a statement about the jobs that ran.
    expect(partial.unexpected).toBe(0)
    expect(partial.expected).toBeLessThan(TOTAL)
    expect(partial.titles.length).toBeLessThan(merged.titles.length)
  })

  it('leaves the total as the only thing worth asserting on', () => {
    // Which is why a sharded pipeline needs a count it can check: the merged
    // report's own numbers are self-consistent either way.
    const lost = merged.titles.filter((title) => !partial.titles.includes(title))

    expect(lost.length).toBeGreaterThan(0)
    expect(partial.expected + lost.length).toBe(merged.expected)
  })
})

describe('the two ways a sharded matrix loses a report', () => {
  it('exits zero for a shard with no tests in it', () => {
    // `grouping.ts` records shard 7 of 8 as empty. An empty shard is not an
    // error: the job goes green, having run nothing, and only the merged
    // count can tell.
    expect(emptyShardExit).toBe(0)
  })

  it('keeps one report when two shards write to one blob directory', () => {
    // The blob reporter clears its output directory on start. On a real matrix
    // each shard has its own filesystem and this never comes up; in a local
    // reproduction, or a CI job that shards inside one runner, the earlier
    // reports are gone before the merge sees them.
    expect(readdirSync(sharedDir)).toHaveLength(1)
  })
})
