/**
 * `AttemptReporter` — the forty lines that make Vitest flakes countable.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 * Vitest 3 knows perfectly well when a test flaked. `TestDiagnostic` carries
 * `retryCount` and a `flaky` boolean documented as "if test passed on a second
 * retry", and the default reporter prints `(retry x1)` next to the test. None
 * of it reaches an artifact: the JSON reporter writes `status: "passed"` with
 * no attempt count, and the JUnit reporter — the format every third-party test
 * analytics service ingests — writes a bare `<testcase>` indistinguishable
 * from a test that passed first time. `wirings.ts` measures all of that.
 *
 * So this reporter writes the one thing the others do not: one line per
 * attempt, in the shape `attempts.ts` defines, which is what `history.ts` can
 * do arithmetic over.
 *
 * ---------------------------------------------------------------------------
 * Why attempts are reconstructed rather than observed
 * ---------------------------------------------------------------------------
 * `onTestCaseResult` fires once per test, not once per attempt — a retry
 * replaces the test's result rather than adding to it. What survives is the
 * count (`retryCount`) and the accumulated errors, and the count is enough: a
 * test that ends `passed` with `retryCount: n` failed its first `n` attempts
 * and passed the last, and a test that ends `failed` with `retryCount: n`
 * failed all `n + 1`. That arithmetic is exact, which is the whole point —
 * `retryCount` is a count of retries rather than of error messages, so it
 * survives the `expect.soft` case that defeats counting a report's messages.
 *
 * The messages are a separate question and are attributed conservatively.
 * Errors accumulate in order across attempts with no boundaries recorded
 * between them, so they can be matched to attempts one-to-one only when there
 * are exactly as many errors as failed attempts. When there are more — an
 * attempt with two soft assertions in it — only the last attempt's message is
 * knowable, because the last error is the one that ended the last attempt, and
 * the earlier attempts are left without one rather than given somebody else's.
 *
 * Usage:
 *
 *   FLAKE_ATTEMPTS=.flake/attempts.jsonl \
 *     pnpm vitest run --reporter=default --reporter=./flake/reporter.ts
 *
 * Added alongside a human-readable reporter rather than instead of one: this
 * writes a file and prints nothing.
 */

import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, relative, sep } from 'node:path'

import type { Attempt } from './attempts.ts'

/** The reporter's own slice of the Vitest API, named rather than imported.
 *
 * `vitest/node`'s `Reporter` is an interface of some sixty optional hooks whose
 * `TestCase` pulls in the whole module graph of reported tasks. Declaring the
 * three members actually used keeps this file checkable on its own — and, more
 * to the point, keeps `reporter.test.ts` able to call it with a hand-built test
 * case instead of standing up a Vitest run to produce one.
 */
export interface ReportedTestCase {
  readonly name: string
  readonly module: { readonly moduleId: string }
  /**
   * The enclosing suite, if any.
   *
   * `unknown` rather than a shape: Vitest's own `TestCase.parent` is
   * `TestModule | TestSuite`, and a module has no `name` at all — so a type
   * here that named the field would stop this interface being satisfied by the
   * thing it describes. `fullNameOf` narrows it at run time instead.
   */
  readonly parent?: unknown
  result(): { readonly state: string; readonly errors?: readonly { readonly message?: string }[] | undefined }
  diagnostic(): { readonly retryCount: number; readonly flaky: boolean } | undefined
  fullName?: string
}

/** Where the reporter writes, and what it calls the run. */
export interface AttemptReporterOptions {
  /** Output path. Defaults to `FLAKE_ATTEMPTS`. */
  readonly file?: string
  /** Run identifier stamped on every attempt. Defaults to `FLAKE_RUN` or a timestamp. */
  readonly run?: string
  /** Repository root, for relativising module paths. Defaults to `process.cwd()`. */
  readonly root?: string
}

const firstLine = (message: string): string => (message.split('\n')[0] ?? '').trim()

