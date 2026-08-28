/**
 * Reading a Stryker report: the schema, the arithmetic, and the one number in
 * it that does not mean what it looks like.
 *
 * Everything here is a pure function over a parsed JSON report, so the scoring
 * and the attribution are testable without running a mutation test — which
 * matters more than usual, because the run they would otherwise have to be
 * tested through takes minutes and needs four CPU cores.
 *
 * ---------------------------------------------------------------------------
 * The score, and why the gate uses the pessimistic one
 * ---------------------------------------------------------------------------
 * Stryker prints two percentages and they can differ by a lot:
 *
 *     mutation score           = detected / (detected + undetected)
 *     score based on covered   = detected / (detected + survived)
 *
 * The second one drops `NoCoverage` mutants — the ones no test executed at
 * all — from the denominator. That makes it a statement about the code the
 * suite reaches, which is a useful thing to know and a catastrophic thing to
 * gate on: deleting the only test for a function moves every one of its
 * mutants from `Survived` to `NoCoverage`, so the covered score *rises*. A
 * threshold on it rewards removing tests. `check.ts` gates on the first.
 *
 * ---------------------------------------------------------------------------
 * `killedBy` is the first killer, not the killers
 * ---------------------------------------------------------------------------
 * The obvious thing to want from a report with `testFiles` in it is "which
 * suite killed which mutants", and the obvious field to read is `killedBy`.
 * It does not answer that question. Stryker bails out of a mutant's test run
 * at the first failure, so `killedBy` holds whichever test happened to run
 * first among the ones that would have failed — an artefact of test ordering
 * and worker scheduling. Comparing two suites on it measures which one Vitest
 * happened to schedule earlier.
 *
 * `coveredBy` has no such problem: it is the complete set of tests that
 * execute the mutated code, recorded during the coverage-analysis dry run and
 * independent of what fails. {@link attributeCoverage} is built on it, and
 * reports the one attribution that is sound without re-running everything:
 * how much of a module each suite reaches, and how much of it *only* that
 * suite reaches. A mutant covered by exactly one suite can only ever be killed
 * by that suite, so deleting the suite is guaranteed to lose it.
 *
 * Complete kill sets do exist — `disableBail: true` makes Stryker run every
 * covering test for every mutant and fills `killedBy` properly — at a cost
 * measured in `README.md`. It is not what the gate runs.
 */

/** The mutant states this repository's runs can produce. */
export const MUTANT_STATUSES = [
  'Killed',
  'Survived',
  'NoCoverage',
  'Timeout',
  'CompileError',
  'RuntimeError',
  'Ignored',
  'Pending',
] as const

export type MutantStatus = (typeof MUTANT_STATUSES)[number]

/** One mutant, as the JSON report writes it. Fields the gate does not use are omitted. */
export interface Mutant {
  readonly id: string
  readonly mutatorName: string
  readonly status: MutantStatus
  readonly replacement?: string
  readonly statusReason?: string
  readonly coveredBy?: readonly string[]
  readonly killedBy?: readonly string[]
  readonly location: { readonly start: { readonly line: number; readonly column: number } }
}

export interface FileMutants {
  readonly mutants: readonly Mutant[]
}

export interface TestFileEntry {
  readonly tests: readonly { readonly id: string; readonly name: string }[]
}

/** The subset of the mutation-testing report schema the gate reads. */
export interface MutationReport {
  readonly files: Readonly<Record<string, FileMutants>>
  readonly testFiles?: Readonly<Record<string, TestFileEntry>>
}

/**
 * The tally behind one score.
 *
 * Every status is carried through rather than collapsed into the percentage,
 * because the percentage on its own cannot be acted on: 90% with ten survivors
 * is a list of ten things to read, and 90% with ten `NoCoverage` mutants is
 * one missing test file.
 */
export interface Tally {
  readonly killed: number
  readonly timeout: number
  readonly survived: number
  readonly noCoverage: number
  readonly ignored: number
  readonly compileErrors: number
  readonly runtimeErrors: number
}

export interface Score extends Tally {
  /** Killed + timed out: the mutants some test noticed. */
  readonly detected: number
  /** Detected + survived + uncovered: everything the score is computed over. */
  readonly valid: number
  /**
   * `detected / valid`, as a percentage, or `null` when there are no valid
   * mutants at all.
   *
   * `null` rather than 100: a module Stryker could not produce a single mutant
   * for has not passed anything, and returning a perfect score for it would
   * let an empty file satisfy a floor. `policy.ts` treats it as a violation.
   */
  readonly score: number | null
}

const ZERO: Tally = {
  killed: 0,
  timeout: 0,
  survived: 0,
  noCoverage: 0,
  ignored: 0,
  compileErrors: 0,
  runtimeErrors: 0,
}

