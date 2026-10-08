#!/usr/bin/env node
/**
 * `pnpm lighthouse:check` — runs real Lighthouse and checks that budgets are
 * still enforced the way this directory says they are.
 *
 * ---------------------------------------------------------------------------
 * What this gate is for
 * ---------------------------------------------------------------------------
 * Every claim in `wiring.ts` is a claim about how two third-party packages
 * behave together, and both halves move: Lighthouse removed W3C budgets in a
 * major, and LHCI's handling of the removed audits is a special case in a file
 * nobody has to touch to change its effect. Neither change would fail any other
 * gate in this repository. `pnpm test` covers the budget model, the join and
 * the comment as computation — but it cannot tell whether `lhci` *agrees*, and
 * the specific way it disagrees is to report green.
 *
 * So the measurement is re-derived here rather than quoted, and the gate is
 * built so that it fails if the dangerous wiring ever starts working *or* stops
 * being dangerous: both are news.
 *
 * ---------------------------------------------------------------------------
 * Collect once, assert many
 * ---------------------------------------------------------------------------
 * The wirings are compared against **one** set of reports, not one run each.
 * Run-to-run variance on a shared runner is tens of percent on LCP and TBT, so
 * separate collections would leave every difference between two wirings
 * ambiguous between the wiring and the noise. Asserting repeatedly over the
 * same reports removes the variable: if two wirings disagree, it is the wiring.
 *
 * It also makes the gate affordable — two collections, then five asserts that
 * are pure computation over files already on disk.
 *
 * The five asserts are the four wirings in {@link WIRING_CASES} plus
 * `timing-budget`, which is not a wiring anyone should use: it is here because
 * the contrast with `performance-budget` is the finding. One is swallowed and
 * the other is not, and only one of them has a special case in LHCI.
 *
 * The two collections:
 *
 *   1. `/heavy`, with `settings.budgets` set, which is the first wiring's whole
 *      claim. Every budget line is breached by {@link OVERSHOOT}x where a
 *      payload can breach it.
 *   2. `/lean`, through the published `lighthouserc.cjs` exactly as a consumer
 *      would run it. This is the half that proves a red gate is red for the
 *      stated reason: the same config that fails everything on `/heavy` must
 *      pass everything on `/lean`.
 *
 * Both collect a single run, where the published config collects three. One run
 * is not a measurement of a page, but it is a complete answer to "did this
 * wiring gate", which is all that is asked of it here — and three would triple
 * the gate's wall clock to sharpen a number nothing reads.
 *
 * Needs a Chrome; see `chrome.ts` for how it is found.
 */

import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { budgetAssertions, TIMING_METRICS } from './budgets.ts'
import { renderComment } from './comment.ts'
import { resolveChromeWithPlaywright } from './chrome.ts'
import { OVERSHOOT } from './fixture.ts'
import { BUDGETS_PATH, loadBudgets } from './load.ts'
import {
  buildBudgetReport,
  parseAssertionResults,
  resultAssertionId,
  type AssertionResult,
} from './report.ts'
import { startOrigin } from './server.ts'
import { DEAD_BUDGET_ASSERTION, DEAD_TIMING_ASSERTION, WIRING_CASES } from './wiring.ts'

/** `lighthouserc.cjs` is CommonJS and has to be loaded as such. */
const require = createRequire(import.meta.url)

/**
 * LHCI's JavaScript entry point, not `node_modules/.bin/lhci`.
 *
 * The `.bin` entry is a shell wrapper, so handing it to `process.execPath`
 * makes Node try to parse `basedir=$(dirname ...)` as JavaScript. Resolving the
 * package's own `bin` target instead keeps the spawn a plain Node process —
 * which is what lets `NODE_OPTIONS=--throw-deprecation` reach it — and avoids
 * hardcoding a path with pnpm's store layout and the version in it.
 */
const LHCI_BIN = require.resolve('@lhci/cli/src/cli.js')

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

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

/**
 * Run `lhci` in `workdir` and return its exit code and output.
 *
 * Asynchronous, and that is not a style choice: the fixture origin runs in
 * *this* process, so a blocking `spawnSync` holds the event loop for the whole
 * Lighthouse run and every request to the origin times out. The first version
 * of this file did exactly that, and the symptom was not a deadlock — it was
 * Lighthouse waiting out `maxWaitForLoad` on a blank page, once per run, and
 * reporting measurements of nothing. `k6/check.ts` carries the same note for
 * the same reason.
 */
