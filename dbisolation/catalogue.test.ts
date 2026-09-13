// @vitest-environment node
/**
 * The tables this directory is built out of, checked for the properties the
 * matrices assume.
 *
 * Runs in `pnpm test`, without a container: none of it needs a server, and all
 * of it is the kind of thing that rots silently — a fault added to the list and
 * not to the subject, a strategy key that no longer matches the README, a
 * behaviour whose declared vantage point stopped being true.
 */

import { describe, expect, it } from 'vitest'

import { BEHAVIOURS, BEHAVIOUR_KEYS, orderFor, VANTAGES } from './behaviours.ts'
import { COST_ORDERINGS } from './cost.ts'
import { FAULT_CATALOGUE, FAULTS, MECHANISMS, only } from './faults.ts'
import { PROBES, PROBE_KEYS } from './leakage.ts'
import { recordingQueryable } from './double.ts'
import { CORRECT, placeOrder } from './orders.ts'
import { ALL_TABLES, DDL, TRUNCATED_TABLES, truncateStatement } from './schema.ts'
import { FAMILIES, STRATEGIES, STRATEGY_KEYS } from './strategies.ts'

describe('the fault catalogue', () => {
  it('has one entry per fault and no others', () => {
    expect(FAULT_CATALOGUE.map((entry) => entry.fault)).toEqual([...FAULTS])
  })

  it('gives every fault a mechanism from the closed list', () => {
    for (const entry of FAULT_CATALOGUE) {
      expect(MECHANISMS, entry.fault).toContain(entry.mechanism)
    }
  })

  it('covers every mechanism, so no column of misses stands alone', () => {
    const covered = new Set(FAULT_CATALOGUE.map((entry) => entry.mechanism))

    expect([...covered].sort()).toEqual([...MECHANISMS].sort())
  })

  it('keeps a third of the corpus on mechanisms no strategy can interfere with', () => {
    const controls = FAULT_CATALOGUE.filter((entry) => entry.mechanism === 'assertion')

    // The point of the controls is that they are numerous enough that a column
    // of misses cannot be explained by a broken harness.
    expect(controls.length).toBeGreaterThanOrEqual(3)
  })

  it('says why each fault would ship, not only what it does', () => {
    for (const entry of FAULT_CATALOGUE) {
      expect(entry.edit.length, entry.fault).toBeGreaterThan(20)
      expect(entry.plausibility.length, entry.fault).toBeGreaterThan(40)
    }
  })

  it('carries no expected result, so the corpus cannot confirm itself', () => {
    for (const entry of FAULT_CATALOGUE) {
      expect(Object.keys(entry).sort()).toEqual(['edit', 'fault', 'mechanism', 'plausibility'])
    }
  })

  it('turns a fault into a single-element set', () => {
    expect([...only('ORPHAN_LINE')]).toEqual(['ORPHAN_LINE'])
    expect(CORRECT.size).toBe(0)
  })
})

describe('the strategies', () => {
  it('has unique keys', () => {
    expect(new Set(STRATEGY_KEYS).size).toBe(STRATEGIES.length)
  })

  it('puts every strategy in a declared family', () => {
    for (const strategy of STRATEGIES) {
      expect(FAMILIES, strategy.key).toContain(strategy.family)
      expect(strategy.summary.length, strategy.key).toBeGreaterThan(30)
    }
  })

  it('marks exactly the rollback family as pinned to one connection', () => {
    const pinned = STRATEGIES.filter((strategy) => strategy.singleConnection).map((strategy) => strategy.key)

    expect(pinned).toEqual(['rollback', 'rollback-savepoint'])
    expect(STRATEGIES.filter((strategy) => strategy.family === 'rollback').map((s) => s.key)).toEqual(pinned)
  })
})

