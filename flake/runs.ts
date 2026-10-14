/**
 * Running a wiring for real.
 *
 * Every row of the matrix is a process this file starts: the subject under
 * `vitest run` or `playwright test`, with the wiring's retry count and
 * reporter on the command line, a plan and a fresh ledger directory in its
 * environment, and all of its artifacts written into a scratch directory that
 * is deleted afterwards.
 *
 * Asynchronous throughout. `execFileSync` would be shorter, but the two
 * rerun wirings run a second process over the *same* ledger and the ordering
 * matters, so the sequencing is explicit rather than incidental.
 *
 * Nothing here is spawned through `pnpm` or `npx`: the CLIs are addressed as
 * files under `node_modules` and run with `process.execPath`, so the subject
 * runs under the exact Node running the measurement — which matters on a
 * version matrix — and depends on nothing being on `PATH`.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { readLedger, type AttemptRecord } from './fixture/ledger.ts'
import { answer, type Answers } from './probes.ts'
import { mergeReadings, read, type Reading } from './read.ts'
import { PLAN, SUBJECT, WIRINGS, type Wiring } from './wirings.ts'

import type { FlakeCase } from './fixture/plan.ts'
import type { Identity, TagForm } from './identity.ts'
import type { QuarantineEntry } from './quarantine.ts'

const run = promisify(execFile)

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const VITEST_CLI = join(REPO_ROOT, 'node_modules/vitest/vitest.mjs')
const PLAYWRIGHT_CLI = join(REPO_ROOT, 'node_modules/@playwright/test/cli.js')
const VITEST_CONFIG = join(REPO_ROOT, 'flake/fixture/subject.config.ts')
const PLAYWRIGHT_CONFIG = join(REPO_ROOT, 'flake/fixture/subject.playwright.config.ts')
const REPORTER = join(REPO_ROOT, 'flake/reporter.ts')

/** What one process did. */
interface Execution {
  readonly exitCode: number
  readonly stdout: string
  /** The artifact file this process was asked to write, when it wrote one. */
  readonly artifact: string | undefined
}

/** A wiring's measured row: the answers, and the evidence they came from. */
export interface WiringRun {
  readonly wiring: Wiring
  readonly answers: Answers
  readonly ledger: readonly AttemptRecord[]
  readonly exitCodes: readonly number[]
}

export function missingTooling(): string | undefined {
  if (!existsSync(VITEST_CLI)) return 'node_modules/vitest is missing. Run `pnpm install` first.'
  if (!existsSync(PLAYWRIGHT_CLI)) return 'node_modules/@playwright/test is missing. Run `pnpm install` first.'

  return undefined
}

