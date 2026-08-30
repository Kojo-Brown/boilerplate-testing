/**
 * The projection: the small, stable thing worth snapshotting.
 *
 * ---------------------------------------------------------------------------
 * The argument
 * ---------------------------------------------------------------------------
 * A full-markup snapshot asserts on everything, which is both why it catches
 * so much and why nobody reads it. Every wrapper `<div>`, every class rename,
 * every re-indent turns it red, and the reviewer's honest position — "I cannot
 * tell whether these 38 changed lines contain a bug" — resolves to `-u` within
 * about two sprints. From then on the snapshot asserts nothing at all, and it
 * does so silently, which is worse than having deleted it.
 *
 * A projection is the response: snapshot a *derived* value small enough to
 * read in a pull-request diff, built from handles the renderer publishes on
 * purpose (`data-field`), so that changes to the markup around them do not
 * move it.
 *
 * ---------------------------------------------------------------------------
 * What it costs
 * ---------------------------------------------------------------------------
 * Blindness, and the amount is measured rather than waved at. A projection can
 * only see what it extracts, so the class that styles a cancelled badge red,
 * or the `aria-label` a screen reader announces, are outside it — and both are
 * real regressions. `detection.test.ts` puts numbers on this: the full
 * snapshot catches strictly more than the projection does.
 *
 * The conclusion `README.md` draws is therefore *not* "always project". It is:
 * project the values, assert the structure you care about explicitly, and know
 * which of the two you are relying on for each fact. The blind spots are named
 * in `BLIND_SPOTS` below and covered by `assertions.test.ts`, so the cost is
 * written down in code rather than discovered later.
 *
 * ---------------------------------------------------------------------------
 * Why regex and not a DOM
 * ---------------------------------------------------------------------------
 * `data-field` elements hold text and nothing else — that is the contract
 * stated in `render.ts` — so a parse buys nothing here, and requiring jsdom
 * would make this module unusable from the node-environment suites that read
 * files. `fieldNames` enforces the contract in the other direction: a
 * `data-field` whose content contains a `<` is a violation, not a value.
 */

/** A `data-field` element with markup inside it, which the contract forbids. */
export class NestedFieldError extends Error {
  // A plain field rather than a parameter property: Node's type stripping runs
  // in strip-only mode, where a parameter property is a syntax error.
  readonly field: string

  constructor(field: string) {
    super(
      `data-field="${field}" contains markup. Fields must hold text only — see the ` +
        'contract in render.ts. Either flatten the element or stop calling it a field.',
    )
    this.field = field
    this.name = 'NestedFieldError'
  }
}

// `[^>]*?` before the attribute, so a field is found wherever it sits in the
// tag. Requiring it first would make the projection sensitive to attribute
// order, which is one of the refactors `edits.ts` classifies as noise — a
// projection that moved on it would fail its own argument.
const FIELD = /<[a-z]+[^>]*?\sdata-field="([^"]+)"[^>]*>([^<]*)<\/[a-z]+>/g

/** A `data-field` opening tag, used only to detect the ones `FIELD` could not match. */
const FIELD_OPEN = /data-field="([^"]+)"/g

/**
 * The projected snapshot: every published field, in document order.
 *
 * An array of pairs rather than an object, because document order is part of
 * what is being asserted — moving the total above the subtotal is a change
 * worth seeing — and because a duplicate field name should be visible rather
 * than silently overwriting.
 */
export type Projection = readonly (readonly [field: string, value: string])[]

export function project(html: string): Projection {
  const matched = [...html.matchAll(FIELD)]
  const declared = [...html.matchAll(FIELD_OPEN)]

  if (matched.length !== declared.length) {
    const found = new Set(matched.map((match) => match[1]))
    const missing = declared.map((match) => match[1] ?? '').find((name) => !found.has(name))

    throw new NestedFieldError(missing ?? 'unknown')
  }

  return matched.map((match) => [match[1] ?? '', match[2] ?? ''] as const)
}

/** The projection as lines, which is the form a snapshot diff is counted in. */
export function projectionLines(html: string): string[] {
  return project(html).map(([field, value]) => `${field}: ${value}`)
}

/**
 * Field names a projection of the corpus is expected to contain.
 *
 * Closed, in the same sense as `shape/boundaries.ts`: a field rendered but not
 * listed here fails `project.test.ts`. The failure mode being guarded is the
 * quiet one — someone adds a price to the markup without a `data-field`, the
 * projected snapshot does not change, and every reviewer reads "no snapshot
 * changes" as "the value is right".
 *
 * Per-item fields are keyed by SKU, so this table lists their prefixes rather
 * than every product in the corpus.
 */
export const FIELDS: readonly string[] = [
  'reference',
  'customer',
  'placedOn',
  'status',
  'itemCount',
  'subtotal',
  'discount',
  'delivery',
  'tax',
  'total',
]

/** Per-item field suffixes, appended to `item.<sku>.`. */
export const ITEM_FIELDS: readonly string[] = ['quantity', 'unit', 'line']

/** True when `name` is a field this repository has agreed to publish. */
export function isKnownField(name: string): boolean {
  if (FIELDS.includes(name)) {
    return true
  }

  const parts = name.split('.')

  return parts.length === 3 && parts[0] === 'item' && ITEM_FIELDS.includes(parts[2] ?? '')
}

/**
 * What the projection cannot see, stated so it can be tested for.
 *
 * Each entry names something `render.ts` emits that a projected snapshot would
 * not notice changing, and the suite that is therefore responsible for it.
 * `detection.test.ts` asserts that each of these corresponds to a variant the
 * projection misses — a blind spot that is merely claimed is not a finding.
 */
export const BLIND_SPOTS: readonly { readonly what: string; readonly coveredBy: string }[] = [
  {
    what: 'the class that styles the status badge (`badge--cancelled` and friends)',
    coveredBy: 'assertions.test.ts',
  },
  {
    what: "the section's `aria-label`, which is how the summary is announced",
    coveredBy: 'assertions.test.ts',
  },
]
