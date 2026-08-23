/**
 * The input corpus the golden master is recorded over.
 *
 * A characterisation suite is worth exactly what its inputs are worth, so the
 * corpus is built rather than collected, and built to a stated shape:
 *
 *   1. **One base case**, an unremarkable customer.
 *   2. **One-factor-at-a-time**, every interesting value of every dimension
 *      varied against that base. Cheap, and it is what makes a missing branch
 *      obvious — a value nobody thought of is a row that is simply not there.
 *   3. **A seeded pseudo-random tail** over the full cross product, because
 *      OFAT sees no interactions at all, and the bugs that survive a refactor
 *      are almost always an interaction (a coupon *and* a credit, a future
 *      renewal date *and* a currency with no tax rate).
 *
 * "Interesting value" means a boundary, the value either side of it, a legal
 * absence, and a malformed input somebody has actually sent. The seat list is
 * 0, 1, 25, 26, 100, 101, 500 because the code branches at 25 and 100, and a
 * corpus that samples 10 and 200 would pin the discount tiers without pinning
 * either edge.
 *
 * ---------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------
 * Nothing here may vary between runs, machines or Node majors: the corpus is
 * hashed into `golden-master.json`, and a corpus that drifts would invalidate
 * the recording on somebody else's laptop. So the tail uses a mulberry32
 * generator seeded with a constant rather than `Math.random`, the clock is a
 * fixed instant, and each case carries the value the system under test will
 * receive from `random()` — the audit-sample flag is an output that has to be
 * pinned like any other.
 */

import type { Customer } from './legacy/renewal'

/** The instant every case is billed at. A Saturday, chosen for no reason. */
export const NOW_ISO = '2024-06-15T12:00:00.000Z'

export type TaxOverrides = Record<string, number> | null

export type Case = {
  readonly id: string
  readonly customer: Customer
  /** Module-level billing configuration, which is an input whether or not it looks like one. */
  readonly tax: TaxOverrides
  readonly nowIso: string
  /** What `ambient.random()` returns for this case, pinning `auditSample`. */
  readonly randomValue: number
}

type Values = {
  plan: string
  seats: number
  createdAt: string
  currency: string
  loyaltyYears: number
  coupon: string | undefined
  creditCents: number | undefined
  lastInvoicedAt: string | undefined
  tax: TaxOverrides
}

const BASE: Values = {
  plan: 'pro',
  seats: 12,
  createdAt: '2021-03-04',
  currency: 'USD',
  loyaltyYears: 0,
  coupon: undefined,
  creditCents: undefined,
  lastInvoicedAt: undefined,
  tax: null,
}

/**
 * The alternatives per dimension, base value excluded.
 *
 * `'01/02/2019'` and `'nope'` are here because the grandfathering check
 * compares dates as strings and the proration check hands them to
 * `Date.parse`. Both meet malformed input by falling through rather than
 * failing, and a corpus of well-formed dates would never say so.
 */
const VARIATIONS: { [K in keyof Values]: readonly Values[K][] } = {
  plan: ['basic', 'enterprise', 'starter'],
  seats: [0, 1, 25, 26, 100, 101, 500],
  createdAt: ['2018-06-30', '2019-01-01', '01/02/2019', 'not-a-date'],
  currency: ['EUR', 'JPY', 'GBP'],
  loyaltyYears: [1, 5, 7],
  coupon: ['', 'SAVE10', 'WELCOME', 'save10', 'FREESTUFF'],
  creditCents: [0, 1250, 50_000],
  // In order: long overdue, mid-period, dated in the future, unparseable.
  lastInvoicedAt: ['2024-01-01', '2024-06-05', '2024-06-20', 'nope'],
  tax: [{ USD: 0.09 }],
}

const DIMENSIONS = Object.keys(VARIATIONS) as (keyof Values)[]

/** The size the tail is padded to, so the corpus is a stated number. */
export const CORPUS_SIZE_CLAIMED = 128

