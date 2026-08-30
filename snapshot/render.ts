/**
 * The subject: one order summary, rendered to HTML.
 *
 * A snapshot policy needs something worth snapshotting, and "worth
 * snapshotting" has a shape. The output has to be *wide* — dozens of facts
 * where an assertion suite would need dozens of `expect` calls — and it has to
 * be the kind of thing where the arrangement is part of the behaviour. Server
 * rendered markup is the canonical example, and it is where rubber-stamping is
 * worst: the diff is long, most of it is punctuation, and a wrong number is
 * three characters in the middle of it.
 *
 * ---------------------------------------------------------------------------
 * Why this file has no imports
 * ---------------------------------------------------------------------------
 * `edits.ts` builds variants of this module by replacing exact strings in the
 * file on disk, writing the result to a temporary directory and importing it,
 * with Node stripping the types on the way in. That works only for a module
 * that stands alone: an import would resolve relative to the temporary
 * directory and fail. So the types are declared here and imported *from* here
 * by everything else, and there is no non-erasable syntax (no enums, no
 * parameter properties, no decorators).
 *
 * `tdd/characterisation/legacy/renewal.ts` is under the same constraint for
 * the same reason. This is the second use of that harness, which is why the
 * loader is written twice rather than shared: the two subjects expose
 * different interfaces, and a shared loader would have to be generic over
 * both to save about fifteen lines.
 *
 * ---------------------------------------------------------------------------
 * `data-field` is a contract, not decoration
 * ---------------------------------------------------------------------------
 * Every value a reader of this summary is meant to *believe* is emitted inside
 * an element carrying `data-field="…"`, with text and nothing else in it. That
 * is what `project.ts` extracts, and it is the load-bearing design decision in
 * this whole directory: a projection can only be stable if the renderer agrees
 * to publish stable handles. Add a number to this markup without a
 * `data-field` and the projected snapshot goes blind to it — `project.test.ts`
 * fails when a field appears here that `FIELDS` does not know about, so the
 * cost of that decision is paid at the point it is made.
 */

/** A currency this renderer knows how to format. */
export type Currency = 'GBP' | 'USD' | 'EUR'

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled'

export interface LineItem {
  readonly sku: string
  readonly name: string
  readonly quantity: number
  /** Unit price in minor units (pence, cents). Integers only — see `money`. */
  readonly unitPence: number
}

export interface Order {
  readonly reference: string
  readonly status: OrderStatus
  readonly currency: Currency
  /** ISO date, fixed by the caller. Nothing here reads a clock. */
  readonly placedOn: string
  readonly customerName: string
  readonly items: readonly LineItem[]
  /** Whole-percent discount applied to the subtotal, 0–100. */
  readonly discountPercent: number
  /** Delivery charge in minor units, before tax. */
  readonly deliveryPence: number
}

const SYMBOLS: Readonly<Record<Currency, string>> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
}

/** VAT-style rate per currency, in whole percent. */
const TAX_PERCENT: Readonly<Record<Currency, number>> = {
  GBP: 20,
  USD: 0,
  EUR: 19,
}

const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  pending: 'Awaiting payment',
  paid: 'Paid',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
}

/**
 * Money is integer minor units throughout, formatted once at the edge.
 *
 * Floating point subtotals are the bug this avoids; they are also a bug a
 * snapshot catches beautifully and an assertion suite catches only where
 * somebody wrote the assertion, which is a point `README.md` makes with a
 * measurement rather than with this comment.
 */
function money(pence: number, currency: Currency): string {
  const sign = pence < 0 ? '-' : ''
  const absolute = Math.abs(pence)
  const major = Math.floor(absolute / 100)
  const minor = absolute % 100

  return `${sign}${SYMBOLS[currency]}${major}.${String(minor).padStart(2, '0')}`
}

/** HTML-escape text that came from outside. Customer names and SKUs qualify. */
function escape(text: string): string {
  return text
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;')
}

function field(name: string, value: string): string {
  return `<span data-field="${name}">${value}</span>`
}

export interface Totals {
  readonly subtotalPence: number
  readonly discountPence: number
  readonly deliveryPence: number
  readonly taxPence: number
  readonly totalPence: number
}

