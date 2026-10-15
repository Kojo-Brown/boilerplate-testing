/**
 * Applying a fault for real, and recording what broke.
 *
 * ---------------------------------------------------------------------------
 * What a run here is
 * ---------------------------------------------------------------------------
 * Per fault: a fresh copy of `fixture/` under `.runs/<fault>/`, the fault
 * applied to a file in the copy, and `vitest run` over the copy with the JSON
 * reporter. The failing test files in that report are the ground truth — the
 * set a selection has to contain to be safe — and nothing in this directory
 * declares them. They are measured, and they can therefore disagree with what
 * `matrix.ts` claims, which is the only reason the matrix is worth reading.
 *
 * Per test file, once: the same copy, run alone, with V8 coverage. That is the
 * coverage map the `coverage` strategy selects from, and recording it from a
 * real run is the point — a map assembled by hand would be a map of the import
 * graph wearing a different name.
 *
 * ---------------------------------------------------------------------------
 * Why a copy, and why inside the repository
 * ---------------------------------------------------------------------------
 * A copy because a fault is a real edit to a real file, and editing the
 * subject in place would leave the repository broken if a run died midway.
 * Inside the repository because the copy has to resolve `vitest` from
 * `node_modules`, and Node resolves upwards: a copy in the system temp
 * directory finds nothing. `.runs/` is gitignored, excluded from the unit
 * run`s collection, from `tsc` and from `eslint`, for the same reason
 * `.stryker-tmp/` is.
 *
 * Nothing is spawned through `pnpm` or `npx`: the Vitest CLI is addressed as a
 * file and run with `process.execPath`, so the subject runs under the exact
 * Node running the measurement, which matters on a version matrix.
 */

import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { coveredFiles, type CoverageMap } from './coverage.ts'
import { diffOf, FAULTS, type Fault, type FaultId } from './faults.ts'
import { buildGraph, type Graph } from './graph.ts'

const run = promisify(execFile)

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const FIXTURE_ROOT = join(REPO_ROOT, 'impact/fixture')
const RUNS_ROOT = join(REPO_ROOT, 'impact/.runs')
const VITEST_CLI = join(REPO_ROOT, 'node_modules/vitest/vitest.mjs')

/**
 * How many fixture runs are in flight at once.
 *
 * One. The runs are independent — each has its own copy and its own output
 * directory, so four at a time measured the same cells four times faster — and
 * it is the wrong thing to optimise. `pnpm test` already runs test *files* in
 * parallel, so four subprocesses here means eight CPU-hungry processes on a
 * four-core runner, and the suites sharing that runner include measurements
 * that wait for real milliseconds (`determinism/`, `concurrency/`). Taking
 * fifteen seconds instead of eight to avoid making somebody else's timing
 * measurement flaky is an easy trade; this file has nothing to measure about
 * its own speed.
 */
const CONCURRENCY = 1

export function missingTooling(): string | undefined {
  if (!existsSync(VITEST_CLI)) return 'node_modules/vitest is missing. Run `pnpm install` first.'
  if (!existsSync(FIXTURE_ROOT)) return 'impact/fixture is missing.'

  return undefined
}

