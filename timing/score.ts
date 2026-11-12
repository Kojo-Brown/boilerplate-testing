/**
 * Scoring: every gate design against every fault, over every recorded run.
 *
 * One cell is a count out of sixteen — the number of recorded runs in which
 * that gate fired, with that fault applied. A count rather than a boolean
 * because the question a timing gate has to answer is not "can it notice this
 * regression" but "does it notice it *every time*": a design that fires in
 * nine runs of sixteen on the same unchanged input is not a gate, it is a coin
 * flip that occasionally fails a pull request, and a boolean cell would record
 * it as a pass.
 *
 * The baseline is derived from the same sixteen runs the faults are applied
 * to, and that is the favourable case rather than an oversight: a real CI
 * baseline was recorded on another machine at another time, so its disagreement
 * with today's run is strictly larger than anything measurable here. Every
 * false-alarm count below is therefore a floor, and the designs that already
 * fail the control row fail it worse in production.
 */

import { baselineFrom, type Baseline } from './baseline.ts'
import { total } from './durations.ts'
import { CORPUS, runs as corpusRuns, type Corpus } from './corpus.ts'
import { FAULT_IDS, fault, type FaultId } from './faults.ts'
import { GATE_IDS, fires, type GateId } from './gates.ts'

/** The baseline the matrix is scored against: medians of the whole corpus. */
export function corpusBaseline(corpus: Corpus = CORPUS): Baseline {
  return baselineFrom(corpusRuns(corpus))
}

/** How many of the recorded runs `gate` fires on once `fault` is applied. */
export function count(
  gateId: GateId,
  faultId: FaultId,
  corpus: Corpus = CORPUS,
): number {
  const baseline = corpusBaseline(corpus)
  const { apply } = fault(faultId)

  return corpusRuns(corpus).filter((run) => fires(gateId, baseline, apply(run))).length
}

/** One gate's row, in the column order of `FAULT_IDS`. */
export type Row = Readonly<Record<FaultId, number>>

export function row(gateId: GateId, corpus: Corpus = CORPUS): Row {
  return Object.fromEntries(
    FAULT_IDS.map((faultId) => [faultId, count(gateId, faultId, corpus)]),
  ) as Row
}

/** The whole table, in the row order of `GATE_IDS`. */
export type Scores = Readonly<Record<GateId, Row>>

export function scores(corpus: Corpus = CORPUS): Scores {
  return Object.fromEntries(GATE_IDS.map((gateId) => [gateId, row(gateId, corpus)])) as Scores
}

/**
 * Whether a cell is the answer the fault asks for.
 *
 * A `quiet` fault wants zero fires out of all of them; a `fire` fault wants
 * all of them. Anything in between is the flapping case and counts as wrong
 * for either, which is the strict reading and the useful one.
 */
export function correct(faultId: FaultId, fired: number, of: number): boolean {
  return fault(faultId).want === 'quiet' ? fired === 0 : fired === of
}

/** How many of the seven faults a gate answers correctly in every run. */
export function tally(gateId: GateId, corpus: Corpus = CORPUS): number {
  const scored = row(gateId, corpus)

  return FAULT_IDS.filter((faultId) =>
    correct(faultId, scored[faultId], corpus.rows.length),
  ).length
}

/**
 * ---------------------------------------------------------------------------
 * Dilution
 * ---------------------------------------------------------------------------
 * What a fault is worth as a fraction of a suite's total, for a suite of a
 * given size. This is the arithmetic that keeps the `total-percent` row of the
 * matrix from being read as a recommendation.
 *
 * A total-only gate fires when a regression is a large enough share of the
 * total, and `TOTAL_TOLERANCE` fixes "large enough" while the share is fixed
 * by the fault's `scaling`:
 *
 *   - a **local** fault costs the same milliseconds whatever the suite is, so
 *     its share shrinks as the suite grows. Tripling one 10ms file is 5.1% of
 *     this five-file fixture and 0.016% of this repository's own 220-file
 *     suite — the same regression, diluted by two orders of magnitude into a
 *     figure no tolerance can be set below.
 *   - a **proportional** fault is a fraction of the suite by construction, so
 *     its share does not move at all. `creep` is 5% of five files and 5% of
 *     five thousand, which is why it is the one fault here that only a total
 *     rule can catch, at any scale.
 *
 * Those two sentences are the reason the shipped gate is a disjunction rather
 * than whichever row of the matrix scored best.
 */

/** The suite this repository actually has, for the dilution comparison. */
export const REAL_SUITE = {
  files: 220,
  /** Wall clock of `pnpm test` on the machine that recorded the corpus. */
  totalMs: 118_580,
} as const

/** A fault's cost in ms when applied to the corpus fixture. */
export function fixtureCost(faultId: FaultId, corpus: Corpus = CORPUS): number {
  const run = corpusRuns(corpus)[0]

  if (run === undefined) throw new Error('corpus has no runs')

  return total(fault(faultId).apply(run)) - total(run)
}

/**
 * A fault's cost as a fraction of a suite whose total is `totalMs`.
 *
 * A proportional fault keeps the share it has in the fixture; a local one
 * keeps its milliseconds and loses its share.
 */
export function share(faultId: FaultId, totalMs: number, corpus: Corpus = CORPUS): number {
  if (totalMs <= 0) throw new Error('a suite total must be positive')

  const cost = fixtureCost(faultId, corpus)

  if (fault(faultId).scaling === 'proportional') {
    const run = corpusRuns(corpus)[0]

    if (run === undefined) throw new Error('corpus has no runs')

    return cost / total(run)
  }

  return cost / totalMs
}

/** Whether a total-only gate at `tolerance` could see the fault at `totalMs`. */
export function visibleInTotal(
  faultId: FaultId,
  totalMs: number,
  tolerance: number,
  corpus: Corpus = CORPUS,
): boolean {
  return share(faultId, totalMs, corpus) > tolerance
}
