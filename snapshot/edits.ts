/**
 * Sixteen changes to `render.ts`: ten bugs and six refactors.
 *
 * ---------------------------------------------------------------------------
 * Why both kinds
 * ---------------------------------------------------------------------------
 * Every comparison of snapshot testing against hand-written assertions that
 * only injects *bugs* reaches the same answer, and it flatters snapshots: an
 * assertion on the whole output catches everything, so of course it wins. That
 * measurement is real but it is half the story, and it is the half that does
 * not explain why snapshot suites decay.
 *
 * The other half is the false alarm. A snapshot over raw markup fails on
 * changes that broke nothing — an added wrapper, a renamed class, a re-indent
 * — and each of those trains the reviewer that a red snapshot means "run
 * `-u`". After enough of them the update is reflex, and the next red snapshot,
 * the one that *is* a bug, is updated with the same keystroke. Rubber-stamping
 * is not laziness; it is the rational response to a signal that is mostly
 * noise.
 *
 * So the corpus has both, and the headline number in `README.md` is not the
 * detection rate. It is the **signal rate**: of the times a probe goes red,
 * what fraction is a real defect. That is the quantity a reviewer's habit
 * actually forms around.
 *
 * ---------------------------------------------------------------------------
 * Why edits to the real source
 * ---------------------------------------------------------------------------
 * The same reason `tdd/characterisation/mutants.ts` does it: a copy of the
 * subject rots the first time the original changes, and a wrapper cannot reach
 * inside a rendering function. Each edit must match exactly once in the file
 * on disk, which is asserted rather than hoped for, so an edit to `render.ts`
 * that invalidates one of these fails the suite loudly instead of quietly
 * measuring nothing.
 *
 * ---------------------------------------------------------------------------
 * What makes an edit "noise"
 * ---------------------------------------------------------------------------
 * A judgement, and it should be read as one. `noise` means the rendered page
 * carries the same information to a reader and to a screen reader: the values
 * are identical, the order is identical, the roles and labels are identical.
 * It does *not* mean "the projection ignores it" — that would make the
 * measurement circular, since the projection is one of the things being
 * measured. `NOISE_IS_INVISIBLE` in `detection.test.ts` is where the judgement
 * is checked against something independent: every noise edit must leave the
 * hand-written assertion suite silent too, and that suite was written before
 * these edits existed.
 */

export const VARIANT_IDS = [
  // ---- bugs -------------------------------------------------------------
  'DISCOUNT_INCLUDES_DELIVERY',
  'TAX_TRUNCATED',
  'MINOR_UNITS_UNPADDED',
  'PLURAL_INVERTED',
  'CANCELLED_LABEL_CHANGED',
  'CUSTOMER_NAME_UNESCAPED',
  'NEGATIVE_SIGN_DROPPED',
  'LINE_TOTAL_IGNORES_QUANTITY',
  'BADGE_MODIFIER_DROPPED',
  'ARIA_LABEL_DROPPED',
  // ---- noise ------------------------------------------------------------
  'WRAPPER_DIV_ADDED',
  'HEADER_CLASS_RENAMED',
  'BOLD_TAG_MODERNISED',
  'TEST_ID_ADDED',
  'ITEM_ROWS_REINDENTED',
  'BADGE_ATTRIBUTES_REORDERED',
] as const

export type VariantId = (typeof VARIANT_IDS)[number]

/** Whether a change is a defect or a refactor that broke nothing. */
export type VariantKind = 'bug' | 'noise'

interface Edit {
  readonly from: string
  readonly to: string
}

export interface Variant {
  readonly id: VariantId
  readonly kind: VariantKind
  /** One line, as it would be described in a pull request. */
  readonly description: string
  readonly edits: readonly Edit[]
}

