/**
 * Rendering the measurement, and the findings drawn from it.
 *
 * `README.md` does not describe these tables, it *contains* them: every table
 * below is rendered from the model and `readme.test.ts` asserts the document
 * holds the rendered text. A cell cannot be wrong in the README without being
 * wrong in `matrix.ts`, and a cell cannot be wrong in `matrix.ts` without
 * `runs.test.ts` failing against the corpus.
 *
 * `holds` takes the measurement rather than reading the module's own, and that
 * is the difference between a predicate and a decoration: `findings.test.ts`
 * hands each one a copy with a single cell moved and requires it to return
 * false. A finding that closed over `TABLE` could be `() => true` and no test
 * here would notice.
 */

import { BUDGET } from './budget.ts'
import { noiseProfile, totalNoise, type Noise } from './corpus.ts'
import { FAULT_IDS, FAULTS, fault, type FaultId } from './faults.ts'
import {
  FILE_DELTA_MS,
  FILE_FLOOR_MS,
  FILE_TOLERANCE,
  GATE_IDS,
  GATES,
  TOTAL_TOLERANCE,
  type GateId,
} from './gates.ts'
import { RUNS, TABLE, TALLIES } from './matrix.ts'
import { REAL_SUITE, share, visibleInTotal } from './score.ts'

/** The gate × fault counts, as the findings and the renderer read them. */
export type Table = Readonly<Record<GateId, Readonly<Record<FaultId, number>>>>

/** Everything a finding may range over. */
export interface Measurement {
  readonly table: Table
  readonly tallies: Readonly<Record<GateId, number>>
  readonly noise: readonly Noise[]
  readonly total: Noise
  readonly runs: number
}

/** The measurement as published. */
export const MEASURED: Measurement = {
  table: TABLE,
  tallies: TALLIES,
  noise: noiseProfile(),
  total: totalNoise(),
  runs: RUNS,
}

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

const pct0 = (ratio: number): string => `${(ratio * 100).toFixed(0)}%`

/** `| a | b |` with the cells padded to `widths`. */
function tableRow(cells: readonly string[], widths: readonly number[]): string {
  return `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(' | ')} |`
}

function markdown(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => (row[index] ?? '').length)),
  )

  return [
    tableRow(header, widths),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map((row) => tableRow(row, widths)),
  ].join('\n')
}

/**
 * The noise profile: what sixteen measurements of an unchanged file look like.
 *
 * This is the table every other table here depends on, and the column that
 * matters is `spread` — the percentage regression a per-file gate has to
 * tolerate on that file to stay quiet when nothing has happened.
 */
export function renderNoise(measurement: Measurement = MEASURED): string {
  const rows = [...measurement.noise, measurement.total].map((entry) => [
    entry.file === 'TOTAL' ? '**TOTAL**' : `\`${entry.file.replace('fixture/', '')}\``,
    `${entry.medianMs.toFixed(1)}ms`,
    `${entry.minMs.toFixed(1)}ms`,
    `${entry.maxMs.toFixed(1)}ms`,
    `+${pct0(entry.spread)}`,
    `+${pct0(entry.p95Spread)}`,
  ])

  return markdown(['file', 'median', 'min', 'max', 'spread', 'p95'], rows)
}

/** The regressions being injected, and what a gate is meant to do about each. */
export function renderFaults(): string {
  return markdown(
    ['fault', 'change', 'scaling', 'right answer'],
    FAULTS.map((entry) => [
      `\`${entry.id}\``,
      entry.change,
      entry.scaling,
      entry.want === 'quiet' ? 'stay quiet' : 'fire',
    ]),
  )
}

/** The gate designs being scored. */
export function renderGates(): string {
  return markdown(
    ['design', 'rule'],
    GATES.map((entry) => [`\`${entry.id}\``, entry.rule]),
  )
}

/**
 * The matrix: how many of the sixteen runs each design fired on.
 *
 * The right answer is 0 in a `quiet` column and 16 in a `fire` one, so a cell
 * that is neither is a design whose threshold is inside the noise.
 */
export function renderMatrix(measurement: Measurement = MEASURED): string {
  const header = [
    'design',
    ...FAULT_IDS.map((id) => `${id} (${fault(id).want === 'quiet' ? '0' : String(measurement.runs)})`),
    'correct',
  ]

  const rows = GATE_IDS.map((gateId) => [
    `\`${gateId}\``,
    ...FAULT_IDS.map((faultId) => String(measurement.table[gateId][faultId])),
    `${String(measurement.tallies[gateId])}/${String(FAULT_IDS.length)}`,
  ])

  return markdown(header, rows)
}

/**
 * Dilution: what each fault is worth to a total-only rule as the suite grows.
 *
 * The `visible` column is the whole argument against reading the
 * `total-percent` row of the matrix as a recommendation.
 */
export function renderDilution(): string {
  const rows = FAULT_IDS.filter((id) => id !== 'none').map((id) => [
    `\`${id}\``,
    fault(id).scaling,
    `+${pct(share(id, MEASURED.total.medianMs))}`,
    // Three decimals, because the point of the column is how small these get:
    // rounded to one, four of the six rows read `+0.0%` and the table stops
    // saying anything.
    `+${(share(id, REAL_SUITE.totalMs) * 100).toFixed(3)}%`,
    visibleInTotal(id, REAL_SUITE.totalMs, TOTAL_TOLERANCE) ? 'yes' : 'no',
  ])

  return markdown(
    [
      'fault',
      'scaling',
      'share of fixture (5 files)',
      `share of this repo (${String(REAL_SUITE.files)} files)`,
      `visible to a ${pct0(TOTAL_TOLERANCE)} total rule at that size`,
    ],
    rows,
  )
}

