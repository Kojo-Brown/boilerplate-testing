/**
 * Three ways to hold `render.ts` to account, run against the same corpus.
 *
 *   full        — snapshot the whole rendered markup.
 *   projected   — snapshot `project(html)`: the published fields, in order.
 *   assertions  — fourteen hand-written expectations about the output.
 *
 * The probes live here, apart from the test files, for the reason
 * `tdd/doubles/probes.ts` gives: the code a reader sees demonstrating each
 * technique should be the code the measurement is taken from. `full.test.ts`,
 * `projected.test.ts` and `assertions.test.ts` are the same three techniques
 * written the way a person would write them, against the real module;
 * `detection.test.ts` runs the definitions below against sixteen variants of
 * it. If the two drifted apart, the README would be describing a suite nobody
 * ships.
 *
 * ---------------------------------------------------------------------------
 * Baselines are recorded, not committed
 * ---------------------------------------------------------------------------
 * The two snapshot probes need something to compare against. They take it from
 * the control — the unedited source through the same compile-and-import
 * pipeline — recorded at the start of the run. A committed baseline would be a
 * second copy of the expected output that has to be maintained, and it would
 * make "the probe went red" ambiguous between a real difference and a stale
 * file. Recording it means the only thing a probe can report is *this variant
 * differs from the current source*, which is exactly what a snapshot
 * comparison is.
 *
 * The committed snapshots — the ones a policy is needed for — are in the three
 * demonstration suites, and `check.ts` governs those.
 */

import { CANCELLED, CORPUS, DISCOUNTED, EMPTY, STANDARD } from './orders.ts'
import { projectionLines } from './project.ts'
import type { Renderer } from './load.ts'

export const PROBE_IDS = ['full', 'projected', 'assertions'] as const

export type ProbeId = (typeof PROBE_IDS)[number]

/** What the control renders, keyed by order reference. */
export interface Baseline {
  readonly full: ReadonlyMap<string, string>
  readonly projected: ReadonlyMap<string, string>
}

export function record(render: Renderer): Baseline {
  const full = new Map<string, string>()
  const projected = new Map<string, string>()

  for (const order of CORPUS) {
    const html = render(order)

    full.set(order.reference, html)
    projected.set(order.reference, projectionLines(html).join('\n'))
  }

  return { full, projected }
}

// ---------------------------------------------------------------------------
// The hand-written assertions
// ---------------------------------------------------------------------------
/**
 * One expectation about the rendered output.
 *
 * These were written against the correct implementation, from the description
 * of what the summary is for — before the variants in `edits.ts` existed. That
 * ordering is the whole reason the comparison is worth anything: assertions
 * written after seeing the faults would catch the faults, and would say
 * nothing about what an assertion suite catches in practice.
 */
export interface Assertion {
  readonly id: string
  readonly holds: (render: Renderer) => boolean
}

const money = /^-?[£$€]\d+\.\d{2}$/

export const ASSERTIONS: readonly Assertion[] = [
  {
    id: 'shows the order reference as the heading',
    holds: (render) => render(STANDARD).includes('<span data-field="reference">ORD-1042</span>'),
  },
  {
    id: 'escapes HTML in the customer name',
    holds: (render) => render(DISCOUNTED).includes('Beaumont &amp; Fletcher'),
  },
  {
    id: 'labels each status in words',
    holds: (render) =>
      render(STANDARD).includes('>Paid<') &&
      render(DISCOUNTED).includes('>Shipped<') &&
      render(CANCELLED).includes('>Cancelled<') &&
      render(EMPTY).includes('>Awaiting payment<'),
  },
  {
    id: 'gives the badge a modifier class per status',
    holds: (render) =>
      render(STANDARD).includes('badge--paid') &&
      render(CANCELLED).includes('badge--cancelled') &&
      render(EMPTY).includes('badge--pending'),
  },
  {
    id: 'names the region for assistive technology',
    holds: (render) => render(STANDARD).includes('aria-label="Order ORD-1042"'),
  },
  {
    id: 'counts items in the caption, pluralised',
    holds: (render) =>
      render(STANDARD).includes('>3 items<') && render(CANCELLED).includes('>1 item<'),
  },
  {
    id: 'multiplies quantity by unit price for a line total',
    holds: (render) =>
      render(STANDARD).includes('<span data-field="item.MAT-07.line">£69.00</span>'),
  },
  {
    id: 'sums the line totals into the subtotal',
    holds: (render) => render(STANDARD).includes('<span data-field="subtotal">£489.00</span>'),
  },
  {
    id: 'adds delivery and tax into the total',
    holds: (render) => render(STANDARD).includes('<span data-field="total">£598.74</span>'),
  },
  {
    id: 'shows a discount line only when there is a discount',
    holds: (render) =>
      render(DISCOUNTED).includes('data-field="discount"') &&
      !render(STANDARD).includes('data-field="discount"'),
  },
  {
    id: 'renders the discount as a negative amount',
    holds: (render) => /<span data-field="discount">-/.test(render(DISCOUNTED)),
  },
  {
    id: 'replaces the table with a message when there are no items',
    holds: (render) =>
      render(EMPTY).includes('This order has no items.') && !render(EMPTY).includes('<table'),
  },
  {
    id: 'applies the tax rate of the order currency',
    holds: (render) =>
      render(STANDARD).includes('<span data-field="tax">£99.79</span>') &&
      render(CANCELLED).includes('<span data-field="tax">$0.00</span>'),
  },
  {
    id: 'formats every amount to two decimal places',
    holds: (render) =>
      CORPUS.every((order) =>
        [...render(order).matchAll(/<span data-field="[^"]*(?:subtotal|discount|delivery|tax|total|unit|line)">([^<]*)<\/span>/g)].every(
          (match) => money.test(match[1] ?? ''),
        ),
      ),
  },
]

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------
export interface Probe {
  readonly id: ProbeId
  /** How this probe is described in the README's table. */
  readonly description: string
  /** True when this probe would fail against `render`. */
  readonly red: (render: Renderer, baseline: Baseline) => boolean
}

/** Order references whose rendered markup differs from the baseline. */
export function differingOrders(render: Renderer, baseline: Baseline): string[] {
  return CORPUS.filter((order) => render(order) !== baseline.full.get(order.reference)).map(
    (order) => order.reference,
  )
}

export const PROBES: readonly Probe[] = [
  {
    id: 'full',
    description: 'snapshot of the whole rendered markup',
    red: (render, baseline) =>
      CORPUS.some((order) => render(order) !== baseline.full.get(order.reference)),
  },
  {
    id: 'projected',
    description: 'snapshot of the published fields, in document order',
    red: (render, baseline) =>
      CORPUS.some(
        (order) =>
          projectionLines(render(order)).join('\n') !== baseline.projected.get(order.reference),
      ),
  },
  {
    id: 'assertions',
    description: 'fourteen hand-written expectations',
    red: (render) => ASSERTIONS.some((assertion) => !assertion.holds(render)),
  },
]

export function probeNamed(id: ProbeId): Probe {
  const probe = PROBES.find((candidate) => candidate.id === id)

  if (probe === undefined) {
    throw new Error(`no probe named ${id}`)
  }

  return probe
}

/** Which of the fourteen assertions fail against `render`. */
export function failingAssertions(render: Renderer): string[] {
  return ASSERTIONS.filter((assertion) => !assertion.holds(render)).map(
    (assertion) => assertion.id,
  )
}