async function lhci(
  workdir: string,
  args: readonly string[],
  chromePath: string | null,
): Promise<{ status: number; output: string }> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  if (chromePath !== null) env['CHROME_PATH'] = chromePath
  // LHCI treats a CI environment as a reason to look for a git remote and a
  // build context. Neither exists in a temp directory, and the warnings it
  // prints about them are noise in this gate's log.
  delete env['GITHUB_ACTIONS']
  delete env['CI']

  const child = spawn(process.execPath, [LHCI_BIN, ...args], {
    cwd: workdir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    output += chunk
  })

  // Nothing here collects more than three Lighthouse runs. One still going at
  // five minutes has hung rather than been slow.
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5 * 60 * 1000)

  const status = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? -1))
  }).finally(() => {
    clearTimeout(timeout)
  })

  return { status, output }
}

/** Read the assertion results LHCI wrote for the last `assert` in `workdir`. */
function readResults(workdir: string): AssertionResult[] {
  const path = join(workdir, '.lighthouseci', 'assertion-results.json')
  if (!existsSync(path)) return []
  return parseAssertionResults(readFileSync(path, 'utf8'), path)
}

/** One audit, to the depth this gate reads. */
interface AuditResult {
  readonly scoreDisplayMode?: string
  readonly numericValue?: number
}

/** The LHRs collected into `workdir`, parsed. */
function readLhrs(workdir: string): {
  audits: Record<string, AuditResult | undefined>
  configSettings: Record<string, unknown>
}[] {
  const dir = join(workdir, '.lighthouseci')
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((name) => name.startsWith('lhr-') && name.endsWith('.json'))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
          audits: Record<string, AuditResult | undefined>
          configSettings: Record<string, unknown>
        },
    )
}

function writeRc(workdir: string, name: string, body: string): string {
  const path = join(workdir, name)
  writeFileSync(path, body, 'utf8')
  return path
}

/** Serialise an assertions object into a `.cjs` config. */
function rcWithAssertions(assertions: unknown, extra = ''): string {
  return `module.exports = { ci: { assert: { includePassedAssertions: true, assertions: ${JSON.stringify(
    assertions,
    null,
    2,
  )}${extra} } } };\n`
}

