/**
 * `pnpm trace:check` — the CI gate for everything `README.md` claims.
 *
 * Two measurements, each spawning Playwright, because neither can run inside
 * `pnpm test`:
 *
 *   1. The evidence table. Runs `evidence.spec.ts`, which fails all eight of its
 *      tests on purpose, then opens the eight trace zips it left behind and
 *      checks every cell of {@link EVIDENCE} against what is actually in them.
 *   2. The retention table. Runs `attempts/attempts.spec.ts` once per `trace`
 *      mode with `retries: 1` and asks the filesystem which attempts kept a
 *      trace, against `RETENTION`.
 *
 * ---------------------------------------------------------------------------
 * Why this is a script and not a test
 * ---------------------------------------------------------------------------
 * The same reason `snapshot/check.ts` and `shape/check.ts` are scripts: the
 * measurement needs a runner, and the runner it needs has to fail. A suite whose
 * eight tests must all be red cannot be a project of a config CI treats as a
 * gate, and wrapping `playwright test` in a Vitest `it` would put a browser, a
 * web server and ninety seconds inside `pnpm test`.
 *
 * The half that *is* cheap and deterministic stays in `pnpm test`: the zip
 * reader, the parser's classification, the catalogue's consistency, the
 * renderers, and every finding — all of which are functions over the tables and
 * need neither a browser nor a port. That split is the one `shape/` makes.
 *
 * ---------------------------------------------------------------------------
 * What counts as a failure of the gate
 * ---------------------------------------------------------------------------
 *   - A test in `evidence.spec.ts` that passed. Its fault stopped reproducing,
 *     so its row of the table is describing nothing.
 *   - A declared `empty` channel that holds entries, or any other verdict on a
 *     channel that holds none. This is the measured half of the evidence table.
 *   - A probe that no longer holds. The verdicts are arguments, and the probes
 *     are the specific facts each argument rests on: that `hanging-api`'s
 *     request has no status, that `covered-button`'s error never names the
 *     overlay. Without them a cell could read `cause` for a channel that
 *     happens to be non-empty for an unrelated reason.
 *   - A retention cell that disagrees with the filesystem.
 *   - A finding in either module that no longer holds over its own table. Cheap,
 *     already covered by `pnpm test`, and repeated here so that a `trace:check`
 *     run is a complete verdict on the directory rather than half of one.
 *
 * The report is written for somebody who has just been told their pull request
 * is red and has never heard of this gate: it prints both tables as measured
 * before it prints what disagrees with them.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHANNEL_NAMES, readTrace, type ChannelName, type Trace } from './channels.ts'
import {
  FINDINGS as EVIDENCE_FINDINGS,
  renderCaseTable,
  renderEvidenceTable,
  verdict,
} from './evidence.ts'
import { CASE_NAMES, type CaseName } from './faults.ts'
import {
  FINDINGS as RETENTION_FINDINGS,
  OUTCOMES,
  RETENTION_MODES,
  kept,
  renderRetentionTable,
  type Kept,
  type Outcome,
  type RetentionMode,
} from './retention.ts'
import { BROKEN_PATH, SLOW_PATH, SUMMARY_PATH } from './subject.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

/** Playwright's own entry point, resolved rather than assumed to be on `PATH`. */
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve('@playwright/test/cli')

const EVIDENCE_RESULTS = join(REPO_ROOT, 'playwright-results/trace')
const RETENTION_RESULTS = join(REPO_ROOT, 'playwright-results/trace-retention')

/** Collected rather than thrown, so one run reports every disagreement. */
const failures: string[] = []

function fail(message: string): void {
  failures.push(message)
}

/**
 * Runs Playwright and hands back whether it exited zero.
 *
 * Non-zero is the expected outcome for both suites, so the exit code is a value
 * rather than an exception. `stdio: 'inherit'` because a reader whose gate is red
 * wants Playwright's own output, and hiding it to print a tidier summary is how
 * a gate becomes something people work around.
 */
