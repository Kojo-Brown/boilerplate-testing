/**
 * Running every probe against every fault, once.
 *
 * Kept apart from the tests because two of them need it — `detection.test.ts`
 * asserts the result and `readme.test.ts` compares the README's table against
 * it — and because a matrix computed twice is a matrix that can disagree with
 * itself.
 */

import type fc from 'fast-check'
import { availability } from './availability'
import { RUN } from './config'
import { FAULTS, type Fault, type FaultId } from './faults'
import { PROBES, type ProbeId, type ProbeResult } from './probes'

export interface MatrixRow {
  readonly fault: Fault
  readonly results: Readonly<Record<ProbeId, ProbeResult>>
}

const runAll = (
  api: Parameters<(typeof PROBES)[number]['run']>[0],
  params: fc.Parameters<unknown>,
): Readonly<Record<ProbeId, ProbeResult>> =>
  Object.fromEntries(PROBES.map((probe) => [probe.id, probe.run(api, params)])) as Record<
    ProbeId,
    ProbeResult
  >

/** Every probe against every broken system. */
export function runMatrix(params: fc.Parameters<unknown> = RUN): MatrixRow[] {
  return FAULTS.map((fault) => ({ fault, results: runAll(fault.build(), params) }))
}

/**
 * Every probe against the system that is not broken.
 *
 * The control. A probe that reports a catch here is measuring its own bugs,
 * and every column of the matrix above would be meaningless.
 */
export function runControl(params: fc.Parameters<unknown> = RUN): Readonly<
  Record<ProbeId, ProbeResult>
> {
  return runAll(availability, params)
}

/** The set of faults a probe caught, as ids, for set comparisons in tests. */
export const caughtBy = (rows: readonly MatrixRow[], probe: ProbeId): FaultId[] =>
  rows.filter((row) => row.results[probe].caught).map((row) => row.fault.id)

/** The faults no probe caught. Should be empty, and is asserted to be. */
export const missedByEveryProbe = (rows: readonly MatrixRow[]): FaultId[] =>
  rows
    .filter((row) => PROBES.every((probe) => !row.results[probe.id].caught))
    .map((row) => row.fault.id)
