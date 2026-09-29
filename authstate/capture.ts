/**
 * The capture table: what each wiring's saved file still has in it.
 *
 * Declared here and re-derived against Chromium by `capture.spec.ts` on every
 * run. Nothing in this file is generated from the measurement and nothing in
 * the measurement is generated from this file — the two are written
 * independently and compared, which is the only arrangement in which a wrong
 * prediction can be caught rather than absorbed.
 *
 * The findings below are functions over this table, asserted by `matrix.test.ts`
 * and rendered into `README.md` by `readme.test.ts`, so a cell that moves takes
 * the prose with it or fails the build.
 */

import { PROBE_KEYS, PROBES, verdictFits, type Verdict } from './probes.ts'
import { WIRING_KEYS } from './wirings.ts'

/** One wiring's answer to all seven probes. */
export type CaptureRow = Readonly<Record<string, Verdict>>

/**
 * The measured table.
 *
 * Read down the `session-storage` column before anything else: it is constant,
 * and a constant column in a table of four genuinely different recipes is the
 * strongest kind of finding this format can carry.
 */
export const EXPECTED_CAPTURE: Readonly<Record<string, CaptureRow>> = {
  'api-only': {
    cookie: 'present',
    'local-storage': 'absent',
    'session-storage': 'absent',
    'indexed-db': 'absent',
    'server-gate': 'signed-in',
    'spa-gate': 'signed-out',
    'idb-gate': 'signed-out',
  },
  'api-then-seed': {
    cookie: 'present',
    'local-storage': 'present',
    'session-storage': 'absent',
    'indexed-db': 'absent',
    'server-gate': 'signed-in',
    'spa-gate': 'signed-in',
    'idb-gate': 'signed-out',
  },
  'ui-login': {
    cookie: 'present',
    'local-storage': 'present',
    'session-storage': 'absent',
    'indexed-db': 'absent',
    'server-gate': 'signed-in',
    'spa-gate': 'signed-in',
    'idb-gate': 'signed-out',
  },
  'ui-login-idb': {
    cookie: 'present',
    'local-storage': 'present',
    'session-storage': 'absent',
    'indexed-db': 'present',
    'server-gate': 'signed-in',
    'spa-gate': 'signed-in',
    'idb-gate': 'signed-in',
  },
}

/** Every cell, flattened, for the assertions that quantify over the table. */
export interface CaptureCell {
  readonly wiring: string
  readonly probe: string
  readonly verdict: Verdict
}

export function captureCells(
  table: Readonly<Record<string, CaptureRow>> = EXPECTED_CAPTURE,
): CaptureCell[] {
  const cells: CaptureCell[] = []

  for (const wiring of WIRING_KEYS) {
    const row = table[wiring]

    if (row === undefined) {
      throw new Error(`No capture row for wiring ${JSON.stringify(wiring)}`)
    }

    for (const probe of PROBE_KEYS) {
      const verdict = row[probe]

      if (verdict === undefined) {
        throw new Error(`The ${wiring} row has no ${probe} cell`)
      }

      cells.push({ wiring, probe, verdict })
    }
  }

  return cells
}

/** One column, top to bottom. */
export function captureColumn(
  probe: string,
  table: Readonly<Record<string, CaptureRow>> = EXPECTED_CAPTURE,
): Verdict[] {
  return WIRING_KEYS.map((wiring) => {
    const verdict = table[wiring]?.[probe]

    if (verdict === undefined) {
      throw new Error(`No ${probe} cell for wiring ${JSON.stringify(wiring)}`)
    }

    return verdict
  })
}

/** The probes on which two wirings disagree, in table order. */
export function captureDifferences(
  left: string,
  right: string,
  table: Readonly<Record<string, CaptureRow>> = EXPECTED_CAPTURE,
): string[] {
  return PROBES.filter((probe) => table[left]?.[probe.key] !== table[right]?.[probe.key]).map(
    (probe) => probe.key,
  )
}

/**
 * How many of the three gates a wiring signs in.
 *
 * Deliberately not called a score. A wiring that signs in all three costs a
 * browser and an option; one that signs in one may be entirely correct for the
 * application it was written for. The number ranks rows for a reader, it does
 * not rank recipes.
 */
export function gatesPassed(
  wiring: string,
  table: Readonly<Record<string, CaptureRow>> = EXPECTED_CAPTURE,
): number {
  return PROBES.filter(
    (probe) => probe.family === 'gate' && table[wiring]?.[probe.key] === 'signed-in',
  ).length
}

/** Structural checks the table must satisfy before any finding is read off it. */
export function captureProblems(
  table: Readonly<Record<string, CaptureRow>> = EXPECTED_CAPTURE,
): string[] {
  const problems: string[] = []
  const declared = Object.keys(table)

  for (const wiring of declared) {
    if (!WIRING_KEYS.includes(wiring)) {
      problems.push(`${wiring} has a capture row but is not a wiring in wirings.ts`)
    }
  }

  for (const wiring of WIRING_KEYS) {
    const row = table[wiring]

    if (row === undefined) {
      problems.push(`${wiring} is a wiring with no capture row`)

      continue
    }

    for (const key of Object.keys(row)) {
      if (!PROBE_KEYS.includes(key)) {
        problems.push(`the ${wiring} row has a ${key} cell, which is not a probe in probes.ts`)
      }
    }

    for (const probe of PROBES) {
      const verdict = row[probe.key]

      if (verdict === undefined) {
        problems.push(`the ${wiring} row has no ${probe.key} cell`)
      } else if (!verdictFits(probe, verdict)) {
        problems.push(
          `the ${wiring} row answers ${probe.key} — a ${probe.family} probe — with ` +
            `${verdict}, which belongs to the other family`,
        )
      }
    }
  }

  return problems
}
