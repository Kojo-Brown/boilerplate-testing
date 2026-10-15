/**
 * Currency conversion, from a table on disk.
 *
 * The data file is read, not imported, which is the whole reason this module
 * is in the fixture: `data/rates.json` is a dependency of every test that
 * touches this file and there is no import statement anywhere that says so.
 * A selector built from the import graph alone sees a change to the table as
 * touching nothing.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Absolute path of the rate table. Read at call time so a test can rewrite it. */
export const RATES_FILE = fileURLToPath(new URL('./data/rates.json', import.meta.url))

/** Rates in basis points against the base currency: 9200 is 0.92. */
export function loadRates(): Readonly<Record<string, number>> {
  return JSON.parse(readFileSync(RATES_FILE, 'utf8')) as Record<string, number>
}

export function convertCents(cents: number, currency: string): number {
  const basisPoints = loadRates()[currency]

  if (basisPoints === undefined) throw new Error(`no rate for ${currency}`)

  return Math.round((cents * basisPoints) / 10_000)
}
