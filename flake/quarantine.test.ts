/**
 * The registry: its parser, its decisions, and this repository's own copy.
 *
 * The decisions are tested against registries and histories that are not this
 * repository's, because the interesting entries are the ones a healthy
 * repository never has: an entry naming a test that was deleted, an entry for
 * a test that has been green for a month, an entry nothing has ever measured.
 *
 * The last block checks the real `quarantine.json`, expiry included. That makes
 * `pnpm test` depend on the date, deliberately: an expiry nothing enforces is
 * a comment. It is inert while the registry is empty, which is the normal state
 * — nothing in this repository is flaky, and `flake/mechanism.test.ts` proves
 * the machinery works by running the subject against a registry of its own.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { TestHistory } from '@/flake/history'
import { summarise } from '@/flake/history'
import {
  audit,
  decide,
  DEFAULT_QUARANTINE_POLICY,
  isQuarantined,
  keyOf,
  parseRegistry,
  type QuarantineEntry,
} from '@/flake/quarantine'
import { loadRegistry, registryPath } from '@/flake/registry'

const entry = (overrides: Partial<QuarantineEntry> = {}): QuarantineEntry => ({
  module: 'suite/thing.test.ts',
  name: 'polls until the stream is ready',
  runner: 'vitest',
  reason: 'races with the fixture’s own poll on a cold cache',
  owner: '@someone',
  ticket: 'FLAKE-12',
  addedOn: '2026-10-01',
  expiresOn: '2026-10-29',
  ...overrides,
})

const known = new Set([keyOf(entry())])

/** A history for the entry above, from a list of per-run attempt outcomes. */
const historyFor = (runs: readonly (readonly ('passed' | 'failed')[])[]): TestHistory => {
  const histories = summarise(
    runs.flatMap((outcomes, runIndex) =>
      outcomes.map((outcome, index) => ({
        run: `r${String(runIndex + 1)}`,
        runner: 'vitest' as const,
        module: entry().module,
        name: entry().name,
        attempt: index + 1,
        outcome,
      })),
    ),
  )

  const [history] = histories

  if (history === undefined) throw new Error('no history built')

  return history
}

describe('parseRegistry', () => {
  it('reads a complete entry', () => {
    const registry = parseRegistry(JSON.stringify({ version: 1, entries: [entry()] }))

    expect(registry.entries).toHaveLength(1)
  })

  it('refuses a version it does not know', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 2, entries: [] }))).toThrow('version 1')
  })

  it('refuses an entry with no owner', () => {
    const { owner: _owner, ...rest } = entry()

    expect(() => parseRegistry(JSON.stringify({ version: 1, entries: [rest] }))).toThrow('incomplete')
  })

  it('refuses an entry whose reason is blank', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, entries: [entry({ reason: '   ' })] }))).toThrow('incomplete')
  })

  it('refuses a date that is not a date', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, entries: [entry({ expiresOn: 'next sprint' })] }))).toThrow(
      'incomplete',
    )
  })

  it('refuses a runner it cannot list tests from', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, entries: [entry({ runner: 'jest' as 'vitest' })] }))).toThrow(
      'incomplete',
    )
  })

  it('refuses two entries for the same test', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, entries: [entry(), entry()] }))).toThrow('duplicate')
  })

  it('refuses entries that are not an array', () => {
    expect(() => parseRegistry(JSON.stringify({ version: 1, entries: {} }))).toThrow('must be an array')
  })
})

describe('decide', () => {
  const context = { known, today: '2026-10-14' }

  it('holds an entry for a test that is still flaking', () => {
    const judgement = decide(entry(), { ...context, history: historyFor([['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']]) })

    expect(judgement.decision).toBe('hold')
  })

  it('releases an entry for a test that has stopped failing', () => {
    const judgement = decide(entry(), {
      ...context,
      history: historyFor([['failed'], ...Array.from({ length: 10 }, () => ['passed' as const])]),
    })

    expect(judgement.decision).toBe('release')
  })

  it('releases an entry for a test that has never failed at all', () => {
    const judgement = decide(entry(), { ...context, history: historyFor([['passed'], ['passed']]) })

    expect(judgement.decision).toBe('release')
  })

  it('escalates an entry for a test that fails every attempt', () => {
    const judgement = decide(entry(), { ...context, history: historyFor(Array.from({ length: 6 }, () => ['failed' as const])) })

    expect(judgement.decision).toBe('escalate')
    expect(judgement.because).toContain('not a flake')
  })

  it('reports an entry past its expiry, and says how far past', () => {
    const judgement = decide(entry({ expiresOn: '2026-09-01' }), { ...context, history: historyFor([['failed', 'passed']]) })

    expect(judgement.decision).toBe('expired')
    expect(judgement.because).toContain('43 days ago')
  })

  it('holds an entry expiring today rather than reporting it', () => {
    const judgement = decide(entry({ expiresOn: '2026-10-14' }), {
      ...context,
      history: historyFor([['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']]),
    })

    expect(judgement.decision).toBe('hold')
  })

  it('reports an entry naming a test nothing collects', () => {
    const judgement = decide(entry({ name: 'a test that was renamed' }), { ...context, history: undefined })

    expect(judgement.decision).toBe('orphan')
  })

  it('prefers orphan to expired, since an entry naming nothing cannot be assessed', () => {
    const judgement = decide(entry({ name: 'gone', expiresOn: '2020-01-01' }), { ...context, history: undefined })

    expect(judgement.decision).toBe('orphan')
  })

  it('reports an entry nothing has measured', () => {
    const judgement = decide(entry(), { ...context, history: undefined })

    expect(judgement.decision).toBe('unevidenced')
  })

  it('names the test in every verdict it returns', () => {
    const judgement = decide(entry({ name: 'gone' }), { ...context, history: undefined })

    expect(judgement.because).toContain('gone')
  })
})

