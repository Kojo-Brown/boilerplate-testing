// @vitest-environment node
/**
 * The gate's decision, stated over inventories built in memory.
 *
 * Every rule gets its red case here. A gate that has only ever been seen green
 * is a screenshot with a CI job attached — `shape/policy.test.ts` and
 * `mutation/policy.test.ts` make the same point, and this file exists for the
 * same reason. The one thing these cases cannot cover is the gate wired to the
 * real repository, which `check.test.ts` does.
 */

import { describe, expect, it } from 'vitest'

import type { FoundInline, FoundSnapshot, Inventory } from './inventory'
import { evaluate, headroom, VOLATILE_PATTERNS, volatilityOf } from './policy'
import type { Registration } from './registry'

function snapshot(overrides: Partial<FoundSnapshot> = {}): FoundSnapshot {
  const content = overrides.content ?? 'one line'

  return {
    kind: 'file',
    file: 'example/thing.test.ts',
    name: 'a thing > renders 1',
    lines: content.split('\n').length,
    content,
    ...overrides,
  }
}

function inline(overrides: Partial<FoundInline> = {}): FoundInline {
  const content = overrides.content ?? 'one line'

  return {
    kind: 'inline',
    file: 'example/thing.test.ts',
    name: 'renders',
    matcher: 'toMatchInlineSnapshot',
    literal: true,
    lines: content.split('\n').length,
    content,
    ...overrides,
  }
}

function inventoryOf(...snapshots: FoundSnapshot[]): Inventory {
  return {
    snapshots,
    inline: snapshots.filter((s): s is FoundInline => s.kind === 'inline'),
    snapFiles: [],
  }
}

const registration = (overrides: Partial<Registration> = {}): Registration => ({
  file: 'example/thing.test.ts',
  name: 'a thing > renders 1',
  kind: 'file',
  budget: 10,
  why: 'because',
  ...overrides,
})

const kinds = (evaluation: ReturnType<typeof evaluate>): string[] =>
  evaluation.violations.map((violation) => violation.kind)

describe('a registered snapshot within its budget', () => {
  it('passes', () => {
    const evaluation = evaluate(inventoryOf(snapshot()), [registration()], null)

    expect(evaluation.violations).toEqual([])
  })

  it('is reported with the headroom it has left', () => {
    const evaluation = evaluate(inventoryOf(snapshot({ content: 'a\nb\nc' })), [registration()], null)

    expect(evaluation.governed).toHaveLength(1)
    expect(evaluation.governed[0]?.headroom).toBe(7)
  })
})

describe('an unregistered snapshot', () => {
  it('fails, whatever its size', () => {
    const evaluation = evaluate(inventoryOf(snapshot()), [], null)

    expect(kinds(evaluation)).toEqual(['unregistered'])
  })

  it('is named in the message, with what to do about it', () => {
    const evaluation = evaluate(inventoryOf(snapshot()), [], null)

    expect(evaluation.violations[0]?.detail).toContain('a thing > renders 1')
    expect(evaluation.violations[0]?.detail).toContain('registry.ts')
  })

  it('is unregistered when the name matches but the file does not', () => {
    // Two tests in different files can share a title. Matching on the name
    // alone would let a snapshot in one file be governed by the other's row.
    const evaluation = evaluate(
      inventoryOf(snapshot({ file: 'other/thing.test.ts' })),
      [registration()],
      null,
    )

    expect(kinds(evaluation)).toContain('unregistered')
  })
})

describe('a registration matching nothing', () => {
  it('fails rather than passing quietly', () => {
    // The direction almost every registry gets wrong. A row that governs
    // nothing reads like coverage and is not.
    const evaluation = evaluate(inventoryOf(), [registration()], null)

    expect(kinds(evaluation)).toEqual(['unused'])
  })

  it('fails when the test was renamed under it', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ name: 'a thing > renders the new way 1' })),
      [registration()],
      null,
    )

    expect(kinds(evaluation).sort()).toEqual(['unregistered', 'unused'])
  })
})

describe('a snapshot over its budget', () => {
  it('fails at one line over', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ content: Array.from({ length: 11 }, () => 'x').join('\n') })),
      [registration()],
      null,
    )

    expect(kinds(evaluation)).toEqual(['over-budget'])
  })

  it('passes at exactly the budget', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ content: Array.from({ length: 10 }, () => 'x').join('\n') })),
      [registration()],
      null,
    )

    expect(evaluation.violations).toEqual([])
    expect(evaluation.governed[0]?.headroom).toBe(0)
  })

  it('says both numbers, so the message is enough to act on', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ content: Array.from({ length: 14 }, () => 'x').join('\n') })),
      [registration()],
      null,
    )

    expect(evaluation.violations[0]?.detail).toContain('14 lines')
    expect(evaluation.violations[0]?.detail).toContain('budget of 10')
  })
})

describe('a snapshot registered under the wrong form', () => {
  it('fails, because the budgets are not comparable between the two', () => {
    const evaluation = evaluate(
      inventoryOf(inline({ name: 'a thing > renders 1' })),
      [registration({ kind: 'file' })],
      null,
    )

    expect(kinds(evaluation)).toContain('unregistered')
  })
})

