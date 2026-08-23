/**
 * Renewal invoicing, as inherited. Do not tidy this file.
 *
 * This is the subject of the characterisation exercise in `../README.md`. It
 * is deliberately left in the shape it arrived in — a single function that
 * accumulates a running total through eight stages, rounds at every one of
 * them, reads module-level mutable configuration, mutates its argument, and
 * writes to the console when it meets something it does not recognise. Every
 * quirk in here is load-bearing for somebody's invoice, which is the whole
 * problem.
 *
 * ---------------------------------------------------------------------------
 * The one edit made before any test existed
 * ---------------------------------------------------------------------------
 * The original took no second parameter. It called `new Date()`, `Math.random()`
 * and `console.warn` directly, which makes the output of a single call
 * unrepeatable and therefore impossible to characterise: two runs a day apart
 * disagree, and the audit-sample flag disagrees with itself. So the first
 * change — made with no safety net, because there could not be one yet — was
 * to add the `ambient` parameter and default it to exactly the three things
 * the body used to do inline.
 *
 * That edit is defensible only because it is provably a no-op when the
 * parameter is omitted, and `../seams.test.ts` is where that is proved: it
 * substitutes the globals themselves and shows the default seam reaching them.
 * Everything after that first edit is covered by the golden master.
 *
 * `ambient.trace` is the same move for a different reason: a sensing seam, so
 * `../corpus.test.ts` can state which branches the corpus actually reaches
 * rather than hoping. It defaults to doing nothing.
 *
 * ---------------------------------------------------------------------------
 * No imports, on purpose
 * ---------------------------------------------------------------------------
 * `../mutants.ts` compiles this file from its own source text, one deliberate
 * edit at a time, and loads the result from a temporary directory. A relative
 * import would not resolve from there. Keeping the module self-contained is
 * what lets the mutation testing operate on the real source rather than on a
 * hand-maintained copy that would rot.
 */

export type Customer = {
  id: string
  /** ISO date. Compared as a string below, which is the interesting part. */
  createdAt: string
  plan: string
  seats: number
  currency: string
  loyaltyYears: number
  coupon?: string
  creditCents?: number
  lastInvoicedAt?: string
}

export type Invoice = {
  customerId: string
  currency: string
  /** seats × unit price, before anything is taken off. */
  subtotal: number
  /** after volume, loyalty and proration. */
  discounted: number
  credit: number
  /** after the credit and the coupon; the figure tax is charged on. */
  payable: number
  tax: number
  total: number
  auditSample: boolean
}

/** The three things this function used to reach for directly, plus a sensor. */
export type Ambient = {
  now: () => Date
  random: () => number
  warn: (message: string) => void
  trace: (branch: string) => void
}

export const AMBIENT: Ambient = {
  now: () => new Date(),
  random: () => Math.random(),
  warn: (message) => {
    console.warn(message)
  },
  trace: () => {},
}

/**
 * Every branch this function can take, in source order.
 *
 * Exported so `../corpus.test.ts` can assert two things at once: that every
 * label here is reached by the corpus, and that every `trace(...)` call in
 * this file appears here. Add a branch without a case that reaches it and the
 * suite fails, which is the only reason to believe the golden master is
 * pinning the whole function rather than the parts somebody happened to think
 * of.
 */
export const BRANCHES: readonly string[] = [
  'plan:unknown',
  'plan:known',
  'grandfathered:no-legacy-price',
  'grandfathered',
  'price:current',
  'volume:large',
  'volume:medium',
  'volume:none',
  'loyalty:applied',
  'loyalty:none',
  'proration:none',
  'proration:partial',
  'proration:full',
  'credit:none',
  'credit:applied',
  'coupon:percent',
  'coupon:flat',
  'coupon:unknown',
  'coupon:none',
  'tax:unknown-currency',
  'tax:applied',
]

const BASIC_PRICE = 9

const PRICE_BOOK: Record<string, number> = {
  basic: BASIC_PRICE,
  pro: 29,
  enterprise: 99,
}

/** Prices from before the 2019 repricing. Kept for grandfathered accounts. */
const LEGACY_PRICE_BOOK: Record<string, number> = {
  basic: 7,
  pro: 19,
}

const GRANDFATHER_BEFORE = '2019-01-01'

const VOLUME_LARGE_SEATS = 100
const VOLUME_LARGE_RATE = 0.15
const VOLUME_MEDIUM_SEATS = 25
const VOLUME_MEDIUM_RATE = 0.07

const MAX_LOYALTY_YEARS = 5
const LOYALTY_RATE_PER_YEAR = 0.01

const BILLING_PERIOD_DAYS = 30
const MS_PER_DAY = 86_400_000

