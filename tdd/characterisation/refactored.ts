/**
 * The same invoicing, restructured — and identical, quirks included.
 *
 * This is what the pins were for. `equivalence.test.ts` runs both
 * implementations over all 128 corpus cases and compares every visible effect,
 * so the claim being made here is not "this looks better" but "this is the
 * same function". The two are not compared on `branches`: a refactor is
 * allowed to have different branches, and that is most of the point.
 *
 * ---------------------------------------------------------------------------
 * What was deliberately *not* changed
 * ---------------------------------------------------------------------------
 * Every oddity `divergences.ts` records is still here, on purpose:
 *
 *   - the volume tiers are still exclusive (`> 100`, not `>= 100`);
 *   - loyalty still compounds onto the volume-discounted figure;
 *   - the credit is still deducted before the coupon;
 *   - the total is still allowed to go negative;
 *   - grandfathering still compares ISO dates as strings;
 *   - tax is still truncated toward zero rather than rounded.
 *
 * A refactoring commit that fixed any of those would be a behaviour change
 * wearing a refactor's clothes, and the only reason the pins can be trusted as
 * a safety net is that they are never edited in the same breath as the code.
 * Each one is now a decision somebody can take separately, with a test that
 * will tell them exactly who it moves — which is the deliverable of a
 * characterisation exercise, more than the tidier code is.
 *
 * The rounding is the part to read carefully. `round2` is applied at exactly
 * the same six points as in the legacy function, because rounding is not
 * associative: folding two of those calls into one changes real invoices by a
 * cent, and a cent is the kind of difference that reaches a customer without
 * reaching a test.
 */

import type { Ambient, Customer, Invoice } from './legacy/renewal'

const BASIC_PRICE = 9

const PRICE_BOOK: Record<string, number> = {
  basic: BASIC_PRICE,
  pro: 29,
  enterprise: 99,
}

const LEGACY_PRICE_BOOK: Record<string, number> = {
  basic: 7,
  pro: 19,
}

const GRANDFATHER_BEFORE = '2019-01-01'

/** Ordered by seat count, descending; the first match wins. */
const VOLUME_TIERS: readonly { readonly overSeats: number; readonly rate: number }[] = [
  { overSeats: 100, rate: 0.15 },
  { overSeats: 25, rate: 0.07 },
]

const MAX_LOYALTY_YEARS = 5
const LOYALTY_RATE_PER_YEAR = 0.01

const BILLING_PERIOD_DAYS = 30
const MS_PER_DAY = 86_400_000

const COUPONS: Record<string, (payable: number) => number> = {
  SAVE10: (payable) => round2(payable * (1 - 0.1)),
  WELCOME: (payable) => round2(payable - 20),
}

const AUDIT_SAMPLE_RATE = 0.05

const DEFAULT_TAX_RATES: Record<string, number> = {
  USD: 0.0725,
  EUR: 0.2,
  JPY: 0.1,
}

let taxRates: Record<string, number> = { ...DEFAULT_TAX_RATES }

export function configureTax(rates: Record<string, number>): void {
  taxRates = { ...taxRates, ...rates }
}

export function resetTax(): void {
  taxRates = { ...DEFAULT_TAX_RATES }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * List price, or the pre-2019 price for an account old enough to keep it.
 *
 * The date comparison is lexicographic, exactly as inherited. It gives the
 * right answer for ISO dates and an arbitrary one for anything else, and
 * `divergences.ts` records which customers that reaches.
 */
function unitPriceFor(customer: Customer, warn: (message: string) => void): number {
  const listed = PRICE_BOOK[customer.plan]
  let price = listed

  if (price === undefined) {
    warn('unknown plan ' + customer.plan + ', billing at the basic rate')
    price = BASIC_PRICE
  }

  if (customer.createdAt < GRANDFATHER_BEFORE) {
    const grandfathered = LEGACY_PRICE_BOOK[customer.plan]

    if (grandfathered !== undefined) {
      return grandfathered
    }
  }

  return price
}

function volumeRateFor(seats: number): number {
  return VOLUME_TIERS.find((tier) => seats > tier.overSeats)?.rate ?? 0
}

function loyaltyRateFor(years: number): number {
  return Math.min(years, MAX_LOYALTY_YEARS) * LOYALTY_RATE_PER_YEAR
}

/**
 * The fraction of a billing period being charged for.
 *
 * Anything that is not a renewal inside the period bills in full, and that
 * includes the two cases the original reached by accident: an unparseable date
 * (`NaN < 30` is false) and a renewal date in the future (which prorates to a
 * negative fraction, and so to a negative invoice).
 */
function prorationFactor(customer: Customer, today: Date): number {
  if (customer.lastInvoicedAt === undefined) {
    return 1
  }

  const elapsedDays = Math.floor((today.getTime() - Date.parse(customer.lastInvoicedAt)) / MS_PER_DAY)

  return elapsedDays < BILLING_PERIOD_DAYS ? elapsedDays / BILLING_PERIOD_DAYS : 1
}

function applyCoupon(payable: number, coupon: string | undefined, warn: (message: string) => void): number {
  if (coupon === undefined || coupon === '') {
    return payable
  }

  const apply = COUPONS[coupon]

  if (apply === undefined) {
    warn('unknown coupon ' + coupon)
    return payable
  }

  return apply(payable)
}

function taxOn(payable: number, currency: string, warn: (message: string) => void): number {
  const rate = taxRates[currency]

  if (rate === undefined) {
    warn('no tax rate for ' + currency)
    return 0
  }

  // Truncation, not rounding: tax is rounded down toward zero, and on a
  // negative invoice that means toward zero from below.
  return Math.trunc(payable * rate * 100) / 100
}

export function renewalInvoice(customer: Customer, ambient: Ambient): Invoice {
  const today = ambient.now()
  const warn = ambient.warn

  const subtotal = round2(customer.seats * unitPriceFor(customer, warn))
  const afterVolume = round2(subtotal * (1 - volumeRateFor(customer.seats)))
  const afterLoyalty = round2(afterVolume * (1 - loyaltyRateFor(customer.loyaltyYears)))
  const discounted = round2(afterLoyalty * prorationFactor(customer, today))

  const credit = round2((customer.creditCents ?? 0) / 100)
  const payable = applyCoupon(round2(discounted - credit), customer.coupon, warn)

  const tax = taxOn(payable, customer.currency, warn)

  // Still writes back to the caller's object. Removing this would be the one
  // change here nobody would notice in review and every caller would notice
  // in production.
  customer.lastInvoicedAt = today.toISOString().slice(0, 10)

  return {
    customerId: customer.id,
    currency: customer.currency,
    subtotal,
    discounted,
    credit,
    payable,
    tax,
    total: round2(payable + tax),
    auditSample: ambient.random() < AUDIT_SAMPLE_RATE,
  }
}
