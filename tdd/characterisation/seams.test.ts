// @vitest-environment node
/**
 * The one edit made before there was a test to protect it.
 *
 * `renewalInvoice` gained an `ambient` parameter so that a call could be
 * repeated. That change had to be made first — until the clock and the random
 * source are controllable, no two runs agree and there is nothing to record —
 * and it therefore had no golden master watching it. The only defence
 * available for an edit in that position is to keep it small enough that its
 * correctness is a single claim, and then to test that claim directly:
 *
 *   **omitting the parameter must reach exactly what the body used to reach.**
 *
 * So these tests substitute the globals themselves, call with one argument the
 * way production does, and check that the substitutions were seen. They are
 * the reason the default value in the signature can be believed, and they are
 * the only tests in this folder that stub a global rather than pass a stub in.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AMBIENT, renewalInvoice, resetTax } from './legacy/renewal'
import type { Customer } from './legacy/renewal'

function account(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'A-000',
    createdAt: '2021-03-04',
    plan: 'basic',
    seats: 10,
    currency: 'USD',
    loyaltyYears: 0,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetTax()
})

describe('the default ambient', () => {
  it('reads the wall clock, as the inlined `new Date()` did', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-11-09T08:15:00.000Z'))

    const customer = account()
    renewalInvoice(customer)

    expect(customer.lastInvoicedAt).toBe('2030-11-09')
  })

  it('draws the audit flag from Math.random, as the inlined call did', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    expect(renewalInvoice(account()).auditSample).toBe(true)

    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(renewalInvoice(account()).auditSample).toBe(false)
  })

  it('writes its complaints to console.warn, as the inlined call did', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renewalInvoice(account({ plan: 'starter' }))

    expect(warn).toHaveBeenCalledWith('unknown plan starter, billing at the basic rate')
  })

  it('leaves the sensing seam switched off', () => {
    // `trace` is the seam with no production counterpart: it exists so
    // `corpus.test.ts` can state which branches were reached. Its default must
    // therefore be genuinely inert — a default that logged would turn a test
    // fixture into a production behaviour change.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(AMBIENT.trace('plan:known')).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})

describe('passing an ambient in', () => {
  it('overrides all four, so a call can be repeated exactly', () => {
    const warnings: string[] = []
    const branches: string[] = []
    const fixed = new Date('2024-06-15T12:00:00.000Z')

    const first = renewalInvoice(account({ plan: 'starter' }), {
      now: () => fixed,
      random: () => 0.02,
      warn: (message) => warnings.push(message),
      trace: (branch) => branches.push(branch),
    })

    const second = renewalInvoice(account({ plan: 'starter' }), {
      now: () => fixed,
      random: () => 0.02,
      warn: () => {},
      trace: () => {},
    })

    expect(first).toEqual(second)
    expect(first.auditSample).toBe(true)
    expect(warnings).toEqual(['unknown plan starter, billing at the basic rate'])
    expect(branches).toContain('plan:unknown')
  })
})