/** Every file in a directory tree, as POSIX paths relative to it, sorted. */
export function treeFiles(root: string): readonly string[] {
  const walk = (directory: string, prefix: string): string[] =>
    readdirSync(join(root, directory === '' ? '.' : directory), { withFileTypes: true }).flatMap((entry) => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`

      if (entry.isDirectory()) {
        // The copies and the Vite cache a run leaves behind are not part of the
        // subject. Without this a second measurement would find the first one.
        if (entry.name === 'node_modules' || entry.name === '.runs') return []

        return walk(relative, relative)
      }

      return [relative]
    })

  return walk('', '').sort()
}

export const isTestFile = (path: string): boolean => path.endsWith('.test.ts')

export interface FaultRun {
  readonly fault: FaultId
  /** Every file in the subject as the fault leaves it, fixture-relative. */
  readonly files: readonly string[]
  /** The suites the subject would run, fixture-relative. */
  readonly testFiles: readonly string[]
  /** The suites that actually failed. The ground truth. */
  readonly failing: readonly string[]
  readonly exitCode: number
  readonly graph: Graph
}

export interface Measurement {
  readonly runs: ReadonlyMap<FaultId, FaultRun>
  /** test file → the files its own run executed. Recorded from the clean subject. */
  readonly coverage: CoverageMap
  /** The clean subject, for the strategies that need a baseline. */
  readonly baseline: {
    readonly files: readonly string[]
    readonly testFiles: readonly string[]
    readonly graph: Graph
  }
}

interface Execution {
  readonly code: number
  readonly stdout: string
}

async function execute(args: readonly string[]): Promise<Execution> {
  try {
    const { stdout } = await run(process.execPath, [...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
      maxBuffer: 16 * 1024 * 1024,
    })

    return { code: 0, stdout }
  } catch (error) {
    // A non-zero exit is the expected outcome of every faulted run, not a
    // failure of the measurement: `execFile` rejects on it and both the code
    // and the output are on the error.
    const failure = error as { code?: unknown; stdout?: string; stderr?: string }

    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

/** A clean copy of the subject at `.runs/<name>/`, with `target` applied when given. */
export function prepareCopy(name: string, target?: Fault): string {
  const destination = join(RUNS_ROOT, name)

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(RUNS_ROOT, { recursive: true })
  cpSync(FIXTURE_ROOT, destination, { recursive: true })

  if (target === undefined) return destination

  const file = join(destination, target.change.file)

  if (target.change.kind === 'create') {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, target.change.contents)

    return destination
  }

  const before = readFileSync(file, 'utf8')
  const occurrences = before.split(target.change.find).length - 1

  if (occurrences !== 1) {
    throw new Error(
      `fault ${target.id}: its anchor appears ${String(occurrences)} times in ${target.change.file}, not once. The fixture has changed under the catalogue.`,
    )
  }

  writeFileSync(file, before.replace(target.change.find, target.change.replace))

  return destination
}

/** The JSON reporter, as far as this needs it. */
interface JsonReport {
  readonly testResults?: readonly { readonly name: string; readonly status?: string }[]
}

function failingFiles(reportPath: string, copy: string): readonly string[] {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport
  const prefix = `${copy}/`

  return (report.testResults ?? [])
    .filter((result) => result.status === 'failed')
    .map((result) => (result.name.startsWith(prefix) ? result.name.slice(prefix.length) : result.name))
    .sort()
}

async function runFault(target: Fault): Promise<FaultRun> {
  const copy = prepareCopy(target.id, target)
  const report = join(copy, 'report.json')
  const { code, stdout } = await execute([
    VITEST_CLI,
    'run',
    '--config',
    join(copy, 'vitest.config.ts'),
    '--reporter=json',
    `--outputFile.json=${report}`,
  ])

  if (!existsSync(report)) {
    throw new Error(`fault ${target.id}: vitest wrote no report (exit ${String(code)}).\n${stdout.slice(0, 2_000)}`)
  }

  const failing = failingFiles(report, copy)

  if (failing.length === 0) {
    throw new Error(
      `fault ${target.id}: every suite passed, so there is nothing for a selection to miss. The fault no longer breaks the subject.`,
    )
  }

  const files = treeFiles(copy).filter((file) => file !== 'report.json')

  return {
    fault: target.id,
    files,
    testFiles: files.filter(isTestFile),
    failing,
    exitCode: code,
    graph: buildGraph(copy, files),
  }
}

/**
 * One coverage map per test file, from the clean subject.
 *
 * Sequential, and the copies are shared: Vite writes its transform cache into
 * the root it is given, and two runs racing on one cache directory is a
 * measurement that sometimes disagrees with itself.
 */
async function recordCoverage(testFiles: readonly string[]): Promise<CoverageMap> {
  const map = new Map<string, ReadonlySet<string>>()

  for (const [index, testFile] of testFiles.entries()) {
    const copy = prepareCopy(`coverage-${String(index)}`)
    const reports = join(copy, 'coverage')
    const { code, stdout } = await execute([
      VITEST_CLI,
      'run',
      '--config',
      join(copy, 'vitest.config.ts'),
      '--coverage',
      `--coverage.reportsDirectory=${reports}`,
      testFile,
    ])
    const report = join(reports, 'coverage-final.json')

    if (code !== 0 || !existsSync(report)) {
      throw new Error(
        `coverage run for ${testFile} failed (exit ${String(code)}).\n${stdout.slice(0, 2_000)}`,
      )
    }

    map.set(testFile, coveredFiles(report, copy))
  }

  return map
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = []

  for (let start = 0; start < items.length; start += limit) {
    results.push(...(await Promise.all(items.slice(start, start + limit).map(mapper))))
  }

  return results
}

let pending: Promise<Measurement> | undefined

/**
 * Run everything, once per process.
 *
 * Memoised because two test files in the same Vitest worker would otherwise
 * each pay for fourteen subprocesses. `runs.test.ts` is the only caller, and
 * the rest of the directory is scored from what it returns.
 */
export function measure(): Promise<Measurement> {
  pending ??= (async (): Promise<Measurement> => {
    const blocker = missingTooling()

    if (blocker !== undefined) throw new Error(blocker)

    const baselineCopy = prepareCopy('baseline')
    const baselineFiles = treeFiles(baselineCopy)
    const baselineTests = baselineFiles.filter(isTestFile)
    const coverage = await recordCoverage(baselineTests)
    const runs = await mapWithConcurrency(FAULTS, CONCURRENCY, runFault)

    return {
      runs: new Map(runs.map((faultRun) => [faultRun.fault, faultRun])),
      coverage,
      baseline: {
        files: baselineFiles,
        testFiles: baselineTests,
        graph: buildGraph(baselineCopy, baselineFiles),
      },
    }
  })()

  return pending
}

/** The diff a fault produces, re-exported so a scorer needs one import. */
export { diffOf }
