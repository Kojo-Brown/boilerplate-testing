/**
 * Reading the recording back.
 *
 * `golden-master.json` is loaded from disk rather than imported as a module,
 * for one reason worth stating: a recording is data under review, not code
 * under compilation. Reading it with `fs` keeps it out of the module graph, so
 * nothing can accidentally depend on its shape at build time, and the diff a
 * reviewer sees when it changes is the whole story.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Observation } from './observe'

export type GoldenMaster = {
  readonly recordedFrom: string
  readonly fingerprint: string
  readonly caseCount: number
  readonly cases: Record<string, Observation>
}

export const GOLDEN_MASTER_PATH = fileURLToPath(new URL('./golden-master.json', import.meta.url))

export function loadGoldenMaster(): GoldenMaster {
  const parsed: unknown = JSON.parse(readFileSync(GOLDEN_MASTER_PATH, 'utf8'))

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('golden-master.json is not an object')
  }

  const master = parsed as Partial<GoldenMaster>

  if (
    typeof master.recordedFrom !== 'string' ||
    typeof master.fingerprint !== 'string' ||
    typeof master.caseCount !== 'number' ||
    typeof master.cases !== 'object' ||
    master.cases === null
  ) {
    throw new Error('golden-master.json is missing its header; re-record it with pnpm characterise:record')
  }

  return {
    recordedFrom: master.recordedFrom,
    fingerprint: master.fingerprint,
    caseCount: master.caseCount,
    cases: master.cases,
  }
}

export function recordedFor(master: GoldenMaster, id: string): Observation {
  const observation = master.cases[id]

  if (observation === undefined) {
    throw new Error(`the golden master has no recording for case ${id}`)
  }

  return observation
}
