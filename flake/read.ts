/**
 * Reading an artifact back: six formats, one shape.
 *
 * Nothing in this file decides anything. Each parser answers, for every case
 * in the plan, three questions in the artifact's own terms — what status does
 * it give this test, how many attempts can be counted from it, and which error
 * messages does it carry — plus one syntactic fact about the format: does it
 * have a word for a flake at all. `probes.ts` turns those into verdicts by
 * comparing them with the subject's own ledger, which is the only way the
 * table is a measurement rather than a restatement of what was expected.
 */

import type { ArtifactKind } from './wirings.ts'

/** What one artifact says about one test. */
export interface TestView {
  readonly name: string
  readonly status: 'passed' | 'failed' | 'flaky'
  /**
   * Attempts recoverable from the artifact, by the best count the format
   * offers. `undefined` when the format carries no attempt information for
   * this test at all — which is not the same as 1.
   */
  readonly attempts: number | undefined
  readonly errors: readonly string[]
}

/** What one artifact says, in full. */
export interface Reading {
  readonly views: readonly TestView[]
  /**
   * Does the artifact name a flake — a status, a statistic or a marker that
   * says "this test needed more than one attempt"?
   *
   * A syntactic property of the format, not an inference from the numbers:
   * `attempts > 1` can sometimes be derived from an artifact that has no word
   * for the thing it is describing, and the difference is exactly what decides
   * whether an off-the-shelf dashboard shows a flake or not.
   */
  readonly namesFlakes: boolean
}

export const viewOf = (reading: Reading, name: string): TestView | undefined =>
  reading.views.find((view) => view.name === name)

/** Merge the readings of a rerun's two artifacts into one. */
export function mergeReadings(readings: readonly Reading[]): Reading {
  const byName = new Map<string, TestView>()

  for (const reading of readings) {
    for (const view of reading.views) {
      const previous = byName.get(view.name)

      if (previous === undefined) {
        byName.set(view.name, view)
        continue
      }

      // Attempts add up across runs: the question a rerun answers is how many
      // times the test was tried in total. A status is combined the way a
      // person reads two logs — one pass and one failure is a flake, and that
      // this has to be *derived* rather than read is the finding about reruns.
      const attempts =
        previous.attempts === undefined && view.attempts === undefined
          ? undefined
          : (previous.attempts ?? 0) + (view.attempts ?? 0)
      const statuses = new Set([previous.status, view.status])
      const status = statuses.has('flaky')
        ? 'flaky'
        : statuses.has('passed') && statuses.has('failed')
          ? 'flaky'
          : previous.status

      byName.set(view.name, {
        name: view.name,
        status,
        ...(attempts === undefined ? { attempts: undefined } : { attempts }),
        errors: [...previous.errors, ...view.errors],
      })
    }
  }

  return {
    views: [...byName.values()],
    namesFlakes: readings.some((reading) => reading.namesFlakes),
  }
}

// ---------------------------------------------------------------------------
// Vitest
// ---------------------------------------------------------------------------

/**
 * Vitest's JSON reporter.
 *
 * The attempt count has to be inferred, and the inference is the only one the
 * format admits: a failed attempt leaves a message in `failureMessages`, so
 * the attempts are the messages plus one if the test ended up passing. There
 * is no retry count anywhere in the file to check that against.
 */
export function readVitestJson(source: string): Reading {
  const report = JSON.parse(source) as {
    testResults?: readonly {
      assertionResults?: readonly { fullName?: string; status?: string; failureMessages?: readonly string[] }[]
    }[]
  }

  const views: TestView[] = []

  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (typeof assertion.fullName !== 'string') continue

      const errors = assertion.failureMessages ?? []
      const passed = assertion.status === 'passed'

      views.push({
        name: assertion.fullName,
        status: passed ? 'passed' : 'failed',
        attempts: errors.length + (passed ? 1 : 0),
        errors: [...errors],
      })
    }
  }

  return { views, namesFlakes: false }
}

/**
 * Vitest's JUnit reporter.
 *
 * `<failure>` elements are the only attempt-shaped thing in the file, and a
 * test that ended up passing has none — so for a passing test the format
 * carries no attempt information whatsoever, which is `undefined` here rather
 * than 1.
 */
export function readVitestJunit(source: string): Reading {
  const views: TestView[] = []

  for (const [, attributes, body] of source.matchAll(/<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    // `\bname="` rather than `name="`: a Vitest `<testcase>` carries
    // `classname="…"` first, and the looser pattern reads the file name as the
    // test name — which looks exactly like a reporter that omitted the test.
    const name = /\bname="([^"]*)"/.exec(attributes ?? '')?.[1]

    if (name === undefined) continue

    const failures = [...(body ?? '').matchAll(/<(?:failure|error)\b[^>]*message="([^"]*)"/g)].map(
      (match) => match[1] ?? '',
    )

    views.push({
      name,
      status: failures.length > 0 ? 'failed' : 'passed',
      ...(failures.length > 0 ? { attempts: failures.length } : { attempts: undefined }),
      errors: failures,
    })
  }

  return { views, namesFlakes: false }
}