const PERCENT_COUPON = 'SAVE10'
const PERCENT_COUPON_RATE = 0.1
const FLAT_COUPON = 'WELCOME'
const FLAT_COUPON_AMOUNT = 20

const AUDIT_SAMPLE_RATE = 0.05

const DEFAULT_TAX_RATES: Record<string, number> = {
  USD: 0.0725,
  EUR: 0.2,
  JPY: 0.1,
}

let TAX_RATES: Record<string, number> = { ...DEFAULT_TAX_RATES }

/**
 * Patched at boot by the billing service, and by nothing else — which is why
 * it never occurred to anyone that it is part of this function's input.
 */
export function configureTax(rates: Record<string, number>): void {
  TAX_RATES = { ...TAX_RATES, ...rates }
}

export function resetTax(): void {
  TAX_RATES = { ...DEFAULT_TAX_RATES }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function renewalInvoice(customer: Customer, ambient: Ambient = AMBIENT): Invoice {
  const today = ambient.now()

  let unitPrice = PRICE_BOOK[customer.plan]

  if (unitPrice === undefined) {
    ambient.trace('plan:unknown')
    ambient.warn('unknown plan ' + customer.plan + ', billing at the basic rate')
    unitPrice = BASIC_PRICE
  } else {
    ambient.trace('plan:known')
  }

  if (customer.createdAt < GRANDFATHER_BEFORE) {
    const legacyPrice = LEGACY_PRICE_BOOK[customer.plan]

    if (legacyPrice === undefined) {
      ambient.trace('grandfathered:no-legacy-price')
    } else {
      ambient.trace('grandfathered')
      unitPrice = legacyPrice
    }
  } else {
    ambient.trace('price:current')
  }

  const subtotal = round2(customer.seats * unitPrice)

  let volumeRate = 0

  if (customer.seats > VOLUME_LARGE_SEATS) {
    ambient.trace('volume:large')
    volumeRate = VOLUME_LARGE_RATE
  } else if (customer.seats > VOLUME_MEDIUM_SEATS) {
    ambient.trace('volume:medium')
    volumeRate = VOLUME_MEDIUM_RATE
  } else {
    ambient.trace('volume:none')
  }

  let discounted = round2(subtotal * (1 - volumeRate))

  const loyaltyYears =
    customer.loyaltyYears > MAX_LOYALTY_YEARS ? MAX_LOYALTY_YEARS : customer.loyaltyYears

  if (loyaltyYears > 0) {
    ambient.trace('loyalty:applied')
  } else {
    ambient.trace('loyalty:none')
  }

  discounted = round2(discounted * (1 - loyaltyYears * LOYALTY_RATE_PER_YEAR))

  if (customer.lastInvoicedAt === undefined) {
    ambient.trace('proration:none')
  } else {
    const elapsed = Math.floor((today.getTime() - Date.parse(customer.lastInvoicedAt)) / MS_PER_DAY)

    if (elapsed < BILLING_PERIOD_DAYS) {
      ambient.trace('proration:partial')
      discounted = round2(discounted * (elapsed / BILLING_PERIOD_DAYS))
    } else {
      ambient.trace('proration:full')
    }
  }

  const credit = round2((customer.creditCents === undefined ? 0 : customer.creditCents) / 100)

  if (credit === 0) {
    ambient.trace('credit:none')
  } else {
    ambient.trace('credit:applied')
  }

  let payable = round2(discounted - credit)

  if (customer.coupon === PERCENT_COUPON) {
    ambient.trace('coupon:percent')
    payable = round2(payable * (1 - PERCENT_COUPON_RATE))
  } else if (customer.coupon === FLAT_COUPON) {
    ambient.trace('coupon:flat')
    payable = round2(payable - FLAT_COUPON_AMOUNT)
  } else if (customer.coupon !== undefined && customer.coupon !== '') {
    ambient.trace('coupon:unknown')
    ambient.warn('unknown coupon ' + customer.coupon)
  } else {
    ambient.trace('coupon:none')
  }

  const taxRate = TAX_RATES[customer.currency]
  let tax = 0

  if (taxRate === undefined) {
    ambient.trace('tax:unknown-currency')
    ambient.warn('no tax rate for ' + customer.currency)
  } else {
    ambient.trace('tax:applied')
    tax = Math.trunc(payable * taxRate * 100) / 100
  }

  const total = round2(payable + tax)

  customer.lastInvoicedAt = isoDate(today)

  return {
    customerId: customer.id,
    currency: customer.currency,
    subtotal: subtotal,
    discounted: discounted,
    credit: credit,
    payable: payable,
    tax: tax,
    total: total,
    auditSample: ambient.random() < AUDIT_SAMPLE_RATE,
  }
}
