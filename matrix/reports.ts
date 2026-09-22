/**
 * Running the fixture for real, sharded, and putting the pieces back together.
 *
 * `list.ts` answers what a shard *would* run. This answers what a sharded run
 * *reports*, which is a different question and the one that decides whether a
 * green CI matrix means anything. The runs are real — `playwright test`, not
 * `--list` — and they still need no browser, because no fixture spec asks for
 * a page.
 *
 * Each shard writes into its own blob directory, the way each shard in a real
 * matrix writes on its own machine. That is not a detail: the blob reporter
 * clears its output directory before writing, so two shards pointed at one
 * directory leave one report, and `merge.test.ts` measures that.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

const PLAYWRIGHT_BIN = fileURLToPath(new URL('../node_modules/.bin/playwright', import.meta.url))

/** A scratch directory for one test file's runs, removed by its `afterAll`. */
export function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'matrix-shard-'))
}

export interface ShardRun {
  readonly exitCode: number
  /** Where `--reporter=blob` put `report-<k>.zip`. */
  readonly blobDir: string
}

/**
 * Run one shard of the fixture for real.
 *
 * `blobDir` is a parameter rather than derived so that a caller can point two
 * shards at the same directory on purpose.
 */
export async function runShard(options: {
  readonly config: string
  readonly shard: { readonly current: number; readonly total: number }
  readonly blobDir: string
  readonly fullyParallel: boolean
  readonly projects: 'single' | 'matrix'
}): Promise<ShardRun> {
  const args = [
    'test',
    '--config',
    options.config,
    `--shard=${options.shard.current}/${options.shard.total}`,
    '--reporter=blob',
  ]

  try {
    await run(PLAYWRIGHT_BIN, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_BLOB_OUTPUT_DIR: options.blobDir,
        FIXTURE_FULLY_PARALLEL: options.fullyParallel ? '1' : '0',
        FIXTURE_PROJECTS: options.projects,
        CI: '',
      },
    })

    return { exitCode: 0, blobDir: options.blobDir }
  } catch (error) {
    // `execFile` rejects on a non-zero exit, and a non-zero exit is data here
    // rather than a failure: the whole point is which runs report green.
    const code = (error as { code?: number }).code

    return { exitCode: typeof code === 'number' ? code : 1, blobDir: options.blobDir }
  }
}

/** What `merge-reports --reporter=json` says about a set of blob reports. */
export interface MergedReport {
  readonly expected: number
  readonly unexpected: number
  readonly flaky: number
  readonly skipped: number
  readonly titles: readonly string[]
}

interface JsonSuite {
  readonly file?: string
  readonly specs?: readonly { readonly title: string; readonly tests: readonly unknown[] }[]
  readonly suites?: readonly JsonSuite[]
}

function titlesOf(suite: JsonSuite, into: string[]): void {
  for (const spec of suite.specs ?? []) {
    for (const _test of spec.tests) {
      into.push(spec.title)
    }
  }

  for (const child of suite.suites ?? []) {
    titlesOf(child, into)
  }
}

/** Merge a directory of `report-*.zip` blobs into one report. */
export async function mergeReports(blobDir: string): Promise<MergedReport> {
  const { stdout } = await run(PLAYWRIGHT_BIN, ['merge-reports', '--reporter=json', blobDir], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '' },
  })

  const parsed = JSON.parse(stdout) as {
    readonly stats: { expected: number; unexpected: number; flaky: number; skipped: number }
    readonly suites?: readonly JsonSuite[]
  }

  const titles: string[] = []

  for (const suite of parsed.suites ?? []) {
    titlesOf(suite, titles)
  }

  return { ...parsed.stats, titles: titles.sort() }
}