const FIELD_FOR: Readonly<Record<MutantStatus, keyof Tally | null>> = {
  Killed: 'killed',
  Timeout: 'timeout',
  Survived: 'survived',
  NoCoverage: 'noCoverage',
  Ignored: 'ignored',
  CompileError: 'compileErrors',
  RuntimeError: 'runtimeErrors',
  // A pending mutant is one the run never got to. It is not a result, and a
  // report containing one is rejected by `parseReport` rather than scored
  // around — see there.
  Pending: null,
}

/** Add up mutant states, then derive the score the gate is stated over. */
export function tally(mutants: readonly Mutant[]): Score {
  const counts: Tally = mutants.reduce<Tally>((accumulated, mutant) => {
    const field = FIELD_FOR[mutant.status]

    return field === null ? accumulated : { ...accumulated, [field]: accumulated[field] + 1 }
  }, ZERO)

  const detected = counts.killed + counts.timeout
  const valid = detected + counts.survived + counts.noCoverage

  return {
    ...counts,
    detected,
    valid,
    score: valid === 0 ? null : (detected / valid) * 100,
  }
}

/** One row of the report: a file and its score. */
export interface FileScore extends Score {
  readonly file: string
}

/** Per-file scores in report order, plus the total across every file. */
export interface ScoredReport {
  readonly files: readonly FileScore[]
  readonly total: Score
}

/**
 * Score every file, and the run as a whole.
 *
 * The total is computed over the pooled mutants rather than by averaging the
 * per-file scores, because the two are different numbers and only the first is
 * the mutation score of the run: a mean over files weights a twelve-mutant
 * helper the same as a hundred-and-fifty-mutant algorithm.
 */
export function scoreReport(report: MutationReport): ScoredReport {
  const files = Object.entries(report.files).map(([file, entry]) => ({
    file,
    ...tally(entry.mutants),
  }))

  const everyMutant = Object.values(report.files).flatMap((entry) => entry.mutants)

  return { files, total: tally(everyMutant) }
}

/** One surviving mutant, flattened into the shape the report prints. */
export interface Survivor {
  readonly file: string
  readonly line: number
  readonly mutator: string
  readonly replacement: string | null
  /** True when no test executed the mutated code at all. */
  readonly uncovered: boolean
}

/**
 * Every mutant no test noticed, worst first.
 *
 * `NoCoverage` sorts before `Survived` because the two need different work: an
 * uncovered mutant means a piece of the module has no test pointed at it,
 * which is a bigger and cheaper thing to fix than a survivor, where a test
 * runs the line and does not care what it returns.
 */
export function survivors(report: MutationReport): readonly Survivor[] {
  const found: Survivor[] = []

  for (const [file, entry] of Object.entries(report.files)) {
    for (const mutant of entry.mutants) {
      if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') {
        continue
      }

      found.push({
        file,
        line: mutant.location.start.line,
        mutator: mutant.mutatorName,
        replacement: mutant.replacement ?? null,
        uncovered: mutant.status === 'NoCoverage',
      })
    }
  }

  return found.sort(
    (a, b) =>
      Number(b.uncovered) - Number(a.uncovered) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.mutator.localeCompare(b.mutator),
  )
}

/** How much of one module's mutants a single suite reaches. */
export interface SuiteCoverage {
  readonly suite: string
  /** Mutants at least one test in this suite executes. */
  readonly covered: number
  /** Mutants *only* this suite executes: deleting it loses them outright. */
  readonly sole: number
}

/**
 * Per-suite coverage of one file's mutants, widest first.
 *
 * Built from `coveredBy` and the report's `testFiles` index, so it says which
 * suites *can* kill a mutant rather than which one got there first. See the
 * header for why that distinction is the whole reason this function exists.
 *
 * A report without a `testFiles` section — Stryker omits it when coverage
 * analysis is off — yields an empty array rather than a wrong one.
 */
