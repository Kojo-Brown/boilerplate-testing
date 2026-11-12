#!/usr/bin/env node
/**
 * The test-time regression gate — Node CLI, run by CI.
 *
 * Usage:
 *   node timing/check.ts --base base.json --head head.json
 *   node timing/check.ts --base b1.json --base b2.json --head head.json
 *
 * Both inputs are Vitest `json` reports. `--base` may be repeated, in which
 * case the baseline is the per-file median of those runs; `--head` is the run
 * being judged. Exits 0 when the head run is within budget and 1 when it is
 * not, printing the offending files either way and appending the table to
 * `$GITHUB_STEP_SUMMARY` when CI provides one.
 *
 * ---------------------------------------------------------------------------
 * Why both reports are produced in the same job
 * ---------------------------------------------------------------------------
 * The obvious design is a baseline committed to the repository, and it does
 * not work: wall clock is a property of the machine, so a baseline recorded on
 * one runner is wrong on the next one by more than any regression it is
 * supposed to catch, and a gate that is wrong on arrival gets
 * `continue-on-error: true` within a week. `.github/workflows/ci.yml`
 * therefore measures the merge base and the head commit back to back on the
 * same runner, and hands both reports here. Twice the suite's wall clock, in
 * one job, off the critical path — which is the price of a timing number that
 * means anything.
 *
 * A single base run is enough for the *shape* of the rule, and that is
 * measured rather than assumed: `runs.test.ts` scores it against a one-run
 * baseline over the fifteen held-out runs of `corpus.json` and it raises no
 * false alarm. It is enough for this repository's suite too, at the
 * thresholds in `budget.json` — base from three runs, head from three others,
 * zero alarms — but *only* at those thresholds. The fixture's numbers accuse
 * seven to nine files a run here. Repeat `--base` to buy margin on a noisier
 * runner, and see `budget.ts` for why the two sets of numbers differ.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { baselineFrom, expected, type Baseline } from './baseline.ts'
import { BUDGET, evaluate } from './budget.ts'
import { entries, parseReport, total, type Run } from './durations.ts'

interface Options {
  readonly base: readonly string[]
  readonly head: string
  readonly root: string
}

function parseArgs(argv: readonly string[]): Options {
  const base: string[] = []
  let head: string | undefined
  let root = process.cwd()

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]

    if (flag === '--base' || flag === '--head' || flag === '--root') {
      if (value === undefined) throw new Error(`${flag} needs a value`)

      if (flag === '--base') base.push(value)
      else if (flag === '--head') head = value
      else root = value

      index += 1
      continue
    }

    throw new Error(`unknown argument: ${String(flag)}`)
  }

  if (base.length === 0) throw new Error('--base is required (repeatable)')
  if (head === undefined) throw new Error('--head is required')

  return { base, head, root }
}

function read(path: string, root: string): Run {
  try {
    return parseReport(readFileSync(path, 'utf8'), root)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${path}: ${message}`, { cause: error })
  }
}

const ms = (value: number): string => `${value.toFixed(0)}ms`

const signed = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(0)}ms`

const pct = (ratio: number): string =>
  `${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(1)}%`

/**
 * The per-file comparison, slowest absolute change first.
 *
 * Sorted by what it costs rather than by what it is called or by how large a
 * ratio it is: the file worth looking at first is the one that added the most
 * wall clock, which is `large-tenth` in the fault catalogue and the row a
 * percentage-sorted table buries.
 */
function renderComparison(baseline: Baseline, head: Run): string {
  const rows = entries(head)
    .map(({ file, ms: now }) => {
      const was = expected(baseline, file)
      return { file, now, was, delta: was === undefined ? Infinity : now - was }
    })
    .sort((a, b) => b.delta - a.delta)

  const lines = rows.map(({ file, now, was, delta }) => {
    // Reported, never failed: on a pull request the baseline is the merge
    // base, so every test file the branch adds lands here.
    if (was === undefined) return `  ?  ${file}  ${ms(now)}  (new since the baseline)`

    const ratio = was > 0 ? now / was - 1 : 0
    const { fileTolerance, fileDeltaMs, fileFloorMs } = BUDGET.thresholds
    const over =
      was >= fileFloorMs && now > was * (1 + fileTolerance) && now > was + fileDeltaMs

    return `  ${over ? '✗' : '✓'}  ${file}  ${ms(was)} → ${ms(now)}  (${signed(delta)}, ${pct(ratio)})`
  })

  return lines.join('\n')
}

function run(): void {
  let options: Options

  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`)
    console.error('  usage: node timing/check.ts --base base.json [--base …] --head head.json')
    process.exit(1)
  }

  let baseline: Baseline
  let head: Run

  try {
    baseline = baselineFrom(options.base.map((path) => read(path, options.root)))
    head = read(options.head, options.root)
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`)
    process.exit(1)
  }

  const alarms = evaluate(baseline, head)
  const comparison = renderComparison(baseline, head)
  const headTotal = total(head)

  const summary = [
    '## Test-time budget',
    '',
    `Baseline: ${ms(baseline.totalMs)} over ${String(Object.keys(baseline.files).length)} files, median of ${String(baseline.runs)} run(s).`,
    `Head: ${ms(headTotal)} (${pct(headTotal / baseline.totalMs - 1)}, tolerance ${pct(BUDGET.thresholds.totalTolerance)}).`,
    '',
    '```',
    comparison,
    '```',
    '',
    alarms.length === 0
      ? '✓ Within budget.'
      : `✗ ${String(alarms.length)} budget failure(s):\n\n${alarms.map((a) => `- \`${a.scope}\` — ${a.reason}`).join('\n')}`,
  ].join('\n')

  console.log(comparison)
  console.log()
  console.log(
    `total ${ms(baseline.totalMs)} → ${ms(headTotal)} (${pct(headTotal / baseline.totalMs - 1)}, tolerance ${pct(BUDGET.thresholds.totalTolerance)})`,
  )
  console.log()

  const stepSummary = process.env['GITHUB_STEP_SUMMARY']

  if (stepSummary !== undefined && stepSummary !== '') {
    appendFileSync(stepSummary, `${summary}\n`, 'utf8')
  }

  if (alarms.length === 0) {
    console.log('✓ Test-time budget satisfied.')
    return
  }

  for (const alarm of alarms) console.error(`✗ ${alarm.scope}: ${alarm.reason}`)

  console.error()
  console.error(
    `✗ Test-time budget exceeded. Thresholds: a file at or above ${String(BUDGET.thresholds.fileFloorMs)}ms over its baseline by both ${pct(BUDGET.thresholds.fileTolerance)} and ${String(BUDGET.thresholds.fileDeltaMs)}ms, or the suite total over by ${pct(BUDGET.thresholds.totalTolerance)}. Files marked \`?\` have no baseline entry and are reported, not failed. See timing/README.md.`,
  )
  process.exit(1)
}

run()
