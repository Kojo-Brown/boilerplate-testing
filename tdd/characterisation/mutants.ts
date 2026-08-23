/**
 * Ten ways the refactor could have gone wrong, applied to the real source.
 *
 * The question a characterisation suite has to answer is not "does it pass"
 * but "what would it have caught". These are the answer's inputs: ten single
 * behaviour changes, each one a thing a competent engineer might plausibly do
 * while tidying `legacy/renewal.ts` — six of them are the code finally
 * agreeing with its own documentation, which is exactly why they are dangerous.
 *
 * ---------------------------------------------------------------------------
 * Why the source text, and not a wrapper
 * ---------------------------------------------------------------------------
 * `tdd/doubles/faults.ts` builds its broken systems by wrapping collaborators,
 * because a use case with seams has somewhere to inject a bug. This function
 * has almost no seams — that is what makes it legacy — and its bugs live in the
 * middle of an eighty-line body. Wrapping cannot reach them, and keeping ten
 * edited copies of the function would rot the first time the original changed.
 *
 * So each mutant is a set of exact string replacements against the file on
 * disk, each of which must match exactly once. The result is written to a
 * temporary directory and imported, with Node stripping the types on the way
 * in — which is why `legacy/renewal.ts` has no imports and no non-erasable
 * syntax. Edit the legacy source in a way that breaks a replacement and the
 * suite fails loudly rather than quietly testing nothing, because "matched
 * once" is asserted, not hoped for.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { Subject } from './observe'

export const MUTANT_IDS = [
  'VOLUME_TIER_INCLUSIVE',
  'LOYALTY_SUMMED_NOT_COMPOUNDED',
  'COUPON_BEFORE_CREDIT',
  'TAX_ROUNDED_NOT_TRUNCATED',
  'TOTAL_FLOORED_AT_ZERO',
  'NO_WRITE_BACK_TO_CUSTOMER',
  'COUPON_CASE_INSENSITIVE',
  'GRANDFATHERING_BY_PARSED_DATE',
  'WARNS_ON_EMPTY_COUPON',
  'PRORATION_IGNORES_FUTURE_DATES',
] as const

export type MutantId = (typeof MUTANT_IDS)[number]

type Edit = {
  readonly from: string
  readonly to: string
}

export type Mutant = {
  readonly id: MutantId
  /** One line, as the change would be described in a pull request. */
  readonly description: string
  /** True when the change is the code being made to agree with `requirements.md`. */
  readonly matchesTheDocs: boolean
  readonly edits: readonly Edit[]
}

export const MUTANTS: readonly Mutant[] = [
  {
    id: 'VOLUME_TIER_INCLUSIVE',
    description: 'the large-volume tier starts at 100 seats rather than above it',
    matchesTheDocs: true,
    edits: [
      {
        from: 'if (customer.seats > VOLUME_LARGE_SEATS) {',
        to: 'if (customer.seats >= VOLUME_LARGE_SEATS) {',
      },
    ],
  },
  {
    id: 'LOYALTY_SUMMED_NOT_COMPOUNDED',
    description: 'volume and loyalty discounts are added together and applied once',
    matchesTheDocs: true,
    edits: [
      {
        from: 'discounted = round2(discounted * (1 - loyaltyYears * LOYALTY_RATE_PER_YEAR))',
        to: 'discounted = round2(subtotal * (1 - volumeRate - loyaltyYears * LOYALTY_RATE_PER_YEAR))',
      },
    ],
  },
  {
    id: 'COUPON_BEFORE_CREDIT',
    description: 'the coupon is applied first and the account credit deducted afterwards',
    matchesTheDocs: true,
    edits: [
      { from: 'let payable = round2(discounted - credit)', to: 'let payable = discounted' },
      {
        from: '  const taxRate = TAX_RATES[customer.currency]',
        to: '  payable = round2(payable - credit)\n\n  const taxRate = TAX_RATES[customer.currency]',
      },
    ],
  },
  {
    id: 'TAX_ROUNDED_NOT_TRUNCATED',
    description: 'tax is rounded to the nearest cent instead of truncated',
    matchesTheDocs: false,
    edits: [
      {
        from: 'tax = Math.trunc(payable * taxRate * 100) / 100',
        to: 'tax = Math.round(payable * taxRate * 100) / 100',
      },
    ],
  },
  {
    id: 'TOTAL_FLOORED_AT_ZERO',
    description: 'an invoice total can no longer be negative',
    matchesTheDocs: true,
    edits: [
      {
        from: 'const total = round2(payable + tax)',
        to: 'const total = Math.max(0, round2(payable + tax))',
      },
    ],
  },
  {
    id: 'NO_WRITE_BACK_TO_CUSTOMER',
    description: 'the function stops writing the billing date onto its argument',
    matchesTheDocs: false,
    edits: [{ from: '  customer.lastInvoicedAt = isoDate(today)\n', to: '' }],
  },
  {
    id: 'COUPON_CASE_INSENSITIVE',
    description: 'coupon codes are matched without regard to case',
    matchesTheDocs: false,
    edits: [
      {
        from: 'if (customer.coupon === PERCENT_COUPON) {',
        to: 'if (customer.coupon?.toUpperCase() === PERCENT_COUPON) {',
      },
      {
        from: '} else if (customer.coupon === FLAT_COUPON) {',
        to: '} else if (customer.coupon?.toUpperCase() === FLAT_COUPON) {',
      },
    ],
  },
  {
    id: 'GRANDFATHERING_BY_PARSED_DATE',
    description: 'the grandfathering cut-off compares parsed dates rather than strings',
    matchesTheDocs: true,
    edits: [
      {
        from: 'if (customer.createdAt < GRANDFATHER_BEFORE) {',
        to: 'if (Date.parse(customer.createdAt) < Date.parse(GRANDFATHER_BEFORE)) {',
      },
    ],
  },
  {
    id: 'WARNS_ON_EMPTY_COUPON',
    description: 'an empty coupon code is reported as unrecognised instead of ignored',
    matchesTheDocs: false,
    edits: [
      {
        from: "} else if (customer.coupon !== undefined && customer.coupon !== '') {",
        to: '} else if (customer.coupon !== undefined) {',
      },
    ],
  },
  {
    id: 'PRORATION_IGNORES_FUTURE_DATES',
    description: 'a renewal dated in the future bills in full instead of prorating below zero',
    matchesTheDocs: true,
    edits: [
      {
        from: 'if (elapsed < BILLING_PERIOD_DAYS) {',
        to: 'if (elapsed > 0 && elapsed < BILLING_PERIOD_DAYS) {',
      },
    ],
  },
]