describe('the behaviours', () => {
  it('has unique keys and declared vantage points', () => {
    expect(new Set(BEHAVIOUR_KEYS).size).toBe(BEHAVIOURS.length)

    for (const behaviour of BEHAVIOURS) {
      expect(VANTAGES, behaviour.key).toContain(behaviour.observes)
    }
  })

  it('covers every vantage point', () => {
    expect([...new Set(BEHAVIOURS.map((behaviour) => behaviour.observes))].sort()).toEqual([...VANTAGES].sort())
  })

  it('gives each behaviour an order reference of its own', () => {
    const refs = BEHAVIOUR_KEYS.map((key) => orderFor(key).ref)

    // The property that keeps leakage out of the detection matrix: two
    // behaviours in one run cannot collide even under `none`.
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('orders two lines worth 1,500 in total', () => {
    const order = orderFor('total')

    expect(order.lines).toHaveLength(2)
    expect(order.lines.reduce((sum, line) => sum + line.cents, 0)).toBe(1_500)
  })
})

describe('the leakage probes', () => {
  it('has unique keys and says what has to leak', () => {
    expect(new Set(PROBE_KEYS).size).toBe(PROBES.length)

    for (const probe of PROBES) {
      expect(probe.residue.length, probe.key).toBeGreaterThan(20)
    }
  })

  it('keeps the pair that differs only in a transaction', () => {
    // `rows` and `plain-insert` are the whole naive-rollback finding. If one of
    // them is ever deleted the matrix still passes and stops saying anything.
    expect(PROBE_KEYS).toContain('rows')
    expect(PROBE_KEYS).toContain('plain-insert')
  })
})

describe('the schema', () => {
  it('omits audit_log from the hand-written TRUNCATE list, on purpose', () => {
    // Pinned rather than left as a comment: fixing the list here would empty
    // two cells of the leakage matrix and nothing would fail.
    expect([...ALL_TABLES].sort()).toEqual(['audit_log', 'order_lines', 'orders', 'stock'])
    expect([...TRUNCATED_TABLES].sort()).toEqual(['order_lines', 'orders', 'stock'])
    expect(TRUNCATED_TABLES).not.toContain('audit_log')
  })

  it('declares the deferred constraints the deferred-constraint faults need', () => {
    const ddl = DDL.join('\n')

    expect(ddl).toContain('orders_ref_key unique (ref)')
    expect(ddl).toContain('order_lines_order_id_fkey')
    expect(ddl.match(/deferrable initially deferred/g)).toHaveLength(2)
    // And the immediate one, which is the control.
    expect(ddl).toContain('check (on_hand >= 0)')
  })

  it('builds the TRUNCATE it is asked for', () => {
    expect(truncateStatement(['a', 'b'], false)).toBe('truncate a, b cascade')
    expect(truncateStatement(['a'], true)).toBe('truncate a restart identity cascade')
  })
})

describe('the subject', () => {
  it('sends transaction control as bare lowercase keywords', async () => {
    // The savepoint strategy matches on the first word. A subject that dressed
    // its transaction control up would silently stop being rewritten, and the
    // matrix would report that as a property of the strategy.
    const recorder = recordingQueryable((text) => (text.startsWith('insert into orders') ? [{ id: '1' }] : []))

    await placeOrder(recorder.db, orderFor('total'))

    const sent = recorder.sent().map((text) => text.trim())

    expect(sent[0]).toBe('begin')
    expect(sent.at(-1)).toBe('commit')
    expect(sent.filter((text) => text === 'begin' || text === 'commit')).toEqual(['begin', 'commit'])
  })
})

describe('the cost orderings', () => {
  it('names strategies that exist, or the baseline', () => {
    const known = new Set([...STRATEGY_KEYS, 'connect-only'])

    for (const ordering of COST_ORDERINGS) {
      expect(known, ordering.cheaper).toContain(ordering.cheaper)
      expect(known, ordering.dearer).toContain(ordering.dearer)
      expect(ordering.cheaper).not.toBe(ordering.dearer)
      expect(ordering.why.length).toBeGreaterThan(40)
    }
  })

  it('claims nothing about two strategies in both directions', () => {
    const pairs = COST_ORDERINGS.map((ordering) => `${ordering.cheaper}<${ordering.dearer}`)
    const reversed = COST_ORDERINGS.map((ordering) => `${ordering.dearer}<${ordering.cheaper}`)

    expect(pairs.filter((pair) => reversed.includes(pair))).toEqual([])
    expect(new Set(pairs).size).toBe(pairs.length)
  })
})
