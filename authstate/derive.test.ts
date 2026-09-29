/**
 * The derivation rules, checked against ledgers no real run produces.
 *
 * `runs.test.ts` proves these rules agree with ten real runs. That is the wrong
 * instrument for asking whether a rule fires for the reason it claims to: every
 * ledger a real run produces is one the strategies under measurement happened
 * to generate, so a rule that is right by accident and a rule that is right on
 * purpose look identical from there.
 *
 * So the ledgers here are written by hand, including several that no strategy
 * in `strategies.ts` could produce — a worker that read a foreign note *and*
 * got a 401, a restart with three workers in one slot, a slot that repeats a
 * worker index. Each one exists because a plausible simpler version of the rule
 * next to it gets it wrong.
 */

import { describe, expect, it } from 'vitest'

import {
  accountsUsed,
  deriveRow,
  evictionVerdict,
  inheritanceVerdict,
  mutationVerdict,
  replacements,
  type LedgerRow,
} from './derive.ts'

const row = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({
  strategy: 'per-test',
  phase: 'parallel',
  marker: 'alpha',
  workerIndex: 0,
  parallelIndex: 0,
  retry: 0,
  email: 'a@example.test',
  slot: 'a',
  acquired: 'signed-in',
  meStatus: 200,
  notes: 'alpha',
  ...overrides,
})

describe('session-eviction', () => {
  it('reports evicted when one row in the pair answered 401', () => {
    expect(evictionVerdict([row(), row({ marker: 'beta', meStatus: 401, notes: '' })])).toBe(
      'evicted',
    )
  })

  it('reports evicted when only the first worker was the one kicked off', () => {
    // Eviction is asymmetric: the account's *last* sign-in keeps the session.
    // A rule wanting both workers to fail would report the hazard as absent in
    // exactly the runs where it is present.
    expect(evictionVerdict([row({ meStatus: 401, notes: '' }), row({ marker: 'beta' })])).toBe(
      'evicted',
    )
  })

  it('reports survives when every row answered 200', () => {
    expect(evictionVerdict([row(), row({ marker: 'beta', notes: 'beta' })])).toBe('survives')
  })

  it('looks at the restart phase too, not only the parallel one', () => {
    expect(evictionVerdict([row(), row({ phase: 'restart', meStatus: 401, notes: '' })])).toBe(
      'evicted',
    )
  })
})

describe('parallel-mutation', () => {
  it('reports collided when a row read a note it did not write', () => {
    expect(mutationVerdict([row({ notes: 'alpha|beta' }), row({ marker: 'beta', notes: 'alpha|beta' })])).toBe(
      'collided',
    )
  })

  it('reports isolated when every row read only its own marker', () => {
    expect(mutationVerdict([row(), row({ marker: 'beta', notes: 'beta' })])).toBe('isolated')
  })

  it('reports unreachable when a worker never got to write', () => {
    // The finding the first draft of this rule missed. A worker that has been
    // signed out cannot collide with anything, so `isolated` here would be a
    // clean cell earned by failing the column to its left.
    expect(mutationVerdict([row({ meStatus: 401, notes: '' }), row({ marker: 'beta', notes: 'beta' })])).toBe(
      'unreachable',
    )
  })

  it('prefers unreachable over collided when both are visible', () => {
    // No real run produces this — a 401 means one fewer writer — but the
    // ordering has to be decided rather than emergent: a run in which somebody
    // was signed out has not posed the question, whatever else it shows.
    expect(
      mutationVerdict([row({ meStatus: 401, notes: '' }), row({ marker: 'beta', notes: 'alpha|beta' })]),
    ).toBe('unreachable')
  })

  it('ignores the restart phase, where there is no second worker to collide with', () => {
    expect(
      mutationVerdict([
        row({ marker: 'beta', notes: 'beta' }),
        row({ phase: 'restart', notes: 'before-restart|after-restart' }),
      ]),
    ).toBe('isolated')
  })

  it('treats an empty note list as nothing foreign read', () => {
    expect(mutationVerdict([row({ notes: '' })])).toBe('isolated')
  })
})