async function main(): Promise<void> {
  const budgets = loadBudgets()
  const chrome = await resolveChromeWithPlaywright()

  log('')
  log('Lighthouse budget wiring check')
  log(`  lhci        ${LHCI_BIN}`)
  log(`  chrome      ${chrome.path ?? '(chrome-launcher default search)'} [${chrome.source}]`)
  log(`  budgets     ${BUDGETS_PATH}`)
  log('')

  const workdir = mkdtempSync(join(tmpdir(), 'lh-budget-check-'))
  const origin = await startOrigin(0, budgets)

  try {
    cpSync(BUDGETS_PATH, join(workdir, 'budgets.json'))

    // -----------------------------------------------------------------------
    // Collection 1 — /heavy, with the budgets in collect.settings
    // -----------------------------------------------------------------------
    const heavyUrl = `${origin.baseUrl}/heavy`
    writeRc(
      workdir,
      'collect.cjs',
      `const budgets = require('./budgets.json');
module.exports = { ci: { collect: {
  numberOfRuns: 1,
  url: ['${heavyUrl}'],
  settings: { budgets, chromeFlags: '--no-sandbox --disable-dev-shm-usage --headless=new' },
} } };
`,
    )

    log(`Collecting ${heavyUrl} with ci.collect.settings.budgets set …`)
    const collected = await lhci(workdir, ['collect', '--config=./collect.cjs'], chrome.path)
    check(
      collected.status === 0,
      'collect /heavy',
      `lhci collect exited ${collected.status}\n${collected.output}`,
    )

    const lhrs = readLhrs(workdir)
    check(lhrs.length > 0, 'collect /heavy', 'lhci collect wrote no LHR')

    // Wiring 1's claim, read straight off the report: Lighthouse 12 neither
    // ran a budget audit nor kept the setting it was handed.
    for (const lhr of lhrs) {
      check(
        !(DEAD_BUDGET_ASSERTION in lhr.audits),
        'budget audits are gone',
        `the LHR contains a "${DEAD_BUDGET_ASSERTION}" audit. Lighthouse has restored W3C budget support — wiring.ts and the README are now wrong, and ci.collect.settings.budgets may be live again.`,
      )
      check(
        !(DEAD_TIMING_ASSERTION in lhr.audits),
        'budget audits are gone',
        `the LHR contains a "${DEAD_TIMING_ASSERTION}" audit; see above.`,
      )
      check(
        !('budgets' in lhr.configSettings),
        'the budgets setting is dropped',
        'the LHR echoes a `budgets` config setting, so Lighthouse is no longer ignoring it.',
      )

      // Every metric this repository will let into a budget has to come back
      // with a number. `TIMING_METRICS` excludes `first-meaningful-paint`
      // precisely because it does not, and that is invisible in the audit list
      // — Lighthouse still ships the audit and still lists it in the default
      // config. The only place the difference shows up is a real report.
      for (const metric of TIMING_METRICS) {
        const audit = lhr.audits[metric]
        check(
          audit !== undefined && audit.scoreDisplayMode === 'numeric' && typeof audit.numericValue === 'number',
          'every budgetable metric is measured',
          `the "${metric}" audit came back ${JSON.stringify({ mode: audit?.scoreDisplayMode, numericValue: audit?.numericValue })}. A budget on it would assert against null and fail with no diagnosis; drop it from TIMING_METRICS.`,
        )
      }

      const excluded = lhr.audits['first-meaningful-paint']
      check(
        excluded === undefined || excluded.scoreDisplayMode === 'notApplicable',
        'first-meaningful-paint is still not measurable',
        `first-meaningful-paint came back ${JSON.stringify(excluded?.scoreDisplayMode)} rather than notApplicable. Lighthouse may have restored it, in which case it can join TIMING_METRICS and the note in budgets.ts is stale.`,
      )
    }

    // -----------------------------------------------------------------------
    // The wirings, each asserted over the same LHRs
    // -----------------------------------------------------------------------
    const derived = budgetAssertions(budgets)
    const expectedIds = Object.keys(derived)

    // 1. Budgets live only in collect.settings; the assert block does not
    //    mention them. This is what a config looks like when its author
    //    believes budgets.json is doing the work.
    writeRc(workdir, 'assert-settings-only.cjs', rcWithAssertions({ 'categories:seo': ['warn', { minScore: 0 }] }))

    // 2. The canonical LHCI budget assertion.
    writeRc(workdir, 'assert-performance-budget.cjs', rcWithAssertions({ [DEAD_BUDGET_ASSERTION]: ['error', {}] }))

    // 3. Its sibling, which fails loudly instead. Not a wiring anyone should
    //    use — it is here because the contrast is the finding.
    writeRc(workdir, 'assert-timing-budget.cjs', rcWithAssertions({ [DEAD_TIMING_ASSERTION]: ['error', {}] }))

    // 4. budgetsFile, LHCI's own conversion.
    writeRc(
      workdir,
      'assert-budgets-file.cjs',
      `module.exports = { ci: { assert: { budgetsFile: './budgets.json' } } };\n`,
    )

    // 5. What this repository publishes.
    writeRc(workdir, 'assert-derived.cjs', rcWithAssertions(derived))

    interface WiringOutcome {
      readonly id: string
      readonly status: number
      readonly rows: AssertionResult[]
      readonly breaches: AssertionResult[]
    }

    const run = async (id: string, config: string): Promise<WiringOutcome> => {
      const result = await lhci(workdir, ['assert', `--config=./${config}`], chrome.path)
      const rows = readResults(workdir)
      return { id, status: result.status, rows, breaches: rows.filter((row) => !row.passed) }
    }

    log('Asserting the same LHRs under each wiring …')
    const settingsOnly = await run('collect-settings', 'assert-settings-only.cjs')
    const performanceBudget = await run('performance-budget-assertion', 'assert-performance-budget.cjs')
    const timingBudget = await run('timing-budget-assertion', 'assert-timing-budget.cjs')
    const budgetsFile = await run('budgets-file', 'assert-budgets-file.cjs')
    const derivedRun = await run('derived-assertions', 'assert-derived.cjs')

    // The two that must not gate. If either of these starts failing, budgets
    // became enforceable the easy way and this directory should say so.
    check(
      settingsOnly.status === 0 && settingsOnly.breaches.length === 0,
      'ci.collect.settings.budgets does not gate',
      `expected exit 0 with no breaches; got exit ${settingsOnly.status} with ${settingsOnly.breaches.length}. If Lighthouse has restored budget support, wiring.ts, the README and lighthouserc.cjs all need revisiting.`,
    )
    check(
      performanceBudget.status === 0 && performanceBudget.rows.length === 0,
      `the ${DEAD_BUDGET_ASSERTION} assertion does not gate`,
      `expected exit 0 and zero assertion results; got exit ${performanceBudget.status} with ${performanceBudget.rows.length} rows. LHCI's special case for this id may have changed.`,
    )

    // The asymmetry: the sibling audit fails loudly, and it is the only reason
    // the one above is dangerous rather than merely broken.
    check(
      timingBudget.status !== 0 && timingBudget.breaches.some((row) => row.name === 'auditRan'),
      `the ${DEAD_TIMING_ASSERTION} assertion fails loudly`,
      `expected a non-zero exit with an auditRan failure; got exit ${timingBudget.status} with ${JSON.stringify(timingBudget.breaches.map((row) => row.name))}. If this has become silent too, the contrast in wiring.ts is wrong.`,
    )

    // The two that must gate, on a page that breaches everything it can.
    for (const outcome of [budgetsFile, derivedRun]) {
      check(
        outcome.status !== 0 && outcome.breaches.length > 0,
        `${outcome.id} gates`,
        `expected a non-zero exit with at least one breach on a page ${OVERSHOOT}x over budget; got exit ${outcome.status} with ${outcome.breaches.length}`,
      )
    }

    // Both working wirings must reach the same verdict on the same LHRs: the
    // whole justification for deriving assertions here rather than using
    // budgetsFile is that it is the *same conversion*.
    const idsOf = (outcome: WiringOutcome): string[] =>
      [...new Set(outcome.breaches.map(resultAssertionId))].sort()

    check(
      JSON.stringify(idsOf(budgetsFile)) === JSON.stringify(idsOf(derivedRun)),
      'the derived assertions match budgetsFile',
      `budgetsFile breached ${JSON.stringify(idsOf(budgetsFile))}\nderived     breached ${JSON.stringify(idsOf(derivedRun))}\nbudgets.ts has drifted from LHCI's own converter.`,
    )

    // Every row the derived wiring produced must belong to a budget line, and
    // every budget line must have produced a row. The second half is what
    // report.ts's 'not-measured' status exists for, and this is where it is
    // established to be empty in practice rather than assumed.
    const producedIds = new Set(derivedRun.rows.map(resultAssertionId))
    for (const id of expectedIds) {
      check(
        producedIds.has(id),
        'every budget line is measured',
        `budgets.json declares ${id}, and asserting it produced no result row. report.ts will score it "not-measured".`,
      )
    }

    const report = buildBudgetReport(budgets, derivedRun.rows)
    check(
      report.breached > 0,
      'the heavy fixture breaches budgets',
      'the report found no breach on the heavy page, so the fixture is no longer over budget',
    )
    check(
      report.notMeasured === 0,
      'the heavy report measured every line',
      `${report.notMeasured} budget line(s) produced no row`,
    )

    log('')
    log('  wiring                                          exit  rows  breaches  gates')
    for (const [outcome, expected] of [
      [settingsOnly, false],
      [performanceBudget, false],
      [budgetsFile, true],
      [derivedRun, true],
    ] as const) {
      const declared = WIRING_CASES.find((wiring) => wiring.id === outcome.id)
      const gated = outcome.status !== 0
      log(
        `  ${(declared?.label ?? outcome.id).padEnd(46)}${String(outcome.status).padStart(4)}${String(outcome.rows.length).padStart(6)}${String(outcome.breaches.length).padStart(10)}  ${gated ? 'yes' : 'no'}`,
      )
      check(
        declared !== undefined,
        'wiring is declared',
        `${outcome.id} is not in WIRING_CASES`,
      )
      check(
        declared === undefined || declared.gates === expected,
        'WIRING_CASES agrees with the run',
        `${outcome.id}: WIRING_CASES says gates=${String(declared?.gates)}, measured gates=${String(gated)}`,
      )
    }
    log('')

    // -----------------------------------------------------------------------
    // Collection 2 — /lean, through the published config
    // -----------------------------------------------------------------------
    // The published config's own `startServerCommand` is replaced by this
    // process's origin: starting a second server from inside a temp directory
    // would need the repository on its path, and the point here is the assert
    // block rather than the plumbing.
    const leanWorkdir = mkdtempSync(join(tmpdir(), 'lh-budget-lean-'))
    mkdirSync(join(leanWorkdir, '.lighthouseci'), { recursive: true })

    const published = JSON.parse(
      JSON.stringify((require('./lighthouserc.cjs') as { ci: unknown }).ci),
    ) as {
      collect: Record<string, unknown>
      assert: Record<string, unknown>
    }

    writeRc(
      leanWorkdir,
      'published.cjs',
      `module.exports = { ci: ${JSON.stringify(
        {
          collect: {
            ...published.collect,
            numberOfRuns: 1,
            url: [`${origin.baseUrl}/lean`],
            startServerCommand: undefined,
            startServerReadyPattern: undefined,
            startServerReadyTimeout: undefined,
          },
          assert: published.assert,
        },
        null,
        2,
      )} };\n`,
    )

    log(`Running the published config against ${origin.baseUrl}/lean …`)
    const lean = await lhci(leanWorkdir, ['collect', '--config=./published.cjs'], chrome.path)
    check(lean.status === 0, 'collect /lean', `lhci collect exited ${lean.status}\n${lean.output}`)

    const leanAssert = await lhci(leanWorkdir, ['assert', '--config=./published.cjs'], chrome.path)
    const leanRows = readResults(leanWorkdir)
    const leanReport = buildBudgetReport(budgets, leanRows)

    check(
      leanAssert.status === 0,
      'the published config passes on /lean',
      `lhci assert exited ${leanAssert.status}. A config that cannot pass the fixture it ships is not a config anyone can start from.\n${leanAssert.output}`,
    )
    check(
      leanReport.ok,
      'the lean report is clean',
      `breached=${leanReport.breached} notMeasured=${leanReport.notMeasured} other=${leanReport.otherFailures.length}`,
    )
    check(
      leanReport.passed === expectedIds.length,
      'every budget line is reported on /lean',
      `expected ${expectedIds.length} passing rows, got ${leanReport.passed}. includePassedAssertions may have stopped working, which silently empties the PR comment.`,
    )

    rmSync(leanWorkdir, { recursive: true, force: true })

    // -----------------------------------------------------------------------
    // The comment, rendered from the real reports
    // -----------------------------------------------------------------------
    const heavyBody = renderComment(report, {
      sha: 'fixture',
      runs: 1,
      urls: [heavyUrl],
    })
    const leanBody = renderComment(leanReport, {
      sha: 'fixture',
      runs: 1,
      urls: [`${origin.baseUrl}/lean`],
    })

    check(
      heavyBody.includes('over limit'),
      'the comment reports the breaches',
      `rendered body does not mention a breach:\n${heavyBody}`,
    )
    check(
      leanBody.includes('Every budget met'),
      'the comment reports a clean run',
      `rendered body does not report success:\n${leanBody}`,
    )
    check(
      leanBody.includes('under'),
      'the clean comment reports headroom',
      'a green comment with no headroom column is the one thing the check already says',
    )

    log('The comment, as the heavy page renders it:')
    log('')
    log(heavyBody.replace(/^/gm, '  '))
    log('')
  } finally {
    await origin.close()
    rmSync(workdir, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} check(s) failed:\n\n`)
    for (const failure of failures) {
      process.stderr.write(`  ✗ ${failure.what}\n    ${failure.detail.replace(/\n/g, '\n    ')}\n\n`)
    }
    process.exitCode = 1
    return
  }

  log(`lighthouse: ok — ${WIRING_CASES.length} wirings, ${Object.keys(budgetAssertions(loadBudgets())).length} budget lines`)
}

await main()
