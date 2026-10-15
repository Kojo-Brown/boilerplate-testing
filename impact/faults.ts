/**
 * The fault catalogue: eight changes to the fixture, each one a shape of diff
 * that a selector has to get right.
 *
 * ---------------------------------------------------------------------------
 * Why faults rather than opinions
 * ---------------------------------------------------------------------------
 * "Does this selector miss things?" cannot be answered by reading it. The
 * answer is a pair of measurements: which suites fail when a change is really
 * made, and which suites the selector would have run. The first one needs the
 * change to be real — applied to a file, in a copy of the subject, with the
 * runner actually run — and that is what `runs.ts` does with each entry below.
 *
 * Every fault here breaks at least one suite. A fault that broke nothing would
 * be unscoreable: the selection could not be wrong about it.
 *
 * ---------------------------------------------------------------------------
 * What this catalogue does not contain
 * ---------------------------------------------------------------------------
 * Deletions and renames. Not because they do not matter — they are the hardest
 * case, since the importers of a deleted file are findable only in a tree that
 * no longer exists — but because the honest handling is a rule rather than a
 * measurement: `select.ts` runs everything when a path vanishes, and
 * `select.test.ts` covers that directly. A fault that deleted a module would
 * measure a full run against a full run.
 */

import type { ChangedFile } from './diff.ts'

export const FAULT_IDS = [
  'bulk-threshold',
  'scale-cents',
  'test-factory',
  'runtime-rule',
  'rate-table',
  'snapshot-baseline',
  'setup-matcher',
  'new-test',
] as const

export type FaultId = (typeof FAULT_IDS)[number]

interface Patch {
  readonly kind: 'patch'
  /** Fixture-relative path. */
  readonly file: string
  /** Must appear exactly once in the file: `runs.ts` fails the measurement otherwise. */
  readonly find: string
  readonly replace: string
}

interface Creation {
  readonly kind: 'create'
  readonly file: string
  readonly contents: string
}

export interface Fault {
  readonly id: FaultId
  /** The shape of dependency this fault travels along. */
  readonly shape: string
  readonly change: Patch | Creation
}

/**
 * The added test file, as text.
 *
 * It asserts a tiered discount the fixture does not implement — 10% at twenty
 * units, where `pricing.ts` gives 5% — so it fails the way a test written
 * before its feature fails. It is a string rather than a file on disk because
 * a failing test committed to the repository would be collected by somebody,
 * eventually, and be red.
 */
const ADDED_TEST = `import { describe, expect, it } from 'vitest'

import { lineTotal } from './pricing.ts'
import { line } from './support/factory.ts'

describe('the tiered discount', () => {
  it('takes 10% off at a quantity of twenty', () => {
    expect(lineTotal(line({ quantity: 20 }))).toBeExactInteger(4_500)
  })
})
`

export const FAULTS: readonly Fault[] = [
  {
    id: 'bulk-threshold',
    shape: 'an ordinary source change, one import hop below a test and two below another',
    change: {
      kind: 'patch',
      file: 'src/pricing.ts',
      find: 'export const BULK_THRESHOLD = 12',
      replace: 'export const BULK_THRESHOLD = 2',
    },
  },
  {
    id: 'scale-cents',
    shape: 'a change at the bottom of the graph: three suites deep, which is where a selector stops saving anything',
    change: {
      kind: 'patch',
      file: 'src/money.ts',
      find: '  return cents * quantity\n',
      replace: '  return cents * quantity - 1\n',
    },
  },
  {
    id: 'test-factory',
    shape: 'a change to a test helper, which is reachable from tests only through a file that is not a test',
    change: {
      kind: 'patch',
      file: 'src/support/factory.ts',
      find: "return { sku: 'SKU-1', unitCents: 250, quantity: 3, ...overrides }",
      replace: "return { sku: 'SKU-1', unitCents: 2500, quantity: 3, ...overrides }",
    },
  },
  {
    id: 'runtime-rule',
    shape: 'a module loaded by name at run time: no import statement anywhere names it',
    change: {
      kind: 'patch',
      file: 'src/rules/bulk.rule.ts',
      find: 'line.quantity >= 12 ? 500 : 0',
      replace: 'line.quantity >= 12 ? 1500 : 0',
    },
  },
  {
    id: 'rate-table',
    shape: 'a data file, read from disk and imported by nothing',
    change: {
      kind: 'patch',
      file: 'src/data/rates.json',
      find: '"EUR": 9200',
      replace: '"EUR": 9900',
    },
  },
  {
    id: 'snapshot-baseline',
    shape: 'a snapshot baseline, which a test depends on entirely and names not at all',
    change: {
      kind: 'patch',
      file: 'src/__snapshots__/label.test.ts.snap',
      find: 'SKU-2 x3 @ $2.50',
      replace: 'SKU-2 x4 @ $2.50',
    },
  },
  {
    id: 'setup-matcher',
    shape: 'a setup file, which reaches every suite through a runner setting rather than an import',
    change: {
      kind: 'patch',
      file: 'setup.ts',
      find: 'received === expected\n',
      replace: 'received === expected * 100\n',
    },
  },
  {
    id: 'new-test',
    shape: 'a test file added by the diff, which has no history to be selected by',
    change: { kind: 'create', file: 'src/discount.test.ts', contents: ADDED_TEST },
  },
]

const BY_ID = new Map(FAULTS.map((fault) => [fault.id, fault]))

export function fault(id: FaultId): Fault {
  const found = BY_ID.get(id)

  if (found === undefined) throw new Error(`unknown fault: ${id}`)

  return found
}

/** The diff a fault produces, in the form `select.ts` consumes. */
export function diffOf(target: Fault): readonly ChangedFile[] {
  return [{ path: target.change.file, status: target.change.kind === 'create' ? 'added' : 'modified' }]
}
