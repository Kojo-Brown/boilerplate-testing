/**
 * `pnpm mutation:check` — run the mutation test and gate on what comes back.
 *
 * The report is written for the person who has just been told their pull
 * request is red by a job they have never looked at, the same audience
 * `shape/check.ts` writes for. So it prints the whole picture — every scoped
 * module, its score, its floor, how many mutants it has left before that floor
 * binds, which suites reach it, and every mutant nothing noticed — rather than
 * one line saying a percentage went down. A survivor list *is* the actionable
 * output of a mutation run; the percentage is a summary of it.
 *
 * Stryker runs as a child process rather than through its programmatic API for
 * two reasons. Its `clear-text` reporter already prints each survivor as a
 * diff against the real source, which is better than anything reimplemented
 * here and goes straight to the CI log; and the JSON report on disk is then
 * the single thing this gate reads, so `--report-only` can re-score the last
 * run in a second while the thresholds are being argued about.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluate, type Evaluation } from './policy.ts'
import { attributeCoverage, parseReport, scoreReport, survivors } from './report.ts'
import { OVERALL_FLOOR } from './scope.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG = 'mutation/stryker.config.ts'
const REPORT = join(REPO_ROOT, 'reports/mutation/mutation.json')
const STRYKER_ENTRY = 'node_modules/@stryker-mutator/core/bin/stryker.js'

const pad = (value: string | number, width: number): string => String(value).padStart(width)
const percent = (value: number | null): string => (value === null ? '  —  ' : value.toFixed(2))

/**
 * Run Stryker.
 *
 * `process.execPath` rather than `npx`, for the reason `shape/collect.ts`
 * gives: it inherits the exact Node running this script and needs nothing on
 * `PATH`. stdio is inherited so the survivor diffs reach the log as they are
 * produced — a mutation run is minutes long and a silent one looks hung.
 */
function runStryker(): void {
  const entry = join(REPO_ROOT, STRYKER_ENTRY)

  if (!existsSync(entry)) {
    throw new Error(`${STRYKER_ENTRY} is missing. Run \`pnpm install\` first.`)
  }

  execFileSync(process.execPath, [entry, 'run', CONFIG], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}

function readReport(): unknown {
  if (!existsSync(REPORT)) {
    throw new Error(
      `Stryker wrote no report at ${REPORT}. Check the run's output above; ` +
        'a crash during the dry run produces no JSON at all.',
    )
  }

  return JSON.parse(readFileSync(REPORT, 'utf8'))
}

function render(evaluation: Evaluation, report: ReturnType<typeof parseReport>): string {
  const lines: string[] = []

  lines.push('')
  lines.push('Mutation score — scope: mutation/scope.ts')
  lines.push('')
  lines.push(
    `  module${' '.repeat(28)}score   floor   detected   headroom   uncovered  survived`,
  )

  for (const { score, entry, headroom } of evaluation.gated) {
    lines.push(
      `  ${entry.module.padEnd(32)}${pad(percent(score.score), 6)}  ${pad(`${entry.floor}%`, 5)}  ` +
        `${pad(`${score.detected}/${score.valid}`, 9)}  ${pad(headroom, 8)}   ` +
        `${pad(score.noCoverage, 9)}  ${pad(score.survived, 8)}`,
    )
  }

  const { overall } = evaluation

  lines.push('')
  lines.push(
    `  ${'all scoped modules'.padEnd(32)}${pad(percent(overall.score), 6)}  ` +
      `${pad(`${OVERALL_FLOOR}%`, 5)}  ${pad(`${overall.detected}/${overall.valid}`, 9)}  ` +
      `${pad(evaluation.overallHeadroom, 8)}   ${pad(overall.noCoverage, 9)}  ` +
      `${pad(overall.survived, 8)}`,
  )
  lines.push('')
  lines.push(
    '  headroom is how many detected mutants this module may lose before its floor binds.',
  )
  lines.push('')

  // Which suites can reach each module's mutants. Not which killed them —
  // `report.ts` explains at length why the report cannot answer that without
  // a second, much slower run.
  for (const { entry } of evaluation.gated) {
    const coverage = attributeCoverage(report, entry.module)

    if (coverage.length === 0) {
      continue
    }

    lines.push(`  ${entry.module} is reached by:`)

    for (const suite of coverage) {
      lines.push(
        `    ${pad(suite.covered, 5)} mutants  ${pad(suite.sole, 4)} of them only here   ${suite.suite}`,
      )
    }

    lines.push('')
  }

  const undetected = survivors(report)

  if (undetected.length > 0) {
    lines.push(`  ${undetected.length} mutant(s) nothing noticed:`)

    for (const mutant of undetected) {
      lines.push(
        `    ${mutant.uncovered ? 'uncovered' : 'survived '}  ` +
          `${mutant.file}:${mutant.line}  ${mutant.mutator}` +
          `${mutant.replacement === null ? '' : ` → ${mutant.replacement.split('\n')[0]}`}`,
      )
    }

    lines.push('')
    lines.push(
      '  Each one is a change to the source that every test still passed. Read them: ' +
        'some are missing assertions, and some are equivalent mutants that cannot be ' +
        'killed. mutation/README.md says how to tell the two apart.',
    )
    lines.push('')
  }

  if (evaluation.violations.length > 0) {
    lines.push(`  ${evaluation.violations.length} policy violation(s):`)

    for (const violation of evaluation.violations) {
      lines.push(`    [${violation.kind}] ${violation.detail}`)
    }

    lines.push('')
    lines.push('  See mutation/README.md for what the floors mean and how to change one.')
    lines.push('')
  }

  return lines.join('\n')
}

function main(): void {
  if (!process.argv.includes('--report-only')) {
    runStryker()
  }

  const report = parseReport(readReport())
  const evaluation = evaluate(scoreReport(report))

  process.stdout.write(render(evaluation, report))

  if (evaluation.violations.length > 0) {
    process.stdout.write(`mutation: FAILED (${evaluation.violations.length} finding(s))\n`)
    process.exitCode = 1

    return
  }

  process.stdout.write('mutation: ok\n')
}

main()