describe('a volatile snapshot', () => {
  it('fails on an ISO timestamp', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ content: 'createdAt: 2024-03-11T09:41:00.000Z' })),
      [registration()],
      null,
    )

    expect(kinds(evaluation)).toEqual(['volatile'])
  })

  it('fails on a uuid, an absolute path, a port, an epoch and an object id', () => {
    const volatile = [
      'id: 3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      'cwd: /home/runner/work/repo',
      'origin: http://localhost:5173',
      'at: 1710150060000',
      '_id: ObjectId("507f1f77bcf86cd799439011")',
    ]

    for (const content of volatile) {
      expect(volatilityOf(content), content).not.toEqual([])
    }
  })

  it('says nothing about ordinary content', () => {
    // A rule that fires on real values is a rule people route around, and a
    // gate people route around has stopped being one. Money, dates written as
    // dates, references and prose all have to pass.
    const stable = [
      'total: £598.74',
      'placedOn: 2024-03-11',
      'reference: ORD-1042',
      'customer: Beaumont &amp; Fletcher',
      '<td class="item__name">Anti-fatigue mat</td>',
      'version: 10.5.5',
      'path: src/components/Order.tsx',
    ]

    for (const content of stable) {
      expect(volatilityOf(content), content).toEqual([])
    }
  })

  it('reports every volatile thing it found, not just the first', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ content: 'at 2024-03-11T09:41:00Z on localhost:5173' })),
      [registration()],
      null,
    )

    expect(evaluation.violations[0]?.detail).toContain('an ISO timestamp')
    expect(evaluation.violations[0]?.detail).toContain('a localhost port')
  })

  it('fails even when the snapshot is unregistered, so neither rule hides the other', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ content: 'createdAt: 2024-03-11T09:41:00.000Z' })),
      [],
      null,
    )

    expect(kinds(evaluation).sort()).toEqual(['unregistered', 'volatile'])
  })
})

describe('an inline snapshot with nothing in it', () => {
  it('fails, because it passes and asserts nothing', () => {
    const evaluation = evaluate(
      inventoryOf(inline({ name: 'a thing > renders 1', literal: false, content: '' })),
      [registration({ kind: 'inline' })],
      null,
    )

    expect(kinds(evaluation)).toEqual(['empty'])
  })

  it('fails the same way for an interpolated template', () => {
    // `toMatchInlineSnapshot(\`${expected}\`)` computes its expectation at run
    // time. Whatever that is, it is not a snapshot.
    const evaluation = evaluate(
      inventoryOf(inline({ name: 'a thing > renders 1', literal: false, content: '' })),
      [registration({ kind: 'inline' })],
      null,
    )

    expect(evaluation.violations[0]?.detail).toContain('no literal snapshot')
  })
})

describe('an obsolete file snapshot', () => {
  it('fails when its test is not among the collected names', () => {
    const evaluation = evaluate(inventoryOf(snapshot()), [registration()], new Set(['a thing > something else']))

    expect(kinds(evaluation)).toEqual(['obsolete'])
  })

  it('passes when the test exists, matching on the name without Vitest’s counter', () => {
    const evaluation = evaluate(inventoryOf(snapshot()), [registration()], new Set(['a thing > renders']))

    expect(evaluation.violations).toEqual([])
  })

  it('matches the same test for its second and third snapshots', () => {
    const evaluation = evaluate(
      inventoryOf(snapshot({ name: 'a thing > renders 2' })),
      [registration({ name: 'a thing > renders 2' })],
      new Set(['a thing > renders']),
    )

    expect(evaluation.violations).toEqual([])
  })

  it('is not applied to inline snapshots, which cannot outlive their test', () => {
    // An inline snapshot is inside the test body. Deleting the test deletes
    // it, so there is nothing to go obsolete — and the key is the title rather
    // than a `describe > it` path, which would never match the collected name.
    const evaluation = evaluate(
      inventoryOf(inline({ name: 'a thing > renders 1' })),
      [registration({ kind: 'inline' })],
      new Set(['something else entirely']),
    )

    expect(evaluation.violations).toEqual([])
  })

  it('is skipped entirely when no names are supplied', () => {
    const evaluation = evaluate(inventoryOf(snapshot()), [registration()], null)

    expect(kinds(evaluation)).toEqual([])
  })
})

describe('the budget arithmetic', () => {
  it('reports no negative headroom for a snapshot already over', () => {
    const over = snapshot({ content: Array.from({ length: 20 }, () => 'x').join('\n') })

    expect(headroom(over, registration())).toBe(0)
  })
})

describe('the volatility table', () => {
  it('names every pattern, since the names are what the message prints', () => {
    for (const rule of VOLATILE_PATTERNS) {
      expect(rule.name).not.toBe('')
    }

    expect(VOLATILE_PATTERNS).toHaveLength(6)
  })

  it('uses no global regexes, whose lastIndex would make a test order-dependent', () => {
    // A `/g` regex carries `lastIndex` between `.test()` calls, so the same
    // pattern would match and then not match against identical input. It is
    // the sort of bug that shows up as one flaky rule months later.
    for (const rule of VOLATILE_PATTERNS) {
      expect(rule.pattern.global, rule.name).toBe(false)
    }
  })
})