export const VARIANTS: readonly Variant[] = [
  // ---------------------------------------------------------------------
  // Bugs
  // ---------------------------------------------------------------------
  {
    id: 'DISCOUNT_INCLUDES_DELIVERY',
    kind: 'bug',
    description: 'the percentage discount is taken off delivery as well as the goods',
    edits: [
      {
        from: 'const discountPence = Math.round((subtotalPence * order.discountPercent) / 100)',
        to: 'const discountPence = Math.round(\n    ((subtotalPence + order.deliveryPence) * order.discountPercent) / 100,\n  )',
      },
    ],
  },
  {
    id: 'TAX_TRUNCATED',
    kind: 'bug',
    description: 'tax is truncated to the penny instead of rounded',
    edits: [
      {
        from: 'const taxPence = Math.round((taxable * TAX_PERCENT[order.currency]) / 100)',
        to: 'const taxPence = Math.floor((taxable * TAX_PERCENT[order.currency]) / 100)',
      },
    ],
  },
  {
    id: 'MINOR_UNITS_UNPADDED',
    kind: 'bug',
    description: 'money loses its trailing zero — £34.50 renders as £34.5',
    edits: [
      {
        from: "return `${sign}${SYMBOLS[currency]}${major}.${String(minor).padStart(2, '0')}`",
        to: 'return `${sign}${SYMBOLS[currency]}${major}.${String(minor)}`',
      },
    ],
  },
  {
    id: 'PLURAL_INVERTED',
    kind: 'bug',
    description: 'the item-count caption pluralises the wrong way round',
    edits: [
      {
        from: "const plural = itemCount === 1 ? 'item' : 'items'",
        to: "const plural = itemCount === 1 ? 'items' : 'item'",
      },
    ],
  },
  {
    id: 'CANCELLED_LABEL_CHANGED',
    kind: 'bug',
    description: 'a cancelled order is labelled "Refunded", which is a different thing',
    edits: [{ from: "cancelled: 'Cancelled',", to: "cancelled: 'Refunded'," }],
  },
  {
    id: 'CUSTOMER_NAME_UNESCAPED',
    kind: 'bug',
    description: 'the customer name is interpolated without HTML escaping',
    edits: [
      {
        from: "`    <p class=\"order__customer\">Order for <b>${field('customer', escape(order.customerName))}</b></p>`",
        to: "`    <p class=\"order__customer\">Order for <b>${field('customer', order.customerName)}</b></p>`",
      },
    ],
  },
  {
    id: 'NEGATIVE_SIGN_DROPPED',
    kind: 'bug',
    description: 'negative amounts lose their minus sign, so a discount reads as a charge',
    edits: [{ from: "const sign = pence < 0 ? '-' : ''", to: "const sign = ''" }],
  },
  {
    id: 'LINE_TOTAL_IGNORES_QUANTITY',
    kind: 'bug',
    description: 'a line total is the unit price, whatever the quantity',
    edits: [
      {
        from: 'const linePence = item.quantity * item.unitPence',
        to: 'const linePence = item.unitPence',
      },
    ],
  },
  {
    // The first of the two the projection cannot see. The badge keeps its
    // text, so every value in the projection is unchanged; what is gone is the
    // modifier class that colours a cancelled order red, which is the entire
    // visual difference between "Cancelled" and "Paid" at a glance.
    id: 'BADGE_MODIFIER_DROPPED',
    kind: 'bug',
    description: 'the status badge loses its per-status modifier class, so every status looks alike',
    edits: [
      {
        from: '`    <span class="badge badge--${order.status}" role="status">',
        to: '`    <span class="badge" role="status">',
      },
    ],
  },
  {
    // The second. Nothing visible changes at all — which is precisely why this
    // is the regression that ships.
    id: 'ARIA_LABEL_DROPPED',
    kind: 'bug',
    description: 'the section loses its aria-label, so the summary is announced as an unnamed region',
    edits: [
      {
        from: '`<section class="order" aria-label="Order ${escape(order.reference)}">`',
        to: '`<section class="order">`',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Noise
  // ---------------------------------------------------------------------
  {
    id: 'WRAPPER_DIV_ADDED',
    kind: 'noise',
    description: 'the totals list is wrapped in a panel div for styling',
    edits: [
      {
        from: "lines.push('  <dl class=\"order__totals\">')",
        to: "lines.push('  <div class=\"panel\">')\n  lines.push('  <dl class=\"order__totals\">')",
      },
      { from: "lines.push('  </dl>')", to: "lines.push('  </dl>')\n  lines.push('  </div>')" },
    ],
  },
  {
    id: 'HEADER_CLASS_RENAMED',
    kind: 'noise',
    description: 'the header class is renamed from BEM to a flat name',
    edits: [
      { from: '<header class="order__header">', to: '<header class="order-header">' },
    ],
  },
  {
    id: 'BOLD_TAG_MODERNISED',
    kind: 'noise',
    description: '<b> around the customer name becomes <strong>',
    edits: [
      {
        from: 'Order for <b>${field(\'customer\', escape(order.customerName))}</b>',
        to: 'Order for <strong>${field(\'customer\', escape(order.customerName))}</strong>',
      },
    ],
  },
  {
    id: 'TEST_ID_ADDED',
    kind: 'noise',
    description: 'a data-testid is added to the root element',
    edits: [
      {
        from: '`<section class="order" aria-label=',
        to: '`<section class="order" data-testid="order-summary" aria-label=',
      },
    ],
  },
  {
    id: 'ITEM_ROWS_REINDENTED',
    kind: 'noise',
    description: 'the item rows are re-indented by two spaces',
    edits: [
      { from: "'      <tr class=\"item\">',", to: "'    <tr class=\"item\">'," },
      { from: "'      </tr>',", to: "'    </tr>'," },
    ],
  },
  {
    id: 'BADGE_ATTRIBUTES_REORDERED',
    kind: 'noise',
    description: 'role comes before class on the badge',
    edits: [
      {
        from: '<span class="badge badge--${order.status}" role="status">',
        to: '<span role="status" class="badge badge--${order.status}">',
      },
    ],
  },
]

export function variantNamed(id: VariantId): Variant {
  const variant = VARIANTS.find((candidate) => candidate.id === id)

  if (variant === undefined) {
    throw new Error(`no variant named ${id}`)
  }

  return variant
}

export const BUGS: readonly Variant[] = VARIANTS.filter((variant) => variant.kind === 'bug')
export const NOISE: readonly Variant[] = VARIANTS.filter((variant) => variant.kind === 'noise')

/** Apply a variant's edits, insisting each matches exactly once. */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let edited = source

  for (const edit of edits) {
    const occurrences = edited.split(edit.from).length - 1

    if (occurrences !== 1) {
      throw new Error(
        `expected exactly one occurrence of ${JSON.stringify(edit.from)} in render.ts, found ${occurrences}`,
      )
    }

    edited = edited.replace(edit.from, edit.to)
  }

  return edited
}