/**
 * The arithmetic, separated from the markup so it can be asserted directly.
 *
 * Order of operations: discount comes off the subtotal, delivery is added
 * after the discount (so a discount never reduces the delivery charge), and
 * tax applies to the discounted goods *and* the delivery. Rounding is
 * half-up at each step, on integers, once.
 */
export function totalsFor(order: Order): Totals {
  const subtotalPence = order.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPence,
    0,
  )

  const discountPence = Math.round((subtotalPence * order.discountPercent) / 100)
  const taxable = subtotalPence - discountPence + order.deliveryPence
  const taxPence = Math.round((taxable * TAX_PERCENT[order.currency]) / 100)

  return {
    subtotalPence,
    discountPence,
    deliveryPence: order.deliveryPence,
    taxPence,
    totalPence: taxable + taxPence,
  }
}

function renderItem(item: LineItem, currency: Currency): string {
  const linePence = item.quantity * item.unitPence

  return [
    '      <tr class="item">',
    `        <td class="item__sku"><code>${escape(item.sku)}</code></td>`,
    `        <td class="item__name">${escape(item.name)}</td>`,
    `        <td class="item__quantity">${field(`item.${item.sku}.quantity`, String(item.quantity))}</td>`,
    `        <td class="item__unit">${field(`item.${item.sku}.unit`, money(item.unitPence, currency))}</td>`,
    `        <td class="item__line">${field(`item.${item.sku}.line`, money(linePence, currency))}</td>`,
    '      </tr>',
  ].join('\n')
}

/**
 * Render the summary.
 *
 * Deterministic by construction: every value comes from `order`, there is no
 * clock, no locale lookup and no randomness. That is a precondition for
 * snapshotting anything at all — `policy.ts` treats a snapshot containing a
 * date or an id as a violation precisely because a snapshot that changes on
 * its own is the fastest way to train a team to run `-u` without reading.
 */
export function renderOrderSummary(order: Order): string {
  const totals = totalsFor(order)
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const plural = itemCount === 1 ? 'item' : 'items'

  const lines: string[] = []

  lines.push(`<section class="order" aria-label="Order ${escape(order.reference)}">`)
  lines.push('  <header class="order__header">')
  lines.push(`    <h2 class="order__reference">${field('reference', escape(order.reference))}</h2>`)
  lines.push(
    `    <p class="order__customer">Order for <b>${field('customer', escape(order.customerName))}</b></p>`,
  )
  lines.push(`    <p class="order__placed">Placed ${field('placedOn', order.placedOn)}</p>`)
  lines.push(
    `    <span class="badge badge--${order.status}" role="status">${field('status', STATUS_LABELS[order.status])}</span>`,
  )
  lines.push('  </header>')

  if (order.items.length === 0) {
    lines.push('  <p class="order__empty">This order has no items.</p>')
  } else {
    lines.push('  <table class="order__items">')
    lines.push('    <caption>')
    lines.push(`      ${field('itemCount', `${itemCount} ${plural}`)}`)
    lines.push('    </caption>')
    lines.push('    <tbody>')

    for (const item of order.items) {
      lines.push(renderItem(item, order.currency))
    }

    lines.push('    </tbody>')
    lines.push('  </table>')
  }

  lines.push('  <dl class="order__totals">')
  lines.push('    <dt>Subtotal</dt>')
  lines.push(`    <dd>${field('subtotal', money(totals.subtotalPence, order.currency))}</dd>`)

  if (order.discountPercent > 0) {
    lines.push(`    <dt>Discount (${order.discountPercent}%)</dt>`)
    lines.push(`    <dd>${field('discount', money(-totals.discountPence, order.currency))}</dd>`)
  }

  lines.push('    <dt>Delivery</dt>')
  lines.push(`    <dd>${field('delivery', money(totals.deliveryPence, order.currency))}</dd>`)
  lines.push(`    <dt>Tax (${TAX_PERCENT[order.currency]}%)</dt>`)
  lines.push(`    <dd>${field('tax', money(totals.taxPence, order.currency))}</dd>`)
  lines.push('    <dt class="order__total-label">Total</dt>')
  lines.push(`    <dd class="order__total">${field('total', money(totals.totalPence, order.currency))}</dd>`)
  lines.push('  </dl>')
  lines.push('</section>')

  return lines.join('\n')
}
