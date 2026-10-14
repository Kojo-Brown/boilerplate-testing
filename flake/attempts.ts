/**
 * One attempt record, and the two parsers that produce them.
 *
 * ---------------------------------------------------------------------------
 * Why a format of our own
 * ---------------------------------------------------------------------------
 * Flake detection is arithmetic over attempts: a test that failed twice in
 * forty attempts is flaky, a test that failed forty times out of forty is
 * broken, and the two need opposite treatment. Neither runner ships an
 * artifact that is a list of attempts — `wirings.ts` measures what each one
 * does ship — so everything downstream of here (the analytics in `history.ts`,
 * the registry decisions in `quarantine.ts`, the dashboard in `dashboard.ts`)
 * is written against this shape, and the runners' reports are translated into
 * it at the edge.
 *
 * The shape is deliberately smaller than either report. It holds what a
 * decision about quarantining a test needs and nothing else: who the test is,
 * which attempt this was, whether it passed, and the message if it did not.
 */

/** The runners this repository collects attempts from. */
export type Runner = 'vitest' | 'playwright'

/** What one attempt at one test did. */
export interface Attempt {
  /** Opaque identifier for the run this attempt belongs to. */
  readonly run: string
  readonly runner: Runner
  /** Test file, relative to the repository root, with forward slashes. */
  readonly module: string
  /**
   * The test's full name — `describe > it`, joined with ' > '.
   *
   * This is the join key, and it is a title rather than an id because a title
   * is the only identifier both runners put in an artifact: `vitest list
   * --json` emits `{name, file}` and nothing else, and Playwright's own id is a
   * hash of the title, so the two agree on what they key on even though only
   * one of them admits it. What that costs is the subject of the `id-stable`
   * probe in `probes.ts` and the reason `quarantine.ts` holds a renames table.
   */
  readonly name: string
  /** 1-based within the run: attempt 1 is the first try, 2 the first retry. */
  readonly attempt: number
  readonly outcome: 'passed' | 'failed'
  /** First line of the error, when this attempt failed. */
  readonly error?: string
}

const normalise = (file: string, root: string): string =>
  file.startsWith(root) ? file.slice(root.length).replace(/^\/+/, '').replaceAll('\\', '/') : file.replaceAll('\\', '/')

const firstLine = (message: string): string => (message.split('\n')[0] ?? '').trim()

/**
 * Attempts from Vitest's own JSON reporter.
 *
 * The one thing this parser cannot do is count attempts, and that is the
 * finding rather than a limitation of the parser: the report has no attempt
 * count anywhere in it. What it has, for a test that passed on a retry, is a
 * `status: "passed"` entry carrying the failed attempt's message in
 * `failureMessages` — so a flake is *visible*, but only as an inconsistency,
 * and the number of attempts has to be inferred as `failureMessages.length + 1`.
 *
 * That inference is unsound and `wirings.ts` measures the case that breaks it:
 * `expect.soft` files two errors from a single attempt, and a test that fails
 * twice over in one go is indistinguishable here from one that failed twice in
 * two attempts. The reporter in `reporter.ts` exists because of this paragraph.
 */
export function attemptsFromVitestJson(payload: unknown, run: string, root: string): readonly Attempt[] {
  const report = payload as {
    testResults?: readonly {
      name?: unknown
      assertionResults?: readonly { fullName?: unknown; status?: unknown; failureMessages?: unknown }[]
    }[]
  }

  const attempts: Attempt[] = []

  for (const file of report.testResults ?? []) {
    const module = typeof file.name === 'string' ? normalise(file.name, root) : '<unknown>'

    for (const assertion of file.assertionResults ?? []) {
      if (typeof assertion.fullName !== 'string') continue
      if (assertion.status !== 'passed' && assertion.status !== 'failed') continue

      const messages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages.filter((message): message is string => typeof message === 'string')
        : []

      const base = { run, runner: 'vitest' as const, module, name: assertion.fullName }

      // Every message is read as one failed attempt, and the final state as the
      // last one. This is the inference the paragraph above calls unsound; it is
      // implemented faithfully so that `wirings.ts` can show where it breaks
      // rather than describing it.
      messages.forEach((message, index) => {
        attempts.push({ ...base, attempt: index + 1, outcome: 'failed', error: firstLine(message) })
      })

      if (assertion.status === 'passed') {
        attempts.push({ ...base, attempt: messages.length + 1, outcome: 'passed' })
      }
    }
  }

  return attempts
}

/**
 * Attempts from Playwright's JSON reporter.
 *
 * Nothing is inferred here. Playwright keeps a `results` array per test with
 * one entry per attempt, each carrying its own `retry` index, status and
 * errors, and this parser is a rename.
 */
export function attemptsFromPlaywrightJson(payload: unknown, run: string): readonly Attempt[] {
  interface Spec {
    readonly title?: unknown
    readonly file?: unknown
    readonly tests?: readonly {
      readonly results?: readonly { readonly retry?: unknown; readonly status?: unknown; readonly errors?: unknown }[]
    }[]
  }
  interface Suite {
    readonly title?: unknown
    readonly file?: unknown
    readonly specs?: readonly Spec[]
    readonly suites?: readonly Suite[]
  }

  const attempts: Attempt[] = []

  const walk = (suite: Suite, titles: readonly string[]): void => {
    for (const spec of suite.specs ?? []) {
      const title = typeof spec.title === 'string' ? spec.title : '<unknown>'
      const module = typeof spec.file === 'string' ? spec.file : typeof suite.file === 'string' ? suite.file : '<unknown>'
      const name = [...titles, title].join(' > ')

      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          const retry = typeof result.retry === 'number' ? result.retry : 0
          const passed = result.status === 'passed'
          const errors = Array.isArray(result.errors) ? result.errors : []
          const message = errors
            .map((error) => (error as { message?: unknown }).message)
            .find((candidate): candidate is string => typeof candidate === 'string')

          attempts.push({
            run,
            runner: 'playwright',
            module: module.replaceAll('\\', '/'),
            name,
            attempt: retry + 1,
            outcome: passed ? 'passed' : 'failed',
            ...(passed || message === undefined ? {} : { error: firstLine(message) }),
          })
        }
      }
    }

    for (const child of suite.suites ?? []) {
      walk(child, [...titles, typeof child.title === 'string' ? child.title : '<unknown>'])
    }
  }

  // The outermost suites are the files, and their titles are paths that are
  // already in `module`, so the walk starts with an empty title path. A
  // `describe` is a nested suite and does go into the name, which is what makes
  // a Playwright name comparable with a Vitest `fullName`.
  for (const suite of (payload as { suites?: readonly Suite[] }).suites ?? []) {
    walk(suite, [])
  }

  return attempts
}

/** Attempts from the reporter in `reporter.ts`, which writes this shape directly. */
export function attemptsFromJsonl(source: string): readonly Attempt[] {
  return source
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Attempt)
}