/**
 * A Vitest run's console output.
 *
 * `(retry xN)` is the marker the default reporter prints next to a test that
 * needed more than one attempt. Reading it is a parse of a log line, which is
 * exactly the fragility worth documenting: it is the only machine-readable
 * trace of a Vitest flake that either built-in reporter leaves anywhere.
 */
export function readVitestStdout(source: string, names: readonly string[]): Reading {
  // Stripping ANSI colour means matching the escape character itself: there is
  // no version of this that does the job without one, and building the pattern
  // out of `String.fromCharCode(27)` would only hide what is being matched.
  // eslint-disable-next-line no-control-regex -- see the note above
  const clean = source.replaceAll(/\u001B\[[0-9;]*m/g, '')
  const views: TestView[] = []
  let marked = false

  for (const name of names) {
    // Anchored on the line that reports the test, so another test's retry
    // marker cannot be read as this one's. Both reporters end the line with
    // the duration, and the marker — when there is one — follows it.
    const line = clean
      .split('\n')
      .find((candidate) => candidate.includes(`✓ ${name} `) || candidate.includes(`> ${name} `) || candidate.includes(`× ${name} `))

    if (line === undefined) continue

    const retries = /\(retry x(\d+)\)/.exec(line)?.[1]

    if (retries !== undefined) marked = true

    views.push({
      name,
      status: line.includes('×') ? 'failed' : 'passed',
      ...(retries === undefined ? { attempts: undefined } : { attempts: Number(retries) + 1 }),
      errors: clean.includes(`flake subject ${name}: attempt 1`) ? [`flake subject ${name}: attempt 1`] : [],
    })
  }

  return { views, namesFlakes: marked }
}

/** The attempt ledger `reporter.ts` writes: one line per attempt, nothing to infer. */
export function readVitestAttempts(source: string): Reading {
  const records = source
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { name: string; attempt: number; outcome: string; error?: string })

  const byName = new Map<string, { attempts: number; failures: number; errors: string[] }>()

  for (const record of records) {
    const entry = byName.get(record.name) ?? { attempts: 0, failures: 0, errors: [] }

    entry.attempts = Math.max(entry.attempts, record.attempt)
    if (record.outcome === 'failed') entry.failures += 1
    if (record.error !== undefined) entry.errors.push(record.error)
    byName.set(record.name, entry)
  }

  return {
    views: [...byName].map(([name, entry]) => ({
      name,
      status: entry.failures === 0 ? 'passed' : entry.failures < entry.attempts ? 'flaky' : 'failed',
      attempts: entry.attempts,
      errors: entry.errors,
    })),
    namesFlakes: true,
  }
}

// ---------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------

/** Playwright's JSON reporter: a `results` array per test, one entry per attempt. */
export function readPlaywrightJson(source: string): Reading {
  interface Spec {
    readonly title?: string
    readonly tests?: readonly {
      readonly status?: string
      readonly results?: readonly { readonly status?: string; readonly errors?: readonly { message?: string }[] }[]
    }[]
  }
  interface Suite {
    readonly specs?: readonly Spec[]
    readonly suites?: readonly Suite[]
  }

  const report = JSON.parse(source) as { suites?: readonly Suite[]; stats?: { flaky?: number } }
  const views: TestView[] = []

  const walk = (suite: Suite): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? []
        const errors = results.flatMap((result) =>
          (result.errors ?? [])
            .map((error) => error.message)
            .filter((message): message is string => typeof message === 'string'),
        )

        views.push({
          name: spec.title ?? '<unknown>',
          status: test.status === 'flaky' ? 'flaky' : results.at(-1)?.status === 'passed' ? 'passed' : 'failed',
          attempts: results.length,
          errors,
        })
      }
    }

    for (const child of suite.suites ?? []) walk(child)
  }

  for (const suite of report.suites ?? []) walk(suite)

  return { views, namesFlakes: (report.stats?.flaky ?? 0) > 0 }
}

/**
 * Playwright's JUnit reporter.
 *
 * Unexpected failures are written as `<error>`, not `<failure>` — the
 * `failures` attribute of a run with a genuine failure in it reads `0` — and a
 * test that passed on a retry carries neither, only a `<system-out>` naming an
 * attachment directory. So the format is read the same way Vitest's is, and
 * finds the same nothing.
 */
export const readPlaywrightJunit = readVitestJunit

/** Dispatch on the artifact kind a wiring declares. */
export function read(kind: ArtifactKind, source: string, names: readonly string[]): Reading {
  switch (kind) {
    case 'vitest-json':
      return readVitestJson(source)
    case 'vitest-junit':
      return readVitestJunit(source)
    case 'vitest-stdout':
      return readVitestStdout(source, names)
    case 'vitest-attempts':
      return readVitestAttempts(source)
    case 'playwright-json':
      return readPlaywrightJson(source)
    case 'playwright-junit':
      return readPlaywrightJunit(source)
  }
}