/**
 * The full name of a test, `describe > it`.
 *
 * Vitest's `TestCase` exposes `fullName` in 3.2 but the walk up `parent` is
 * kept as the fallback: the name is this repository's join key, and a key that
 * silently became the bare title on an upgrade would quietly split every
 * test's history in two.
 */
export function fullNameOf(test: ReportedTestCase): string {
  if (typeof test.fullName === 'string' && test.fullName !== '') return test.fullName

  const titles: string[] = [test.name]

  const named = (value: unknown): { readonly name: string; readonly parent?: unknown } | undefined => {
    if (typeof value !== 'object' || value === null) return undefined

    const candidate = value as { name?: unknown; parent?: unknown }

    return typeof candidate.name === 'string' && candidate.name !== ''
      ? { name: candidate.name, parent: candidate.parent }
      : undefined
  }

  let parent = named(test.parent)

  while (parent !== undefined) {
    titles.unshift(parent.name)
    parent = named(parent.parent)
  }

  return titles.join(' > ')
}

/**
 * Expand one finished test into one attempt per try.
 *
 * Exported and pure, because this is the whole of the reporter's reasoning and
 * `reporter.test.ts` checks it against cases no real run produces — a `flaky`
 * flag that disagrees with `retryCount`, a failed test with no errors at all —
 * which is the only way to find out whether the rule holds for the reason it
 * claims to.
 */
export function expandAttempts(
  test: ReportedTestCase,
  context: { readonly run: string; readonly root: string },
): readonly Attempt[] {
  const result = test.result()

  if (result.state !== 'passed' && result.state !== 'failed') return []

  const diagnostic = test.diagnostic()
  const retries = diagnostic?.retryCount ?? 0
  const total = retries + 1
  const passed = result.state === 'passed'
  const errors = (result.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => typeof message === 'string')

  const base = {
    run: context.run,
    runner: 'vitest' as const,
    module: relative(context.root, test.module.moduleId).split(sep).join('/'),
    name: fullNameOf(test),
  }

  // One error per failed attempt is the only case in which the accumulated
  // array can be split back into attempts. See the note at the top of the file.
  const failedAttempts = passed ? retries : total
  const aligned = errors.length === failedAttempts

  return Array.from({ length: total }, (_unused, index) => {
    const attempt = index + 1
    // The last attempt of a passing test is the one that passed; every other
    // attempt of either outcome failed.
    const failed = !passed || attempt < total
    const message = !failed
      ? undefined
      : aligned
        ? errors[index]
        : attempt === total
          ? errors[errors.length - 1]
          : undefined

    return {
      ...base,
      attempt,
      outcome: failed ? ('failed' as const) : ('passed' as const),
      ...(message === undefined ? {} : { error: firstLine(message) }),
    }
  })
}

/**
 * The reporter. Default-exported because that is how `--reporter=./path.ts`
 * loads it.
 */
export default class AttemptReporter {
  private readonly file: string
  private readonly run: string
  private readonly root: string

  constructor(options: AttemptReporterOptions = {}) {
    const file = options.file ?? process.env['FLAKE_ATTEMPTS']

    if (file === undefined || file === '') {
      throw new Error('AttemptReporter: set FLAKE_ATTEMPTS to the file attempts should be written to')
    }

    this.file = file
    this.run = options.run ?? process.env['FLAKE_RUN'] ?? `vitest-${String(Date.now())}`
    this.root = options.root ?? process.cwd()
  }

  /**
   * Truncate on start rather than append, so a report is of one run.
   *
   * A reporter that appended would turn a developer's `--watch` session into a
   * history of a hundred runs of one file, which is the shape of data that
   * makes a flake rate mean nothing.
   */
  onInit(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    rmSync(this.file, { force: true })
  }

  onTestCaseResult(test: ReportedTestCase): void {
    const attempts = expandAttempts(test, { run: this.run, root: this.root })

    if (attempts.length === 0) return

    appendFileSync(this.file, `${attempts.map((attempt) => JSON.stringify(attempt)).join('\n')}\n`)
  }
}