describe('audit', () => {
  const context = { known, today: '2026-10-14', histories: [] as readonly TestHistory[] }

  it('reports every entry that is not a hold', () => {
    const { violations } = audit({ version: 1, entries: [entry()] }, context)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('unevidenced')
  })

  it('passes a registry whose entries are all holds', () => {
    const { violations } = audit(
      { version: 1, entries: [entry()] },
      { ...context, histories: [historyFor([['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']])] },
    )

    expect(violations).toEqual([])
  })

  it('reports a window longer than the policy allows', () => {
    const { violations } = audit(
      { version: 1, entries: [entry({ addedOn: '2026-01-01', expiresOn: '2026-12-01' })] },
      { ...context, histories: [historyFor([['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']])] },
    )

    expect(violations.join('\n')).toContain(`limit ${String(DEFAULT_QUARANTINE_POLICY.maximumDays)}`)
  })

  it('reports an expiry that is not after the date the entry was added', () => {
    const { violations } = audit({ version: 1, entries: [entry({ expiresOn: '2026-10-01' })] }, context)

    expect(violations.join('\n')).toContain('is not after')
  })

  it('reports a registry with more entries than the policy allows', () => {
    const entries = Array.from({ length: DEFAULT_QUARANTINE_POLICY.maximumEntries + 1 }, (_unused, index) =>
      entry({ name: `test ${String(index)}` }),
    )

    const { violations } = audit({ version: 1, entries }, context)

    expect(violations.join('\n')).toContain('nobody trusts')
  })

  it('returns one judgement per entry, in order', () => {
    const entries = [entry({ name: 'one' }), entry({ name: 'two' })]
    const { judgements } = audit({ version: 1, entries }, context)

    expect(judgements.map((judgement) => judgement.entry.name)).toEqual(['one', 'two'])
  })

  it('passes an empty registry', () => {
    expect(audit({ version: 1, entries: [] }, context).violations).toEqual([])
  })
})

describe('isQuarantined', () => {
  const registry = { version: 1 as const, entries: [entry()] }

  it('matches on module and name together', () => {
    expect(isQuarantined(registry, entry().module, entry().name)).toBe(true)
  })

  it('does not match the same name in another file', () => {
    expect(isQuarantined(registry, 'other/file.test.ts', entry().name)).toBe(false)
  })

  it('does not match a name decorated with a tag', () => {
    // The registry is the only marker. A test whose title was edited to carry
    // `@flaky` is, as far as every report is concerned, a different test —
    // which is the whole argument of `identity.ts`.
    expect(isQuarantined(registry, entry().module, `${entry().name} @flaky`)).toBe(false)
  })
})

describe('this repository’s registry', () => {
  it('parses', () => {
    expect(() => loadRegistry()).not.toThrow()
  })

  it('is the file flake:check reads', () => {
    expect(parseRegistry(readFileSync(registryPath(), 'utf8'))).toEqual(loadRegistry())
  })

  it('stays within the size the policy allows', () => {
    expect(loadRegistry().entries.length).toBeLessThanOrEqual(DEFAULT_QUARANTINE_POLICY.maximumEntries)
  })

  it('gives every entry a window no longer than the policy allows', () => {
    const windows = loadRegistry().entries.map((candidate) => ({
      key: keyOf(candidate),
      days: Math.round((Date.parse(candidate.expiresOn) - Date.parse(candidate.addedOn)) / 86_400_000),
    }))

    expect(windows.filter(({ days }) => days <= 0 || days > DEFAULT_QUARANTINE_POLICY.maximumDays)).toEqual([])
  })

  // Whether an entry has *reached* its expiry is deliberately not asked here.
  // It is the one question about the registry that depends on today's date, and
  // `pnpm flake:check` asks it — a CI step, where the two other inputs it needs
  // (the attempt history and the collected test names) also live. Asking it in
  // the unit suite would make `pnpm test` go red one morning with no commit
  // behind it, which is a worse way to find out than a gate whose output says
  // which entry expired and what to do about it.
})