function makeCustomer(id: string, values: Values): Customer {
  // Built by assignment rather than a spread of optionals: under
  // `exactOptionalPropertyTypes` an explicit `coupon: undefined` is a
  // different type from an absent `coupon`, and the difference is one the
  // system under test can see.
  const customer: Customer = {
    id,
    createdAt: values.createdAt,
    plan: values.plan,
    seats: values.seats,
    currency: values.currency,
    loyaltyYears: values.loyaltyYears,
  }

  if (values.coupon !== undefined) customer.coupon = values.coupon
  if (values.creditCents !== undefined) customer.creditCents = values.creditCents
  if (values.lastInvoicedAt !== undefined) customer.lastInvoicedAt = values.lastInvoicedAt

  return customer
}

function describe(value: unknown): string {
  if (value === undefined) return 'absent'
  if (value === '') return 'empty'
  if (value === null) return 'default'
  if (typeof value === 'object') return 'overridden'
  return String(value)
}

/**
 * mulberry32: 32 bits of state, one multiply-xorshift round.
 *
 * Written out rather than imported so the corpus cannot change because a
 * dependency changed. `>>> 0` and `Math.imul` keep every intermediate inside
 * 32 bits, which is what makes the sequence identical on every runtime.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const SEED = 0x5eed_1234

function buildCases(): Case[] {
  const cases: Case[] = []
  const random = mulberry32(SEED)

  const push = (id: string, values: Values): void => {
    cases.push({
      id,
      customer: makeCustomer(`C-${String(cases.length).padStart(3, '0')}`, values),
      tax: values.tax,
      nowIso: NOW_ISO,
      randomValue: random(),
    })
  }

  push('base', BASE)

  for (const dimension of DIMENSIONS) {
    for (const value of VARIATIONS[dimension]) {
      push(`ofat:${dimension}=${describe(value)}`, { ...BASE, [dimension]: value })
    }
  }

  // The tail draws every dimension independently, including the base value, so
  // it can land on combinations OFAT structurally cannot reach.
  const pool: { [K in keyof Values]: readonly Values[K][] } = {
    plan: [BASE.plan, ...VARIATIONS.plan],
    seats: [BASE.seats, ...VARIATIONS.seats],
    createdAt: [BASE.createdAt, ...VARIATIONS.createdAt],
    currency: [BASE.currency, ...VARIATIONS.currency],
    loyaltyYears: [BASE.loyaltyYears, ...VARIATIONS.loyaltyYears],
    coupon: [BASE.coupon, ...VARIATIONS.coupon],
    creditCents: [BASE.creditCents, ...VARIATIONS.creditCents],
    lastInvoicedAt: [BASE.lastInvoicedAt, ...VARIATIONS.lastInvoicedAt],
    tax: [BASE.tax, ...VARIATIONS.tax],
  }

  const pick = <T,>(values: readonly T[]): T => {
    const chosen = values[Math.floor(random() * values.length)]

    if (chosen === undefined && !values.includes(undefined as T)) {
      throw new Error('corpus generator drew outside its pool')
    }

    return chosen as T
  }

  let index = 0

  while (cases.length < CORPUS_SIZE_CLAIMED) {
    push(`random:${String(index).padStart(3, '0')}`, {
      plan: pick(pool.plan),
      seats: pick(pool.seats),
      createdAt: pick(pool.createdAt),
      currency: pick(pool.currency),
      loyaltyYears: pick(pool.loyaltyYears),
      coupon: pick(pool.coupon),
      creditCents: pick(pool.creditCents),
      lastInvoicedAt: pick(pool.lastInvoicedAt),
      tax: pick(pool.tax),
    })
    index += 1
  }

  return cases
}

export const CORPUS: readonly Case[] = buildCases()

export const OFAT_CASE_COUNT = 1 + DIMENSIONS.reduce((total, d) => total + VARIATIONS[d].length, 0)

/**
 * A 32-bit FNV-1a hash of the corpus, stored alongside the recording.
 *
 * Its job is to make one specific dishonest move loud: deleting the cases a
 * change happens to break and re-approving the rest. Shrink the corpus and the
 * fingerprint moves, so the golden master has to be re-recorded deliberately
 * rather than edited quietly.
 */
export function fingerprint(cases: readonly Case[]): string {
  const text = JSON.stringify(cases)
  let hash = 0x811c_9dc5

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x0100_0193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}
