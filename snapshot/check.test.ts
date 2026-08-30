// @vitest-environment node
/**
 * The gate's report, and the file list it collects over.
 *
 * `collectTestNames` is deliberately not exercised here: it spawns
 * `vitest list`, which is the reason `pnpm snapshot:check` is a CI step of its
 * own rather than part of the unit run. What is covered is everything around
 * it — which files get listed, and whether the report a red build prints is
 * actually enough to act on.
 *
 * That last one is worth a test rather than an eyeball. The failure this gate
 * exists to catch is somebody approving a snapshot they did not read, and a
 * gate that answers with `snapshot: FAILED (3)` and no detail is asking for
 * exactly the same shrug one level up.
 */

import { describe, expect, it } from 'vitest'

import { filesWithSnapshots, render } from './check'
import type { FoundSnapshot, Inventory } from './inventory'
import { takeInventory } from './inventory'
import { evaluate } from './policy'
import { REGISTRY } from './registry'

const snapshot = (overrides: Partial<FoundSnapshot>): FoundSnapshot => ({
  kind: 'file',
  file: 'a/one.test.ts',
  name: 'a > b 1',
  lines: 3,
  content: 'x\ny\nz',
  ...overrides,
})

const inventoryOf = (...snapshots: FoundSnapshot[]): Inventory => ({
  snapshots,
  inline: [],
  snapFiles: [],
})

describe('the files handed to the collector', () => {
  it('are the test files that own a file snapshot, deduplicated and sorted', () => {
    const inventory = inventoryOf(
      snapshot({ file: 'b/two.test.ts', name: 'x 1' }),
      snapshot({ file: 'a/one.test.ts', name: 'y 1' }),
      snapshot({ file: 'a/one.test.ts', name: 'y 2' }),
    )

    expect(filesWithSnapshots(inventory)).toEqual(['a/one.test.ts', 'b/two.test.ts'])
  })

  it('exclude files that only have inline snapshots', () => {
    // An inline snapshot cannot go obsolete — it lives inside the test — so
    // listing its file would be seconds spent to learn nothing.
    const inventory = inventoryOf(snapshot({ kind: 'inline', file: 'c/three.test.ts' }))

    expect(filesWithSnapshots(inventory)).toEqual([])
  })

  it('are empty when the repository has no file snapshots at all', () => {
    expect(filesWithSnapshots(inventoryOf())).toEqual([])
  })
})

describe('the report', () => {
  it('prints each snapshot with its size, its budget and its reason', () => {
    const inventory = takeInventory()
    const output = render(inventory, evaluate(inventory, REGISTRY, null))

    expect(output).toContain('39/48')
    expect(output).toContain('the order summary markup > renders a paid order in full 1')
    expect(output).toContain('the only probe here that catches all ten')
  })

  it('names the rule, the file and what to do for every violation', () => {
    const inventory = inventoryOf(snapshot({ file: 'a/one.test.ts', name: 'unregistered thing 1' }))
    const output = render(inventory, evaluate(inventory, REGISTRY, null))

    expect(output).toContain('[unregistered] a/one.test.ts')
    expect(output).toContain('unregistered thing 1')
    expect(output).toContain('registry.ts')
    expect(output).toContain('See snapshot/README.md')
  })

  it('says nothing about violations when there are none', () => {
    const inventory = takeInventory()
    const output = render(inventory, evaluate(inventory, REGISTRY, null))

    expect(output).not.toContain('violation(s)')
  })
})

describe('the repository as it stands', () => {
  it('satisfies every rule the gate can decide without the runner', () => {
    // The obsolete rule needs `vitest list` and so belongs to
    // `pnpm snapshot:check`. Everything else is decidable here, and having it
    // in `pnpm test` means a snapshot added without a registry row fails in
    // seconds rather than at the end of the CI run.
    const inventory = takeInventory()

    expect(evaluate(inventory, REGISTRY, null).violations).toEqual([])
  })

  it('governs every snapshot that exists, with none left over', () => {
    const inventory = takeInventory()

    expect(evaluate(inventory, REGISTRY, null).governed).toHaveLength(inventory.snapshots.length)
    expect(inventory.snapshots).toHaveLength(REGISTRY.length)
  })
})