describe('finding the restart', () => {
  it('pairs two workers at one parallel slot', () => {
    const found = replacements([
      row({ phase: 'restart', workerIndex: 0 }),
      row({ phase: 'restart', workerIndex: 1 }),
    ])

    expect(found.map((pair) => [pair.before.workerIndex, pair.after.workerIndex])).toEqual([[0, 1]])
  })

  it('does not pair two rows from the same worker', () => {
    expect(
      replacements([row({ phase: 'restart' }), row({ phase: 'restart', marker: 'second' })]),
    ).toEqual([])
  })

  it('does not pair rows from different slots', () => {
    expect(
      replacements([
        row({ phase: 'restart', parallelIndex: 0, workerIndex: 0 }),
        row({ phase: 'restart', parallelIndex: 1, workerIndex: 1 }),
      ]),
    ).toEqual([])
  })

  it('finds both restarts when a slot is replaced twice', () => {
    const found = replacements([
      row({ phase: 'restart', workerIndex: 0 }),
      row({ phase: 'restart', workerIndex: 1 }),
      row({ phase: 'restart', workerIndex: 2 }),
    ])

    expect(found).toHaveLength(2)
  })

  it('ignores the parallel phase, whose two workers are not a restart', () => {
    expect(replacements([row({ workerIndex: 0 }), row({ workerIndex: 1 })])).toEqual([])
  })
})

describe('restart-inheritance', () => {
  it('reports inherited when the replacement resumed the same account', () => {
    expect(
      inheritanceVerdict([
        row({ phase: 'restart', workerIndex: 0, email: 'slot-p0@example.test' }),
        row({ phase: 'restart', workerIndex: 1, email: 'slot-p0@example.test' }),
      ]),
    ).toBe('inherited')
  })

  it('reports fresh when the replacement signed in as somebody else', () => {
    expect(
      inheritanceVerdict([
        row({ phase: 'restart', workerIndex: 0, email: 'slot-w0@example.test' }),
        row({ phase: 'restart', workerIndex: 1, email: 'slot-w1@example.test' }),
      ]),
    ).toBe('fresh')
  })

  it('ignores what the replacement could read, which is a different column', () => {
    // A rule phrased as "did it see the old worker's notes" is true for every
    // shared-account strategy for reasons that have nothing to do with
    // restarts, and would make this column a copy of `parallel-mutation`.
    expect(
      inheritanceVerdict([
        row({ phase: 'restart', workerIndex: 0, email: 'a@example.test', notes: 'one' }),
        row({ phase: 'restart', workerIndex: 1, email: 'b@example.test', notes: 'one|two' }),
      ]),
    ).toBe('fresh')
  })

  it('refuses to answer when no worker was replaced', () => {
    expect(() => inheritanceVerdict([row({ phase: 'restart' })])).toThrow(/no worker was replaced/i)
  })
})

describe('accounts used', () => {
  it('counts distinct accounts in one run', () => {
    expect(accountsUsed([row({ email: 'a@example.test' }), row({ email: 'b@example.test' })])).toBe(
      2,
    )
  })

  it('counts an account used twice once', () => {
    expect(accountsUsed([row(), row({ marker: 'beta' })])).toBe(1)
  })
})

describe('a whole row', () => {
  it('sums the two phases rather than counting distinct accounts across them', () => {
    // The correction the run forced. Playwright starts `workerIndex` at 0 in
    // each run, so the same account name appears in both phases and a set over
    // the combined rows reports four workers as two accounts.
    const measured = deriveRow(
      {
        rows: [
          row({ email: 'slot-w0@example.test', notes: 'alpha' }),
          row({ marker: 'beta', email: 'slot-w1@example.test', notes: 'beta' }),
        ],
        logins: 2,
      },
      {
        rows: [
          row({ phase: 'restart', workerIndex: 0, email: 'slot-w0@example.test' }),
          row({ phase: 'restart', workerIndex: 1, email: 'slot-w1@example.test' }),
        ],
        logins: 2,
      },
    )

    expect({ accounts: measured.accounts, logins: measured.logins }).toEqual({
      accounts: 4,
      logins: 4,
    })
  })
})
