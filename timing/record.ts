#!/usr/bin/env node
/**
 * Record the noise corpus — Node CLI, run by hand, not by CI.
 *
 * Spawns the fixture suite `--runs` times through the Vitest CLI, parses each
 * JSON report, and writes `corpus.json`: the same five files, unchanged,
 * measured over and over. Nothing in the subject varies between runs, so every
 * difference in the recorded numbers is the machine — which is precisely the
 * quantity the gate designs in `gates.ts` are scored against.
 *
 * Usage:
 *   node timing/record.ts              # rewrites timing/corpus.json
 *   node timing/record.ts --runs 20
 *
 * Why the corpus is committed rather than recorded in CI
 * ------------------------------------------------------
 * `runs.test.ts` re-derives every cell of the published matrix on every
 * `pnpm test` and fails if one moved. It can only do that because the scoring
 * is pure and the corpus is a file: a suite that re-measured the machine each
 * time would be a suite whose expected values are whatever it just observed,
 * which is the one thing a regression gate must not be. The measurement of
 * real noise happens once, here, and is then held still.
 *
 * Re-record it when the fixture changes. Do not re-record it to make a finding
 * in `README.md` go away — `readme.test.ts` reports the disagreement, and the
 * disagreement is the interesting part.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { arch, availableParallelism, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { files, parseReport, type Run } from './durations.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)

/** How many times the unchanged suite is measured when `--runs` is absent. */
const DEFAULT_RUNS = 16

function parseRunCount(argv: readonly string[]): number {
  const index = argv.indexOf('--runs')

  if (index < 0) return DEFAULT_RUNS

  const value = Number(argv[index + 1])

  if (!Number.isInteger(value) || value < 2) {
    throw new Error('--runs needs an integer of at least 2')
  }

  return value
}

/**
 * Run the fixture once and return its per-file durations.
 *
 * The fixture config's `root` is `timing/`, so that is the prefix the
 * reporter's absolute paths carry and the prefix `parseReport` strips: the
 * recorded keys come out as `fixture/large.test.ts`.
 */
function measureOnce(scratch: string, index: number): Run {
  const outputFile = join(scratch, `run-${String(index)}.json`)

  execFileSync(
    'npx',
    ['vitest', 'run', '--config', join(here, 'fixture.config.ts'), '--outputFile', outputFile],
    { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  )

  try {
    return parseReport(readFileSync(outputFile, 'utf8'), here)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`run ${String(index)} produced an unusable report: ${message}`, {
      cause: error,
    })
  }
}

function run(): void {
  const runCount = parseRunCount(process.argv.slice(2))
  const scratch = mkdtempSync(join(tmpdir(), 'timing-corpus-'))

  try {
    const measured: Run[] = []

    for (let index = 0; index < runCount; index += 1) {
      process.stderr.write(`measuring run ${String(index + 1)}/${String(runCount)}…\n`)
      measured.push(measureOnce(scratch, index))
    }

    const first = measured[0]

    if (first === undefined) throw new Error('no runs recorded')

    const order = files(first)

    for (const [index, one] of measured.entries()) {
      if (files(one).join('\n') !== order.join('\n')) {
        throw new Error(`run ${String(index)} measured a different set of files than run 0`)
      }
    }

    const corpus = {
      recorded: {
        node: process.version,
        platform: platform(),
        arch: arch(),
        parallelism: availableParallelism(),
        runs: runCount,
      },
      files: order,
      // Rounded to one decimal: the reporter's epoch-millisecond subtraction
      // carries sixteen digits of float noise that mean nothing, and a corpus
      // is a document people read.
      runs: measured.map((one) => order.map((file) => Math.round((one[file] ?? 0) * 10) / 10)),
    }

    writeFileSync(join(here, 'corpus.json'), `${JSON.stringify(corpus, null, 2)}\n`, 'utf8')

    process.stderr.write(
      `wrote corpus.json: ${String(runCount)} runs × ${String(order.length)} files\n`,
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

run()