function runPlaywright(config: string, env: Readonly<Record<string, string>> = {}): boolean {
  try {
    execFileSync(process.execPath, [PLAYWRIGHT_CLI, 'test', '--config', config], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })

    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 1. The evidence table
// ---------------------------------------------------------------------------

/**
 * One case's trace, found by the directory Playwright named after its title.
 *
 * Matched by substring rather than by reconstructing Playwright's sanitiser,
 * with a uniqueness check, so that a naming change costs a clear error here
 * instead of silently reading one case's trace as another's.
 */
function traceFor(name: CaseName): Trace | null {
  if (!existsSync(EVIDENCE_RESULTS)) {
    fail(`No results directory at ${EVIDENCE_RESULTS}: did the evidence suite run?`)

    return null
  }

  const matches = readdirSync(EVIDENCE_RESULTS).filter(
    (entry) => entry.includes(`-${name}-`) && existsSync(join(EVIDENCE_RESULTS, entry, 'trace.zip')),
  )

  if (matches.length !== 1) {
    fail(`Expected exactly one trace directory for \`${name}\`; found ${String(matches.length)}`)

    return null
  }

  const only = matches[0]

  if (only === undefined) {
    return null
  }

  return readTrace(readFileSync(join(EVIDENCE_RESULTS, only, 'trace.zip')))
}

/**
 * The specific facts each row's verdicts rest on.
 *
 * A verdict of `cause` says a channel names the defect, and nothing about an
 * entry count can check that. These can: each one is the sentence a reader would
 * have to find in that channel for the cell above it to be honest.
 */
const PROBES: Readonly<Record<CaseName, (trace: Trace) => readonly string[]>> = {
  'renamed-element': (trace) => [
    ...expect(
      trace.error?.includes('element(s) not found') === true,
      'the error should say the locator matched nothing and no more than that',
    ),
    ...expect(
      trace.error?.includes('id="sum"') !== true,
      'the error should NOT name the id the page actually rendered — that is why `snapshot` is the cause',
    ),
  ],
  'duplicate-label': (trace) => [
    ...expect(
      trace.error?.includes('strict mode violation') === true &&
        trace.error?.includes('resolved to 2 elements') === true,
      'the error should enumerate both matches — that is why `error` is the cause here and nowhere else',
    ),
  ],
  'covered-button': (trace) => [
    ...expect(
      trace.error?.startsWith('TimeoutError: locator.click: Timeout') === true,
      'the message should open with a bare timeout — the half a CI log shows',
    ),
    ...expect(
      trace.error?.includes('<div id="veil"></div> intercepts pointer events') === true,
      'the call log should name the intercepting element further down the same message',
    ),
  ],
  'late-content': (trace) => [
    ...expect(
      trace.requests.some((request) => request.url.endsWith(SUMMARY_PATH) && request.status === 200),
      'the summary should have arrived with a 200 — the delay is in the page, not the network',
    ),
  ],
  'failing-api': (trace) => [
    ...expect(
      trace.requests.some((request) => request.url.endsWith(BROKEN_PATH) && request.status === 500),
      'the network channel should hold the 500',
    ),
    ...expect(
      trace.console.some(
        (message) => message.type === 'error' && message.url.endsWith(BROKEN_PATH),
      ),
      "Chromium's own subresource-failure message should name the failing URL",
    ),
  ],
  'hanging-api': (trace) => [
    ...expect(
      trace.requests.some((request) => request.url.endsWith(SLOW_PATH) && request.status === -1),
      'the hanging request should be recorded with no status (-1)',
    ),
  ],
  'throwing-script': (trace) => [
    ...expect(
      trace.pageErrors.some((message) => message.includes("reading 'format'")),
      'the page-error channel should hold the TypeError',
    ),
    ...expect(
      !trace.requests.some((request) => request.url.includes('/api/')),
      'no API request should have been made: the script died first, and that absence is the network channel’s contribution',
    ),
  ],
  'missing-env': (trace) => [
    ...expect(
      trace.error?.includes('is not set') === true,
      'the error should name the missing variable — the one case the terminal had already answered',
    ),
    ...expect(
      trace.requests.length === 0 && trace.sources.length === 0,
      'nothing should have reached the browser: no requests, and no embedded source',
    ),
  ],
}

function expect(condition: boolean, description: string): readonly string[] {
  return condition ? [] : [description]
}

function checkEvidence(): void {
  rmSync(EVIDENCE_RESULTS, { recursive: true, force: true })

  const passed = runPlaywright(join(HERE, 'playwright-trace.config.ts'))

  if (passed) {
    fail(
      'The evidence suite exited 0. Every test in `evidence.spec.ts` is supposed to fail; ' +
        'one of the faults has stopped reproducing and its row of the table now describes nothing.',
    )
  }

  const measured = new Map<CaseName, Trace>()

  for (const name of CASE_NAMES) {
    const trace = traceFor(name)

    if (trace === null) {
      continue
    }

    measured.set(name, trace)

    // The measured half of the table: `empty` is a fact, and every other verdict
    // is a claim about entries that have to exist.
    for (const channel of CHANNEL_NAMES) {
      const declared = verdict(name, channel)
      const count = trace.census[channel]

      if (declared === 'empty' && count !== 0) {
        fail(
          `${name} / ${channel}: declared \`empty\` but the trace holds ${String(count)} ` +
            'entries. Either the fixture changed or Playwright now records this channel.',
        )
      }

      if (declared !== 'empty' && count === 0) {
        fail(
          `${name} / ${channel}: declared \`${declared}\` but the channel is empty. ` +
            'A verdict cannot rest on a channel with nothing in it.',
        )
      }
    }

    for (const problem of PROBES[name](trace)) {
      fail(`${name}: ${problem}`)
    }
  }

  const missing = CASE_NAMES.filter((name) => !measured.has(name))

  if (missing.length > 0) {
    fail(`No trace measured for: ${missing.join(', ')}`)
  }

  report('Faults', renderCaseTable())
  report('Evidence, as published', renderEvidenceTable())
  report('Channel census, as measured', renderCensus(measured))
}

function renderCensus(measured: ReadonlyMap<CaseName, Trace>): string {
  const rows = CASE_NAMES.map((name) => {
    const trace = measured.get(name)

    return [
      `\`${name}\``,
      ...CHANNEL_NAMES.map((channel: ChannelName) =>
        trace === undefined ? '?' : String(trace.census[channel]),
      ),
    ]
  })

  const header = ['fault', ...CHANNEL_NAMES]
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`

  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 2. The retention table
// ---------------------------------------------------------------------------

/** Which attempts of one outcome left a trace, read off the filesystem. */
function keptOnDisk(mode: RetentionMode, outcome: Outcome): Kept {
  const directory = join(RETENTION_RESULTS, mode)

  if (!existsSync(directory)) {
    return 'none'
  }

  const forOutcome = readdirSync(directory).filter(
    (entry) =>
      entry.includes(`-${outcome}-`) && existsSync(join(directory, entry, 'trace.zip')),
  )

  // Playwright suffixes the retry's output directory with `-retry1`; the first
  // attempt's carries no suffix.
  const hasRetry = forOutcome.some((entry) => entry.endsWith('-retry1'))
  const hasFirst = forOutcome.some((entry) => !entry.endsWith('-retry1'))

  if (hasFirst && hasRetry) {
    return 'both'
  }

  if (hasRetry) {
    return 'retry'
  }

  return hasFirst ? 'first' : 'none'
}

function checkRetention(): void {
  rmSync(RETENTION_RESULTS, { recursive: true, force: true })

  const config = join(HERE, 'attempts/playwright-attempts.config.ts')
  const measured = new Map<RetentionMode, Readonly<Record<Outcome, Kept>>>()

  for (const mode of RETENTION_MODES) {
    // `off` is the one mode whose run is expected to be red for the same reason
    // as every other mode's — the `failing` test — so the exit code carries no
    // information here and is not read.
    runPlaywright(config, { TRACE_RETENTION_MODE: mode })

    const row = Object.fromEntries(
      OUTCOMES.map((outcome) => [outcome, keptOnDisk(mode, outcome)]),
    ) as Record<Outcome, Kept>

    measured.set(mode, row)

    for (const outcome of OUTCOMES) {
      const declared = kept(mode, outcome)

      if (row[outcome] !== declared) {
        fail(
          `retention ${mode} / ${outcome}: README says \`${declared}\`, ` +
            `the filesystem says \`${row[outcome]}\`.`,
        )
      }
    }
  }

  report('Retention, as published', renderRetentionTable())
  report('Retention, as measured', renderMeasuredRetention(measured))
}

