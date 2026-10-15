/**
 * The only test whose dependency is a data file rather than a module.
 *
 * It imports `rates.ts`; `rates.ts` reads `data/rates.json`. Both edges are
 * real and only the first one is written down anywhere a parser can see.
 */

import { describe, expect, it } from 'vitest'

import { convertCents, loadRates } from './rates.ts'

describe('currency conversion', () => {
  it('converts at the rate in the table', () => {
    expect(convertCents(1_000, 'EUR')).toBeExactInteger(920)
  })

  it('rounds to the nearest minor unit', () => {
    expect(convertCents(999, 'GBP')).toBeExactInteger(789)
  })

  it('rejects a currency the table does not list', () => {
    expect(() => convertCents(1_000, 'JPY')).toThrow('no rate for JPY')
  })

  it('reads every currency in the table', () => {
    expect(Object.keys(loadRates()).sort()).toEqual(['EUR', 'GBP'])
  })
})
