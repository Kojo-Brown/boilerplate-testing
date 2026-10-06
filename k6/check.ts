/**
 * `pnpm k6:check` — runs the real k6 binary and checks that it still behaves
 * the way this directory says it does.
 *
 * A load-test template is unusually easy to ship broken. Nothing in `pnpm test`
 * starts a load test, so a stage duration with a typo, a threshold on a metric
 * the scenario never produces, or a sub-metric selector whose tag nobody sets
 * are all invisible to every other gate in this repository — and the last of
 * those does not even fail when it is finally run, because k6 scores an empty
 * sub-metric as zero and zero passes a latency threshold. This gate is where
 * those fail.
 *
 * Three runs, each answering a different question:
 *
 *   1. agreement, default trend stats — do the twenty-odd cases in
 *      `agreement.ts` produce the outcomes they claim, and does recomputing
 *      each verdict from the export agree with k6's own?
 *   2. agreement, widened trend stats — does the one case that is unverifiable
 *      in run 1 become verifiable when `--summary-trend-stats` carries p(99)?
 *   3. the published smoke profile, through `load-test.ts` — does a profile
 *      this repository publishes actually run, and pass?
 *
 * Runs 1 and 2 must exit 99: they contain deliberate breaches, and a gate that
 * has only been seen to pass has not been seen to work. Run 3 must exit 0.
 *
 * Needs the k6 binary. `K6_BIN` overrides the lookup; see README.md for the
 * pinned version and the install line CI uses.
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ABSENT_PHASE,
  AGREEMENT_CASES,
  type AgreementCase,
} from './agreement.ts'
import { smokeProfile } from './config.ts'
import { startOrigin } from './server.ts'
import { k6Passed } from './thresholds.ts'
import {
  parseSummary,
  renderReport,
  reportThresholds,
  verdict,
  type SummaryExport,
} from './verdict.ts'

/** Percentiles the published profiles set thresholds on, for run 2. */
const WIDE_TREND_STATS = 'avg,min,med,max,p(90),p(95),p(99)'

const K6_BIN = process.env['K6_BIN'] ?? 'k6'

/** k6's exit code when at least one threshold breached. */
const EXIT_THRESHOLD_BREACH = 99

const here = (file: string): string => fileURLToPath(new URL(file, import.meta.url))

interface Failure {
  readonly what: string
  readonly detail: string
}

const failures: Failure[] = []

function fail(what: string, detail: string): void {
  failures.push({ what, detail })
}

function check(condition: boolean, what: string, detail: string): void {
  if (!condition) fail(what, detail)
}

interface Run {
  readonly status: number
  readonly summary: SummaryExport
  readonly stderr: string
}

/**
 * Runs one k6 script and reads back its summary export.
 *
 * Asynchronous, and that is not a style choice: the fixture origin runs in
 * *this* process, so a blocking `spawnSync` would hold the event loop for the
 * whole k6 run and every request would time out. The first version of this
 * file did exactly that, and the symptom was not an obvious deadlock — k6
 * reported `request timeout` and `No script iterations fully finished`, and
 * eighteen agreement cases failed as though the semantics had changed.
 */
async function runK6(
  workdir: string,
  label: string,
  script: string,
  extraArgs: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<Run> {
  const summaryPath = join(workdir, `${label}.json`)

  const child = spawn(
    K6_BIN,
    ['run', '--quiet', '--no-usage-report', `--summary-export=${summaryPath}`, ...extraArgs, here(script)],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  // Drained rather than ignored: an unread pipe fills and stalls the child.
  child.stdout.resume()

  // A soak profile is four hours; nothing this gate runs is more than two
  // minutes, so a run still going at five has hung rather than been slow.
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5 * 60 * 1000)

  const status = await new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      const hint =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? `\n\nNo k6 binary at ${JSON.stringify(K6_BIN)}. See k6/README.md for the install line.`
          : ''

      reject(new Error(`Could not run k6: ${error.message}${hint}`))
    })

    child.once('close', (code, signal) => {
      if (code === null) {
        reject(new Error(`k6 run ${label} was killed by ${signal ?? 'an unknown signal'}`))
        return
      }
      resolve(code)
    })
  }).finally(() => {
    clearTimeout(timeout)
  })

  let raw: string

  try {
    raw = readFileSync(summaryPath, 'utf8')
  } catch {
    throw new Error(
      `k6 run ${label} wrote no summary export (exit ${status}).\nstderr:\n${stderr}`,
    )
  }

  return { status, summary: parseSummary(raw), stderr }
}