function renderMeasuredRetention(
  measured: ReadonlyMap<RetentionMode, Readonly<Record<Outcome, Kept>>>,
): string {
  const rows = RETENTION_MODES.map((mode) => {
    const row = measured.get(mode)

    return [
      `\`${mode}\``,
      ...OUTCOMES.map((outcome) => (row === undefined ? '?' : row[outcome])),
    ]
  })

  const header = ['`trace`', ...OUTCOMES]
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`

  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 3. The findings, and the report
// ---------------------------------------------------------------------------

function checkFindings(): void {
  for (const finding of [...EVIDENCE_FINDINGS, ...RETENTION_FINDINGS]) {
    if (!finding.holds()) {
      fail(`Finding no longer holds over its own table: ${finding.heading}`)
    }
  }
}

function report(title: string, body: string): void {
  process.stdout.write(`\n${title}\n${'='.repeat(title.length)}\n\n${body}\n`)
}

const override = process.env['TRACE_CHROMIUM_EXECUTABLE']

if (override !== undefined) {
  process.stdout.write(
    `\nNOTE: measuring against ${override} rather than Playwright's pinned Chromium ` +
      '(TRACE_CHROMIUM_EXECUTABLE is set).\n',
  )
}

checkEvidence()
checkRetention()
checkFindings()

if (failures.length > 0) {
  process.stderr.write(`\n${String(failures.length)} disagreement(s) with README.md:\n\n`)

  for (const message of failures) {
    process.stderr.write(`  - ${message}\n`)
  }

  process.stderr.write(
    '\nEvery table in trace/README.md is measured, not transcribed. Fix the fixture, or ' +
      'change the table and the finding that rests on it — not this gate.\n',
  )
  process.exit(1)
}

process.stdout.write('\nEvery cell of both tables agrees with a real trace.\n')