export function mutantNamed(id: MutantId): Mutant {
  const mutant = MUTANTS.find((candidate) => candidate.id === id)

  if (mutant === undefined) {
    throw new Error(`no mutant named ${id}`)
  }

  return mutant
}

const LEGACY_SOURCE_PATH = fileURLToPath(new URL('./legacy/renewal.ts', import.meta.url))

export function legacySource(): string {
  return readFileSync(LEGACY_SOURCE_PATH, 'utf8')
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  let mutated = source

  for (const edit of edits) {
    const occurrences = mutated.split(edit.from).length - 1

    if (occurrences !== 1) {
      throw new Error(
        `expected exactly one occurrence of ${JSON.stringify(edit.from)} in the legacy source, found ${occurrences}`,
      )
    }

    mutated = mutated.replace(edit.from, edit.to)
  }

  return mutated
}

function isSubject(value: unknown): value is Subject {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.renewalInvoice === 'function' &&
    typeof candidate.configureTax === 'function' &&
    typeof candidate.resetTax === 'function'
  )
}

const compiled = new Map<string, Promise<Subject>>()

/**
 * Compile a variant of the legacy module and load it.
 *
 * `@vite-ignore` matters: without it Vitest rewrites the dynamic import at
 * transform time and never reaches the generated file. With it the import goes
 * to Node, which strips the types itself.
 */
function load(key: string, source: string): Promise<Subject> {
  const existing = compiled.get(key)

  if (existing !== undefined) {
    return existing
  }

  const pending = (async (): Promise<Subject> => {
    const directory = mkdtempSync(join(tmpdir(), 'characterisation-'))
    const file = join(directory, 'renewal.ts')

    writeFileSync(file, source)

    const loaded: unknown = await import(/* @vite-ignore */ pathToFileURL(file).href)

    if (!isSubject(loaded)) {
      throw new Error(`compiled module ${key} does not expose the renewal interface`)
    }

    return loaded
  })()

  compiled.set(key, pending)

  return pending
}

/**
 * The control: the legacy source compiled through the same pipeline, unedited.
 *
 * Every mutant is loaded this way, so if the pipeline itself changed behaviour
 * — a stripped type that was load-bearing, a stale temporary file — every
 * mutant would look like it was caught and the matrix would be worthless.
 * `detection.test.ts` runs this against the golden master first.
 */
export function loadUnmutated(): Promise<Subject> {
  return load('control', legacySource())
}

export function loadMutant(id: MutantId): Promise<Subject> {
  return load(id, applyEdits(legacySource(), mutantNamed(id).edits))
}