/** The threshold map the agreement cases add up to, for scoring the report. */
function declaredFrom(cases: readonly AgreementCase[]): Record<string, string[]> {
  const declared: Record<string, string[]> = {}

  for (const testCase of cases) {
    const expressions = (declared[testCase.metric] ??= [])
    if (!expressions.includes(testCase.expression)) expressions.push(testCase.expression)
  }

  return declared
}

/**
 * Checks every agreement case against one run.
 *
 * Two separate assertions per case, because they can fail independently and
 * mean different things: k6's own verdict must be the one the case predicts
 * (this repository understands the semantics), and recomputing the verdict from
 * the export must reach the same answer (this repository implements them).
 */
function checkAgreement(run: Run, label: string, expectVerifiable: boolean): void {
  for (const testCase of AGREEMENT_CASES) {
    const metric = run.summary.metrics[testCase.metric] ?? {}
    const actual = k6Passed(metric, testCase.expression)
    const predicted = testCase.expect === 'pass'
    const name = `${testCase.metric}: ${testCase.expression}`

    if (actual === undefined) {
      fail(
        `${label}: ${name} was not scored`,
        'k6 produced no verdict for this threshold. The metric is missing from the ' +
          'export, which means the scenario never created it.',
      )
      continue
    }

    check(
      actual === predicted,
      `${label}: ${name}`,
      `expected k6 to ${testCase.expect}, k6 ${actual ? 'passed' : 'breached'} it. ` +
        `Case rationale: ${testCase.why}`,
    )
  }

  const reports = reportThresholds(run.summary, declaredFrom([...AGREEMENT_CASES]))

  for (const report of reports) {
    const name = `${report.metric}: ${report.parsed.expression}`

    check(
      report.agreement !== 'disagree',
      `${label}: recomputed verdict disagrees with k6 on ${name}`,
      `k6 says ${report.k6 ? 'pass' : 'breach'}; recomputing from the export says ` +
        `${report.recomputed.verifiable && report.recomputed.passed ? 'pass' : 'breach'}. ` +
        'One of thresholds.ts and k6 has changed.',
    )
  }

  // Run 1 should have exactly one unverifiable case — the p(99) one — and run 2
  // none. Asserting the count both ways is what keeps `export-blindness` a
  // measurement: if k6 starts exporting p(99) by default, run 1 stops having an
  // unverifiable case and this fails, which is the correct outcome for a
  // finding that has stopped being true.
  const unverifiable = reports.filter((report) => report.agreement === 'unverifiable')
  const blind = AGREEMENT_CASES.filter((testCase) => !testCase.inDefaultExport)

  if (expectVerifiable) {
    check(
      unverifiable.length === 0,
      `${label}: every threshold should be verifiable under --summary-trend-stats=${WIDE_TREND_STATS}`,
      `${unverifiable.length} were not: ${unverifiable.map((r) => r.parsed.expression).join(', ')}`,
    )
  } else {
    check(
      unverifiable.length === blind.length,
      `${label}: expected exactly ${blind.length} unverifiable threshold(s) under default trend stats`,
      `got ${unverifiable.length}: ${unverifiable.map((r) => r.parsed.expression).join(', ') || 'none'}. ` +
        'If k6 widened its default --summary-trend-stats, the export-blindness ' +
        'case in agreement.ts is no longer a finding and should be retired.',
    )
  }

  console.log(`\n--- ${label} ---`)
  console.log(renderReport(reports))
}

/**
 * The vacuous pass, asserted directly against the run.
 *
 * `checkAgreement` already covers it case by case; this states the finding as
 * one proposition, because it is the reason `spikeProfile` has a witness and a
 * reader should not have to assemble it from two rows of a table.
 */