async function execute(args: readonly string[], environment: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await run(process.execPath, [...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...environment },
      maxBuffer: 16 * 1024 * 1024,
    })

    return { code: 0, stdout }
  } catch (error) {
    // A non-zero exit is the expected outcome of most of these runs, not a
    // failure of the measurement: `execFile` rejects on it and the code and
    // the output are both on the error.
    const failure = error as { code?: unknown; stdout?: string; stderr?: string }
    const code = typeof failure.code === 'number' ? failure.code : 1

    return { code, stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

/** One Vitest process. `pass` distinguishes the two runs of a rerun wiring. */
async function runVitest(wiring: Wiring, scratch: string, pass: number): Promise<Execution> {
  const json = join(scratch, `report-${String(pass)}.json`)
  const junit = join(scratch, `report-${String(pass)}.xml`)
  const attempts = join(scratch, `attempts-${String(pass)}.jsonl`)

  const reporters: readonly string[] =
    wiring.artifact === 'vitest-json'
      ? ['--reporter=json', `--outputFile.json=${json}`]
      : wiring.artifact === 'vitest-junit'
        ? ['--reporter=junit', `--outputFile.junit=${junit}`]
        : wiring.artifact === 'vitest-attempts'
          ? [`--reporter=${REPORTER}`]
          : // The two stdout wirings differ only here, and the difference is
            // the finding: `verbose` is the reporter the shipped quarantine
            // config picked in order to see retries.
            [`--reporter=${wiring.id === 'vitest-verbose-retry' ? 'verbose' : 'default'}`]

  const { code, stdout } = await execute(
    [VITEST_CLI, 'run', '--config', VITEST_CONFIG, `--retry=${String(wiring.retries)}`, ...reporters],
    {
      FLAKE_PLAN: join(scratch, 'plan.json'),
      FLAKE_LEDGER: join(scratch, 'ledger'),
      FLAKE_ATTEMPTS: attempts,
      FLAKE_RUN: `${wiring.id}-${String(pass)}`,
      // Vitest colours its output when it believes it is on a terminal, and a
      // parse of `(retry x1)` should not depend on that belief.
      NO_COLOR: '1',
      CI: '1',
      // Cleared rather than left alone: the child inherits this process's
      // environment, and `pnpm test:quarantine` sets `QUARANTINE=1` for the
      // whole suite — including the tests that spawn these runs. A measurement
      // whose subject is a quarantine must not be handed the flag by the suite
      // it happens to be running in.
      QUARANTINE: '',
    },
  )

  const artifact =
    wiring.artifact === 'vitest-json'
      ? json
      : wiring.artifact === 'vitest-junit'
        ? junit
        : wiring.artifact === 'vitest-attempts'
          ? attempts
          : undefined

  return { exitCode: code, stdout, artifact }
}

/** One Playwright process. */
async function runPlaywright(wiring: Wiring, scratch: string, pass: number): Promise<Execution> {
  const json = join(scratch, `pw-report-${String(pass)}.json`)
  const junit = join(scratch, `pw-report-${String(pass)}.xml`)
  const reporter = wiring.artifact === 'playwright-junit' ? 'junit' : 'json'
  const lastFailed = wiring.rerun === 'failures-only' && pass === 2 ? ['--last-failed'] : []

  const { code, stdout } = await execute(
    [
      PLAYWRIGHT_CLI,
      'test',
      '--config',
      PLAYWRIGHT_CONFIG,
      `--retries=${String(wiring.retries)}`,
      `--reporter=${reporter}`,
      // Playwright writes `test-results/` next to the config by default, which
      // would be inside the repository.
      `--output=${join(scratch, 'results')}`,
      ...lastFailed,
    ],
    {
      FLAKE_PLAN: join(scratch, 'plan.json'),
      FLAKE_LEDGER: join(scratch, 'ledger'),
      PLAYWRIGHT_JSON_OUTPUT_NAME: json,
      PLAYWRIGHT_JUNIT_OUTPUT_NAME: junit,
      NO_COLOR: '1',
      CI: '1',
    },
  )

  return { exitCode: code, stdout, artifact: reporter === 'junit' ? junit : json }
}

/**
 * Run one wiring and answer the seven probes about it.
 *
 * The scratch directory holds the plan, the ledger and every artifact, and is
 * removed on the way out: the measurement leaves nothing behind in the
 * repository, which is what lets `runs.test.ts` run it on every `pnpm test`.
 */
export async function measure(wiring: Wiring, cases: readonly FlakeCase[] = PLAN.cases): Promise<WiringRun> {
  const scratch = mkdtempSync(join(tmpdir(), `flake-${wiring.id}-`))

  try {
    mkdirSync(join(scratch, 'ledger'), { recursive: true })
    writeFileSync(join(scratch, 'plan.json'), JSON.stringify({ cases }))

    const passes = wiring.rerun === undefined ? 1 : 2
    const executions: Execution[] = []

    for (let pass = 1; pass <= passes; pass += 1) {
      executions.push(
        wiring.runner === 'vitest'
          ? await runVitest(wiring, scratch, pass)
          : await runPlaywright(wiring, scratch, pass),
      )
    }

    const names = cases.map((entry) => entry.id)
    const readings: Reading[] = executions.map((execution) => {
      const source =
        execution.artifact === undefined
          ? execution.stdout
          : existsSync(execution.artifact)
            ? readFileSync(execution.artifact, 'utf8')
            : // An artifact the wiring asked for and the reporter did not write
              // is a finding in its own right rather than a crash: it is what
              // `vitest/quarantine.config.ts` does, and an empty reading says
              // "this artifact knows nothing", which is true.
              ''

      return source === '' ? { views: [], namesFlakes: false } : read(wiring.artifact, source, names)
    })

    const latest = readings.at(-1) ?? { views: [], namesFlakes: false }
    const reading = readings.length === 1 ? latest : mergeReadings(readings)
    const ledger = readLedger(join(scratch, 'ledger'))

    return {
      wiring,
      answers: answer({
        reading,
        latest,
        ledger,
        // The gate is the *last* exit code: a rerun's verdict is the rerun's.
        exitCode: executions.at(-1)?.exitCode ?? 1,
        subject: SUBJECT,
        plan: names,
      }),
      ledger,
      exitCodes: executions.map((execution) => execution.exitCode),
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * The one question the matrix cannot ask, because its plan is too clean.
 *
 * Vitest's default reporter prints `(retry x1)` next to a retried test — but
 * only inside a file it has expanded, and it expands a file only when
 * something in that file failed. A suite whose *only* problem is a flake
 * therefore prints `Tests 2 passed` and not one word about the retry, which is
 * precisely the suite somebody is looking at when they go hunting for flakes.
 *
 * So this runs both stdout wirings twice: once against the matrix's green plan
 * and once with a permanently failing case alongside the flake, and reports
 * whether the marker appeared. The failing neighbour makes the exit code
 * useless as a measurement of the flake, which is why it is not in `PLAN`.
 */
export async function measureRetryMarker(wiringId: string): Promise<{
  readonly alone: boolean
  readonly beside: boolean
}> {
  const wiring = WIRINGS.find((candidate) => candidate.id === wiringId)

  if (wiring === undefined) throw new Error(`no such wiring: ${wiringId}`)

  const neighbour: FlakeCase = { id: 'broken', failOn: [1, 2, 3, 4, 5, 6, 7, 8] }
  const alone = await measure(wiring)
  const beside = await measure(wiring, [...PLAN.cases, neighbour])

  return { alone: alone.answers.naming === 'named', beside: beside.answers.naming === 'named' }
}

/**
 * The identity measurement: what marking a test as quarantined does to the
 * keys its reports are joined on.
 *
 * Two `playwright test --list` runs per form, which is the cheapest way to ask
 * all five questions: the `--grep=@flaky` listing answers "is it selected" and,
 * when it is, carries the title, the id and the tags; the `--grep-invert=@flaky`
 * listing answers "is it excluded" and carries them when it is not. Listing
 * collects without running, so no attempt is made and no ledger is written.
 */
export async function measureIdentity(form: TagForm): Promise<Identity> {
  const scratch = mkdtempSync(join(tmpdir(), `flake-identity-${form}-`))

  try {
    const testCase: FlakeCase = {
      id: 'subject',
      failOn: [],
      ...(form === 'untagged' ? {} : { tag: '@flaky' }),
      ...(form === 'in-title' ? { tagInTitle: true } : {}),
    }

    writeFileSync(join(scratch, 'plan.json'), JSON.stringify({ cases: [testCase] }))

    const list = async (filter: string): Promise<readonly ListedSpec[]> => {
      const { stdout } = await execute(
        [
          PLAYWRIGHT_CLI,
          'test',
          '--config',
          PLAYWRIGHT_CONFIG,
          '--list',
          '--reporter=json',
          `--output=${join(scratch, 'results')}`,
          filter,
        ],
        {
          FLAKE_PLAN: join(scratch, 'plan.json'),
          FLAKE_LEDGER: join(scratch, 'ledger'),
          NO_COLOR: '1',
        },
      )

      return listedSpecs(stdout)
    }

    const selected = await list('--grep=@flaky')
    const kept = await list('--grep-invert=@flaky')
    const spec = selected[0] ?? kept[0]

    if (spec === undefined) throw new Error(`identity: neither listing collected the subject for form ${form}`)

    return {
      title: spec.title,
      id: spec.id,
      tags: spec.tags,
      selected: selected.length > 0,
      excluded: kept.length === 0,
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

interface ListedSpec {
  readonly title: string
  readonly id: string
  readonly tags: readonly string[]
}

/** The specs in a `--list --reporter=json` payload, flattened. */
function listedSpecs(stdout: string): readonly ListedSpec[] {
  interface Suite {
    readonly specs?: readonly { readonly title?: unknown; readonly id?: unknown; readonly tags?: unknown }[]
    readonly suites?: readonly Suite[]
  }

  // `--list` prints the payload to stdout, where Playwright may also have
  // printed a warning. The report starts at the first `{` and runs to the end.
  const start = stdout.indexOf('{')

  if (start < 0) return []

  const report = JSON.parse(stdout.slice(start)) as { suites?: readonly Suite[] }
  const specs: ListedSpec[] = []

  const walk = (suite: Suite): void => {
    for (const spec of suite.specs ?? []) {
      specs.push({
        title: typeof spec.title === 'string' ? spec.title : '',
        id: typeof spec.id === 'string' ? spec.id : '',
        tags: Array.isArray(spec.tags) ? spec.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      })
    }

    for (const child of suite.suites ?? []) walk(child)
  }

  for (const suite of report.suites ?? []) walk(suite)

  return specs
}

/** What one run of the registry-driven fixture reported about each case. */
export interface QuarantineRun {
  readonly results: readonly { readonly name: string; readonly status: string }[]
  readonly ledger: readonly AttemptRecord[]
  readonly exitCode: number
}

/**
 * Run the registry-driven fixture once.
 *
 * The registry is written into the scratch directory and named by
 * `FLAKE_REGISTRY`, so the helper under test loads it the same way it would
 * load a project's own `flake/quarantine.json` — nothing in `vitest/flaky.ts`
 * knows it is in a fixture.
 */
export async function measureQuarantine(options: {
  readonly entries: readonly QuarantineEntry[]
  readonly quarantineMode: boolean
  readonly cases?: readonly FlakeCase[]
}): Promise<QuarantineRun> {
  const scratch = mkdtempSync(join(tmpdir(), 'flake-quarantine-'))

  try {
    const cases = options.cases ?? [{ id: 'intermittent', failOn: [1] }]
    const report = join(scratch, 'report.json')

    writeFileSync(join(scratch, 'plan.json'), JSON.stringify({ cases }))
    writeFileSync(join(scratch, 'registry.json'), JSON.stringify({ version: 1, entries: options.entries }))

    const { code } = await execute(
      [
        VITEST_CLI,
        'run',
        '--config',
        join(REPO_ROOT, 'flake/fixture/quarantined.config.ts'),
        '--retry=2',
        '--reporter=json',
        `--outputFile.json=${report}`,
      ],
      {
        FLAKE_PLAN: join(scratch, 'plan.json'),
        FLAKE_LEDGER: join(scratch, 'ledger'),
        FLAKE_REGISTRY: join(scratch, 'registry.json'),
        // Explicitly one or the other. Leaving it alone would let
        // `pnpm test:quarantine`, which sets `QUARANTINE=1` for every test in
        // the suite, hand the flag to the run that is supposed to be measuring
        // what happens without it — and the symptom is a quarantined test
        // running in the main-suite case, which reads as the registry not
        // working.
        QUARANTINE: options.quarantineMode ? '1' : '',
        NO_COLOR: '1',
      },
    )

    const payload = existsSync(report)
      ? (JSON.parse(readFileSync(report, 'utf8')) as {
          testResults?: readonly { assertionResults?: readonly { fullName?: string; status?: string }[] }[]
        })
      : {}

    return {
      results: (payload.testResults ?? []).flatMap((file) =>
        (file.assertionResults ?? [])
          .filter((assertion): assertion is { fullName: string; status: string } =>
            typeof assertion.fullName === 'string' && typeof assertion.status === 'string',
          )
          .map((assertion) => ({ name: assertion.fullName, status: assertion.status })),
      ),
      ledger: readLedger(join(scratch, 'ledger')),
      exitCode: code,
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
