/**
 * What "the behaviour" of the legacy function actually is.
 *
 * The return value is the obvious part and about half of it. A call also
 * writes to the console, and it writes a date back onto the customer object it
 * was handed — a side effect nobody documented and at least one caller depends
 * on. A characterisation suite that watches only the return value would let a
 * refactor drop that write silently, which is measured rather than asserted:
 * `detection.test.ts` runs a return-value-only observer alongside this one and
 * reports what it misses.
 *
 * `branches` is the fourth field and the odd one out. It is not behaviour a
 * caller can see; it is the sensing seam, used by `corpus.test.ts` to state
 * which paths the corpus reaches. Comparisons between two *implementations*
 * therefore leave it out — a refactor is allowed to restructure its branches,
 * and demanding otherwise would forbid the thing the pins exist to permit.
 */

import type { Ambient, Customer, Invoice } from './legacy/renewal'
import type { Case } from './corpus'

/**
 * Any implementation of renewal invoicing: the legacy one, the refactored one,
 * or one of the mutants compiled from legacy source.
 *
 * The two tax functions are part of the interface because the tax table is
 * module-level mutable state. A subject that could not be reset would leak
 * one case's configuration into the next.
 */
export type Subject = {
  renewalInvoice: (customer: Customer, ambient: Ambient) => Invoice
  configureTax: (rates: Record<string, number>) => void
  resetTax: () => void
}

export type Observation = {
  readonly invoice: Invoice
  readonly customerAfter: Customer
  readonly warnings: readonly string[]
  readonly branches: readonly string[]
}

/**
 * The one thing the recording format cannot carry: negative zero.
 *
 * Prorating a zero-seat invoice by a negative fraction produces `-0`, and JSON
 * has no way to write it down — `JSON.stringify(-0)` is `"0"`, so a recording
 * round-trips it into an ordinary zero and every comparison afterwards
 * disagrees with the live call. Choosing the recording format therefore
 * chooses what the pins can distinguish, which is worth knowing before the
 * format is chosen rather than after.
 *
 * Normalising here rather than fixing the arithmetic is deliberate on both
 * counts. The legacy behaviour is left alone, and the limitation is admitted
 * in one place instead of being smuggled in wherever a comparison happens.
 * The cost is stated: these pins do not distinguish `-0` from `0`. For money
 * that is the right trade — `(-0).toFixed(2)` is `'0.00'` and `String(-0)` is
 * `'0'`, so no invoice, ledger line or API response can tell them apart
 * either. For a subject where `1 / x` mattered, it would be the wrong one, and
 * the format would have to change.
 */
function withoutNegativeZero(invoice: Invoice): Invoice {
  const normalised: Record<string, unknown> = { ...invoice }

  for (const [key, value] of Object.entries(normalised)) {
    if (typeof value === 'number' && Object.is(value, -0)) {
      normalised[key] = 0
    }
  }

  return normalised as unknown as Invoice
}

export function observe(subject: Subject, testCase: Case): Observation {
  subject.resetTax()

  if (testCase.tax !== null) {
    subject.configureTax(testCase.tax)
  }

  const warnings: string[] = []
  const branches: string[] = []
  const customer = structuredClone(testCase.customer)

  const ambient: Ambient = {
    now: () => new Date(testCase.nowIso),
    random: () => testCase.randomValue,
    warn: (message) => {
      warnings.push(message)
    },
    trace: (branch) => {
      branches.push(branch)
    },
  }

  const invoice = subject.renewalInvoice(customer, ambient)

  subject.resetTax()

  return { invoice: withoutNegativeZero(invoice), customerAfter: customer, warnings, branches }
}

export function observeAll(
  subject: Subject,
  cases: readonly Case[],
): Record<string, Observation> {
  const observations: Record<string, Observation> = {}

  for (const testCase of cases) {
    observations[testCase.id] = observe(subject, testCase)
  }

  return observations
}

/** Everything a caller can see, which is everything except the sensing seam. */
export type VisibleBehaviour = Omit<Observation, 'branches'>

export function visible(observation: Observation): VisibleBehaviour {
  return {
    invoice: observation.invoice,
    customerAfter: observation.customerAfter,
    warnings: observation.warnings,
  }
}

/** The narrower view: the returned invoice, and nothing else. */
export function returnedInvoice(observation: Observation): Invoice {
  return observation.invoice
}