function checkVacuousPass(run: Run): void {
  const latency = run.summary.metrics[`http_req_duration{phase:${ABSENT_PHASE}}`] ?? {}
  const witness = run.summary.metrics[`http_reqs{phase:${ABSENT_PHASE}}`] ?? {}

  check(
    k6Passed(latency, 'p(95)<60000') === true,
    'the vacuous pass is still real',
    'A latency threshold on a sub-metric whose tag never occurs no longer passes. ' +
      'Good news, but it means the witness thresholds in config.ts are guarding ' +
      'nothing and the README says something untrue.',
  )

  check(
    k6Passed(witness, 'count>0') === false,
    'the witness still catches an empty sub-metric',
    '`count>0` passed on a sub-metric that collected nothing, so the guard on ' +
      'spikeProfile\'s recovery thresholds does not work.',
  )
}

async function main(baseUrl: string): Promise<void> {
  const workdir = mkdtempSync(join(tmpdir(), 'k6-check-'))

  try {
    console.log(`k6 binary: ${K6_BIN}`)

    const version = spawnSync(K6_BIN, ['version'], { encoding: 'utf8' })
    if (version.stdout) console.log(version.stdout.trim())

    // Run 1 and 2: the agreement scenario, twice, differing only in which
    // trend statistics the export carries.
    const defaults = await runK6(workdir, 'agreement-default', './agreement.scenario.ts', [], {
      BASE_URL: baseUrl,
    })

    check(
      defaults.status === EXIT_THRESHOLD_BREACH,
      'agreement run exits 99',
      `expected ${EXIT_THRESHOLD_BREACH} (thresholds breached), got ${defaults.status}. ` +
        'The run contains deliberate breaches; an exit of 0 means they stopped breaching.',
    )

    checkAgreement(defaults, 'default trend stats', false)
    checkVacuousPass(defaults)

    const wide = await runK6(
      workdir,
      'agreement-wide',
      './agreement.scenario.ts',
      [`--summary-trend-stats=${WIDE_TREND_STATS}`],
      { BASE_URL: baseUrl },
    )

    check(
      wide.status === EXIT_THRESHOLD_BREACH,
      'widened agreement run exits 99',
      `expected ${EXIT_THRESHOLD_BREACH}, got ${wide.status}`,
    )

    checkAgreement(wide, 'widened trend stats', true)

    // Run 3: a profile this repository publishes, run for real, expected green.
    const smoke = await runK6(workdir, 'smoke', './load-test.ts', [], {
      BASE_URL: baseUrl,
      K6_PROFILE: 'smoke',
      // The template's think-time is there to model users; here it only makes
      // the gate slower, and the profile's own thresholds are what is under
      // test rather than the request rate.
      SLEEP_MIN: '0.05',
      SLEEP_MAX: '0.15',
    })

    check(
      smoke.status === 0,
      'the published smoke profile passes against the fixture origin',
      `k6 exited ${smoke.status}. stderr:\n${smoke.stderr}`,
    )

    const smokeReports = reportThresholds(smoke.summary, smokeProfile.thresholds)
    const smokeVerdict = verdict(smokeReports)

    console.log('\n--- published smoke profile ---')
    console.log(renderReport(smokeReports))

    check(
      smokeVerdict.passed,
      'the recomputed smoke verdict passes',
      `breached: ${smokeVerdict.breached.map((r) => r.parsed.expression).join(', ') || 'none'}; ` +
        `not scored: ${smokeVerdict.absent.map((r) => r.parsed.expression).join(', ') || 'none'}`,
    )
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

// Port 0: the OS picks a free one, so the gate cannot collide with whatever
// else a developer has on 8799 — or with a previous run that did not shut down.
const origin = await startOrigin(0)

console.log(`fixture origin: ${origin.baseUrl}`)

try {
  await main(origin.baseUrl)
} finally {
  await origin.close()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n`)
  for (const failure of failures) {
    console.error(`  ✗ ${failure.what}`)
    console.error(`    ${failure.detail}\n`)
  }
  process.exit(1)
}

console.log(`\nAll ${AGREEMENT_CASES.length} agreement cases hold, and the smoke profile is green.`)
