#!/usr/bin/env node
/**
 * Calibration — Node CLI, run by hand when the suite or the runner changes.
 *
 * Usage:
 *   node timing/calibrate.ts run1.json run2.json run3.json …
 *
 * Takes several Vitest JSON reports of the same unchanged suite and prints its
 * noise floor, the files that disagree with themselves most, and which
 * candidate thresholds would wrongly accuse something. The arithmetic lives in
 * `noise.ts`, which imports nothing from Node so that Vitest can reach it;
 * this file is the part that reads the filesystem and decides an exit code.
 *
 * The margin between the floor this prints and the numbers committed to
 * `budget.json` is a judgement, and it is written down next to them rather
 * than inferred. Raise a threshold to clear a floor this reports; never lower
 * one to turn a red build green.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { parseReport } from './durations.ts'
import { calibrate, falseAlarms } from './noise.ts'

function run(): void {
  const paths = process.argv.slice(2)

  if (paths.length < 2) {
    console.error('✗ calibration needs at least two Vitest JSON reports')
    console.error('  usage: node timing/calibrate.ts run1.json run2.json …')
    process.exit(1)
  }

  const root = process.cwd()
  const runs = paths.map((path) => parseReport(readFileSync(path, 'utf8'), root))
  const measured = calibrate(runs, 0)

  console.log(
    `${String(measured.runs)} runs of ${String(measured.files)} files, median total ${measured.totalMedianMs.toFixed(0)}ms`,
  )
  console.log(`total noise floor:        +${(measured.totalRelative * 100).toFixed(1)}%`)
  console.log(`worst file, relative:     +${(measured.worstRelative * 100).toFixed(0)}%`)
  console.log(`worst file, absolute:     +${measured.worstAbsoluteMs.toFixed(0)}ms`)
  console.log()
  console.log('noisiest files by absolute disagreement with their own median:')

  for (const entry of measured.noisiest.slice(0, 10)) {
    console.log(
      `  ${entry.file}  ${entry.medianMs.toFixed(0)}ms → ${entry.worstMs.toFixed(0)}ms  (+${entry.absolute.toFixed(0)}ms, +${(entry.relative * 100).toFixed(0)}%)`,
    )
  }

  console.log()
  console.log('candidate thresholds and the files they would wrongly accuse:')

  for (const [tolerance, deltaMs, floorMs] of [
    [0.25, 25, 25],
    [0.5, 250, 100],
    [0.5, 500, 100],
    [0.75, 1_000, 100],
    [1.0, 2_500, 100],
  ] as const) {
    const wrong = falseAlarms(measured, tolerance, deltaMs, floorMs)

    console.log(
      `  ${String(tolerance * 100)}% + ${String(deltaMs)}ms (floor ${String(floorMs)}ms): ${String(wrong.length)} file(s)${wrong.length > 0 ? ` — ${wrong.map((entry) => entry.file).join(', ')}` : ''}`,
    )
  }
}

run()
