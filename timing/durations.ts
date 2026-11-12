/**
 * Per-file durations: the model, the report parser, and the statistics.
 *
 * No Node imports, so the gate, the recorder and the suites can all share it.
 *
 * ---------------------------------------------------------------------------
 * Why the unit is the file and not the test
 * ---------------------------------------------------------------------------
 * A test-time budget has to be denominated in something, and the per-*test*
 * duration is the tempting choice because it is the finest grain available.
 * It is also the one a runner measures worst: Vitest reports a test's duration
 * as the time inside its callback, which excludes the import of the module
 * under test, the `beforeAll` that built its fixture and the environment the
 * file was given — costs that belong to the file and routinely dwarf the
 * callbacks. A per-test budget therefore polices a number that can stay flat
 * while the suite doubles.
 *
 * The file is the coarsest unit that still has all of a suite's cost in it,
 * and it is the unit CI can act on: a file is what gets sharded, skipped,
 * split or quarantined. `uneven.test.ts` in the fixture exists to keep the
 * cost of that choice visible — one 60ms test and two 1ms ones are one number
 * here, and nothing in this directory can see inside it.
 */

/** One run's measured durations, keyed by repository-relative path, in ms. */
export type Run = Readonly<Record<string, number>>

/** A file's duration in one run. */
export interface FileDuration {
  readonly file: string
  readonly ms: number
}

/**
 * The shape Vitest's `json` reporter emits, narrowed to what is read here.
 *
 * `startTime`/`endTime` are epoch milliseconds and their difference is the
 * file's wall clock, which is the figure that includes transform, collect and
 * environment setup. `numTotalTests` is read only to reject an empty report.
 */
interface JsonReport {
  readonly numTotalTests?: unknown
  readonly testResults?: unknown
}

interface JsonFileResult {
  readonly name?: unknown
  readonly startTime?: unknown
  readonly endTime?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Parse a Vitest JSON report into a `Run`.
 *
 * `root` is stripped from the absolute paths the reporter writes so that a
 * corpus recorded in one checkout is comparable with a run from another.
 *
 * Throws on a report with no files in it. That is not defensive programming,
 * it is the finding that produced this function's only hard failure mode:
 * `fixture.config.ts` was written with a relative `include` and no `root`, so
 * Vitest resolved it against `process.cwd()`, collected nothing, wrote a
 * report with `testResults: []` — and **exited 0**. A timing gate reading that
 * report would have found every budget satisfied, because a suite that does
 * not run cannot be slow. An empty report is the one input a budget must never
 * accept quietly.
 */
export function parseReport(raw: string, root: string): Run {
  const parsed: unknown = JSON.parse(raw)

  if (!isRecord(parsed)) throw new Error('report is not an object')

  const report = parsed as JsonReport
  const results = report.testResults

  if (!Array.isArray(results)) throw new Error('report has no testResults array')

  if (results.length === 0) {
    throw new Error(
      'report contains no test files — the run collected nothing and still exited 0',
    )
  }

  const prefix = root.endsWith('/') ? root : `${root}/`
  const run: Record<string, number> = {}

  for (const entry of results as readonly unknown[]) {
    if (!isRecord(entry)) throw new Error('testResults entry is not an object')

    const { name, startTime, endTime } = entry as JsonFileResult

    if (typeof name !== 'string' || name === '') {
      throw new Error('testResults entry has no name')
    }

    if (typeof startTime !== 'number' || typeof endTime !== 'number') {
      throw new Error(`testResults entry has no timestamps: ${name}`)
    }

    const ms = endTime - startTime

    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`not a duration: ${name} took ${String(ms)}ms`)
    }

    run[name.startsWith(prefix) ? name.slice(prefix.length) : name] = ms
  }

  return run
}

/** A run's files, sorted, so every table and every diff has one order. */
export function files(run: Run): readonly string[] {
  return Object.keys(run).sort()
}

/** A run's total wall clock. */
export function total(run: Run): number {
  return Object.values(run).reduce((sum, ms) => sum + ms, 0)
}

/** One file's duration, or `undefined` when the run did not have that file. */
export function duration(run: Run, file: string): number | undefined {
  return Object.hasOwn(run, file) ? run[file] : undefined
}

/** `run` as sorted `FileDuration`s. */
export function entries(run: Run): readonly FileDuration[] {
  return files(run).map((file) => ({ file, ms: run[file] ?? 0 }))
}

/**
 * The median of `values`.
 *
 * The median rather than the mean throughout this directory, and for one
 * reason: a duration distribution has a floor and no ceiling. A run that lost
 * its core to something else for 200ms adds 200ms to the mean of ten runs and
 * nothing to their median, and a baseline that moves when the machine hiccups
 * is a baseline that has to be regenerated to stop CI complaining — which is
 * how a timing gate becomes advisory.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of nothing')

  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 1) return sorted[mid] ?? 0

  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/** The largest value at or below the `q` quantile (0–1), nearest-rank. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error('quantile of nothing')
  if (!(q >= 0 && q <= 1)) throw new Error(`not a quantile: ${String(q)}`)

  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil(q * sorted.length)
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1)

  return sorted[index] ?? 0
}

/**
 * How far the slowest recorded value sits above the median, as a ratio.
 *
 * `1.0` means the worst run took twice the median. This is the number the
 * findings in `README.md` are about: it is the regression a percentage gate
 * would have to tolerate to stay quiet on an unchanged suite, and it is a
 * property of the file's *size*, not of its code.
 */
export function spread(values: readonly number[]): number {
  const mid = median(values)

  if (mid <= 0) throw new Error('spread of a zero median')

  return Math.max(...values) / mid - 1
}