export function attributeCoverage(report: MutationReport, file: string): readonly SuiteCoverage[] {
  const entry = report.files[file]
  const testFiles = report.testFiles

  if (entry === undefined || testFiles === undefined) {
    return []
  }

  const suiteOf = new Map<string, string>()

  for (const [suite, testFile] of Object.entries(testFiles)) {
    for (const test of testFile.tests) {
      suiteOf.set(test.id, suite)
    }
  }

  const covered = new Map<string, number>()
  const sole = new Map<string, number>()

  for (const mutant of entry.mutants) {
    const suites = new Set<string>()

    for (const testId of mutant.coveredBy ?? []) {
      const suite = suiteOf.get(testId)

      if (suite !== undefined) {
        suites.add(suite)
      }
    }

    for (const suite of suites) {
      covered.set(suite, (covered.get(suite) ?? 0) + 1)
    }

    const only = [...suites][0]

    if (suites.size === 1 && only !== undefined) {
      sole.set(only, (sole.get(only) ?? 0) + 1)
    }
  }

  return [...covered.entries()]
    .map(([suite, count]) => ({ suite, covered: count, sole: sole.get(suite) ?? 0 }))
    .sort((a, b) => b.covered - a.covered || b.sole - a.sole || a.suite.localeCompare(b.suite))
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** A report that cannot be scored, with the reason stated in its own terms. */
export class ReportFormatError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const STATUSES = new Set<string>(MUTANT_STATUSES)

/**
 * Validate a parsed JSON report down to the fields the gate reads.
 *
 * Deliberately strict, and deliberately not a schema library. The failure this
 * guards against is not a malformed file — Stryker wrote it — but a *changed*
 * one: a future major that renames `coveredBy`, or reports a status this
 * module has no arithmetic for. Both would otherwise be scored as zeroes, and
 * a gate that reads an unrecognised report as "no mutants survived" passes
 * exactly when it has stopped working.
 *
 * `Pending` is rejected for the same reason. It marks a mutant the run never
 * reached, which happens when Stryker is interrupted; scoring the partial
 * result would report a number for a run that did not finish.
 */
export function parseReport(value: unknown): MutationReport {
  if (!isRecord(value) || !isRecord(value['files'])) {
    throw new ReportFormatError('report has no `files` object — is this a Stryker JSON report?')
  }

  const files: Record<string, FileMutants> = {}

  for (const [file, entry] of Object.entries(value['files'])) {
    if (!isRecord(entry) || !Array.isArray(entry['mutants'])) {
      throw new ReportFormatError(`report entry for ${file} has no \`mutants\` array`)
    }

    files[file] = { mutants: entry['mutants'].map((mutant) => parseMutant(mutant, file)) }
  }

  const rawTestFiles = value['testFiles']

  if (rawTestFiles === undefined) {
    return { files }
  }

  if (!isRecord(rawTestFiles)) {
    throw new ReportFormatError('report `testFiles` is present but is not an object')
  }

  const testFiles: Record<string, TestFileEntry> = {}

  for (const [suite, entry] of Object.entries(rawTestFiles)) {
    if (!isRecord(entry) || !Array.isArray(entry['tests'])) {
      throw new ReportFormatError(`report \`testFiles\` entry for ${suite} has no \`tests\` array`)
    }

    testFiles[suite] = {
      tests: entry['tests'].map((test) => {
        if (!isRecord(test) || typeof test['id'] !== 'string') {
          throw new ReportFormatError(`a test in ${suite} has no string \`id\``)
        }

        return { id: test['id'], name: typeof test['name'] === 'string' ? test['name'] : '' }
      }),
    }
  }

  return { files, testFiles }
}

function parseMutant(value: unknown, file: string): Mutant {
  if (!isRecord(value)) {
    throw new ReportFormatError(`a mutant in ${file} is not an object`)
  }

  const status = value['status']

  if (typeof status !== 'string' || !STATUSES.has(status)) {
    throw new ReportFormatError(
      `a mutant in ${file} has status ${JSON.stringify(status)}, which this gate has no ` +
        `arithmetic for. Known statuses: ${MUTANT_STATUSES.join(', ')}.`,
    )
  }

  if (status === 'Pending') {
    throw new ReportFormatError(
      `a mutant in ${file} is still Pending — the run did not finish, so its score is not a score`,
    )
  }

  const location = value['location']
  const start = isRecord(location) ? location['start'] : undefined

  if (!isRecord(start) || typeof start['line'] !== 'number' || typeof start['column'] !== 'number') {
    throw new ReportFormatError(`a mutant in ${file} has no \`location.start\``)
  }

  const strings = (key: string): readonly string[] | undefined => {
    const raw = value[key]

    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : undefined
  }

  const coveredBy = strings('coveredBy')
  const killedBy = strings('killedBy')

  return {
    id: typeof value['id'] === 'string' ? value['id'] : '',
    mutatorName: typeof value['mutatorName'] === 'string' ? value['mutatorName'] : 'unknown',
    status: status as MutantStatus,
    ...(typeof value['replacement'] === 'string' ? { replacement: value['replacement'] } : {}),
    ...(typeof value['statusReason'] === 'string' ? { statusReason: value['statusReason'] } : {}),
    ...(coveredBy === undefined ? {} : { coveredBy }),
    ...(killedBy === undefined ? {} : { killedBy }),
    location: { start: { line: start['line'], column: start['column'] } },
  }
}