/**
 * The two sets of thresholds side by side.
 *
 * The left column is what the matrix was scored with and the right is what CI
 * enforces, and the gap between them is this directory's last finding: the
 * fixture's numbers accuse seven to nine of this repository's files per run of
 * regressions that did not happen.
 */
export function renderThresholds(): string {
  const { fileTolerance, fileDeltaMs, fileFloorMs, totalTolerance } = BUDGET.thresholds

  return markdown(
    ['threshold', 'fixture (`gates.ts`)', 'this suite (`budget.json`)'],
    [
      ['file tolerance', pct0(FILE_TOLERANCE), pct0(fileTolerance)],
      ['file delta', `${String(FILE_DELTA_MS)}ms`, `${String(fileDeltaMs)}ms`],
      ['file floor', `${String(FILE_FLOOR_MS)}ms`, `${String(fileFloorMs)}ms`],
      ['total tolerance', pct0(TOTAL_TOLERANCE), pct0(totalTolerance)],
    ],
  )
}

/** What the calibration measured, with its provenance. */
export function renderCalibration(): string {
  const c = BUDGET.calibration

  return markdown(
    ['measured', 'value'],
    [
      ['runs of the unchanged suite', String(c.runs)],
      ['files common to every run', String(c.files)],
      ['median total', `${String(c.medianTotalMs)}ms`],
      ['total noise floor', `+${pct0(c.totalNoiseFloor)}`],
      ['worst file, relative', `+${pct0(c.worstFileRelative)}`],
      ['worst file, absolute', `+${String(c.worstFileAbsoluteMs)}ms`],
      ['files a doubling of which is caught', `${String(c.policedFiles)} of ${String(c.files + 4)}`],
      ['their share of the wall clock', pct0(c.policedShareOfWallClock)],
      ['machine', c.machine],
      ['recorded', c.recordedAt],
    ],
  )
}

/** The thresholds, so the README cannot quote a number the code does not use. */
export const QUOTED: readonly string[] = [
  `${pct0(FILE_TOLERANCE)}`,
  `${String(FILE_DELTA_MS)}ms`,
  `${String(FILE_FLOOR_MS)}ms`,
  `${pct0(TOTAL_TOLERANCE)}`,
]

export interface Finding {
  /** The heading the README must carry, verbatim. */
  readonly heading: string
  /** True when the measurement still supports it. */
  readonly holds: (measurement: Measurement) => boolean
}

const shortest = (measurement: Measurement): Noise => {
  const sorted = [...measurement.noise].sort((a, b) => a.medianMs - b.medianMs)
  const first = sorted[0]

  if (first === undefined) throw new Error('no noise profile')

  return first
}

const longest = (measurement: Measurement): Noise => {
  const sorted = [...measurement.noise].sort((a, b) => b.medianMs - a.medianMs)
  const first = sorted[0]

  if (first === undefined) throw new Error('no noise profile')

  return first
}

/** The faults whose right answer is to fire. */
const REAL: readonly FaultId[] = FAULT_IDS.filter((id) => fault(id).want === 'fire')

/** Every per-file design — the rows with no term in the suite total. */
const PER_FILE: readonly GateId[] = [
  'file-percent',
  'file-percent-floored',
  'file-absolute',
  'file-both',
]

export const FINDINGS: readonly Finding[] = [
  {
    heading: "A file's run-to-run spread is a property of its duration, not of its code",
    holds: (measurement) => {
      // The shortest file is the noisiest and the longest is the quietest, by
      // an order of magnitude. Nothing in the fixture changed between runs, so
      // this is the instrument's resolution rather than the subject's
      // behaviour — and it is why one percentage cannot serve both files.
      const small = shortest(measurement)
      const large = longest(measurement)

      return small.spread > 1 && large.spread < 0.05 && small.spread > large.spread * 10
    },
  },
  {
    heading: 'A per-file percentage gate fails pull requests that changed nothing',
    holds: (measurement) => measurement.table['file-percent']['none'] > 0,
  },
  {
    heading: 'Flooring the percentage buys silence by giving up almost every detection',
    holds: (measurement) => {
      const floored = measurement.table['file-percent-floored']
      const caught = REAL.filter((id) => floored[id] === measurement.runs)

      return floored['none'] === 0 && caught.length === 1
    },
  },
  {
    heading: 'A threshold set near the size of the regression is a coin flip',
    holds: (measurement) => {
      const cell = measurement.table['file-absolute']['large-tenth']

      // Fired on some runs and not others, against sixteen copies of one
      // regression. The input never varied; the verdict did.
      return cell > 0 && cell < measurement.runs
    },
  },
  {
    heading: 'Only the total rule sees a slowdown that no single file owns',
    holds: (measurement) =>
      // The total rule fires on every run; no per-file design fires on every
      // run. `file-percent` is not at zero in this column — it is at 3, the
      // same three runs it fails on when nothing has changed at all, which is
      // the distinction this predicate has to make. Firing sometimes, for the
      // wrong reason, is not detection.
      measurement.table['total-percent']['creep'] === measurement.runs &&
      PER_FILE.every((gateId) => measurement.table[gateId]['creep'] < measurement.runs),
  },
  {
    heading: "The total rule's perfect score is a property of the fixture's size",
    holds: (measurement) => {
      // It answers all seven faults here and would see exactly one of them in
      // this repository's own suite: the proportional one. Every localised
      // regression is diluted below any tolerance worth setting.
      const perfect = measurement.tallies['total-percent'] === FAULT_IDS.length
      const survives = REAL.filter((id) =>
        visibleInTotal(id, REAL_SUITE.totalMs, TOTAL_TOLERANCE),
      )

      return (
        perfect &&
        survives.length === 1 &&
        survives[0] !== undefined &&
        fault(survives[0]).scaling === 'proportional'
      )
    },
  },
]
