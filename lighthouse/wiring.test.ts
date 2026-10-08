import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { budgetAssertions, budgetLines, type Budget } from './budgets.ts'
import { loadBudgets } from './load.ts'
import {
  DEAD_BUDGET_ASSERTION,
  DEAD_TIMING_ASSERTION,
  findWiringProblems,
  formatWiringProblem,
  mergeAssertions,
  PUBLISHED_WIRING,
  REMOVED_BUDGET_AUDITS,
  WIRING_CASES,
  type LighthouseRc,
} from './wiring.ts'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** The real published config, loaded the way LHCI loads it. */
const publishedRc = require(join(here, 'lighthouserc.cjs')) as LighthouseRc

const budgets = loadBudgets()

/** A config that enforces the budgets correctly, for mutating in tests. */
function goodRc(budgetFile: readonly Budget[] = budgets): LighthouseRc {
  return {
    ci: {
      collect: { settings: { chromeFlags: '--headless=new' }, url: ['http://localhost/'] },
      assert: {
        assertions: budgetAssertions(budgetFile) as Record<string, unknown>,
        includePassedAssertions: true,
      },
    },
  }
}

describe('findWiringProblems', () => {
  it('passes a config that asserts every budget line at error', () => {
    expect(findWiringProblems(goodRc(), budgets)).toEqual([])
  })

  it('flags budgets left in ci.collect.settings', () => {
    const rc = goodRc()
    const problems = findWiringProblems(
      {
        ci: {
          ...rc.ci,
          collect: { ...rc.ci?.collect, settings: { budgets: budgets as unknown } },
        },
      },
      budgets,
    )

    expect(problems).toContainEqual({ kind: 'budgets-in-collect-settings' })
  })

  it.each(REMOVED_BUDGET_AUDITS)('flags an assertion on the removed %s audit', (auditId) => {
    const rc = goodRc()
    const problems = findWiringProblems(
      {
        ci: {
          ...rc.ci,
          assert: {
            ...rc.ci?.assert,
            assertions: { ...rc.ci?.assert?.assertions, [auditId]: ['error', {}] },
          },
        },
      },
      budgets,
    )

    expect(problems).toContainEqual({ kind: 'removed-audit-assertion', auditId })
  })

  it('flags a budget line that no assertion enforces', () => {
    const assertions = { ...budgetAssertions(budgets) } as Record<string, unknown>
    delete assertions['resource-summary:script:size']

    const problems = findWiringProblems(
      { ci: { assert: { assertions, includePassedAssertions: true } } },
      budgets,
    )

    expect(problems).toEqual([
      { kind: 'budget-line-unasserted', assertionId: 'resource-summary:script:size' },
    ])
  })

  it('flags a ceiling in kB where the budget is KiB', () => {
    const assertions = { ...budgetAssertions(budgets) } as Record<string, unknown>
    // 300 kB rather than 300 KiB: the mistake is 7_200 bytes and invisible.
    assertions['resource-summary:script:size'] = ['error', { maxNumericValue: 300_000 }]

    const problems = findWiringProblems(
      { ci: { assert: { assertions, includePassedAssertions: true } } },
      budgets,
    )

    expect(problems).toEqual([
      {
        kind: 'budget-line-wrong-ceiling',
        assertionId: 'resource-summary:script:size',
        expected: 307_200,
        found: 300_000,
      },
    ])
  })

  it('flags a budget demoted to a warning', () => {
    const assertions = { ...budgetAssertions(budgets) } as Record<string, unknown>
    assertions['total-blocking-time'] = ['warn', { maxNumericValue: 300 }]

    const problems = findWiringProblems(
      { ci: { assert: { assertions, includePassedAssertions: true } } },
      budgets,
    )

    expect(problems).toEqual([
      { kind: 'budget-line-not-error', assertionId: 'total-blocking-time', level: 'warn' },
    ])
  })

  it('flags a missing includePassedAssertions, which empties the PR comment', () => {
    const problems = findWiringProblems(
      { ci: { assert: { assertions: budgetAssertions(budgets) as Record<string, unknown> } } },
      budgets,
    )

    expect(problems).toEqual([{ kind: 'passed-assertions-excluded' }])
  })

  it('flags an assert block that asserts nothing at all', () => {
    expect(findWiringProblems({ ci: { assert: {} } }, budgets)).toEqual([
      { kind: 'no-assertions-at-all' },
    ])
  })

  it('accepts budgetsFile without auditing it line by line', () => {
    // A working wiring this repository does not publish. It cannot be checked
    // from here — LHCI does the conversion internally — so it is not reported
    // as broken either.
    expect(findWiringProblems({ ci: { assert: { budgetsFile: './budgets.json' } } }, budgets)).toEqual(
      [],
    )
  })

  it('reports every problem rather than stopping at the first', () => {
    const problems = findWiringProblems(
      {
        ci: {
          collect: { settings: { budgets: budgets as unknown } },
          assert: { assertions: { [DEAD_BUDGET_ASSERTION]: ['error', {}] } },
        },
      },
      budgets,
    )

    const kinds = problems.map((problem) => problem.kind)
    expect(kinds).toContain('budgets-in-collect-settings')
    expect(kinds).toContain('removed-audit-assertion')
    expect(kinds).toContain('passed-assertions-excluded')
    expect(kinds).toContain('budget-line-unasserted')
  })
})

describe('formatWiringProblem', () => {
  it('explains why the settings wiring does nothing', () => {
    const message = formatWiringProblem({ kind: 'budgets-in-collect-settings' })

    expect(message).toContain('Lighthouse 12 ignores it')
    expect(message).toContain('wiring.ts')
  })

  it('says the removed-audit assertion always passes', () => {
    expect(
      formatWiringProblem({ kind: 'removed-audit-assertion', auditId: DEAD_BUDGET_ASSERTION }),
    ).toContain('always passes')
  })

  it('reminds the reader that sizes are KiB', () => {
    expect(
      formatWiringProblem({
        kind: 'budget-line-wrong-ceiling',
        assertionId: 'resource-summary:script:size',
        expected: 307_200,
        found: 300_000,
      }),
    ).toContain('KiB')
  })

  it('names the assertion for every problem kind', () => {
    const problems = [
      { kind: 'budget-line-unasserted', assertionId: 'speed-index' },
      { kind: 'budget-line-not-error', assertionId: 'speed-index', level: 'warn' },
      {
        kind: 'budget-line-wrong-ceiling',
        assertionId: 'speed-index',
        expected: 1,
        found: 2,
      },
    ] as const

    for (const problem of problems) {
      expect(formatWiringProblem(problem)).toContain('speed-index')
    }
  })
})

describe('mergeAssertions', () => {
  it('lets a budget win over a quality assertion naming the same audit', () => {
    const merged = mergeAssertions(
      { 'total-blocking-time': ['warn', { maxNumericValue: 9_999 }] },
      budgets,
    )

    expect(merged['total-blocking-time']).toEqual(['error', { maxNumericValue: 300 }])
  })

  it('keeps a quality assertion that no budget line names', () => {
    const merged = mergeAssertions({ 'categories:accessibility': ['error', { minScore: 0.9 }] }, budgets)

    expect(merged['categories:accessibility']).toEqual(['error', { minScore: 0.9 }])
  })
})

describe('WIRING_CASES', () => {
  it('records the published wiring', () => {
    expect(WIRING_CASES.map((wiring) => wiring.id)).toContain(PUBLISHED_WIRING)
  })

  it('says the published wiring gates', () => {
    expect(WIRING_CASES.find((wiring) => wiring.id === PUBLISHED_WIRING)?.gates).toBe(true)
  })

  it('documents at least one wiring that looks right and does nothing', () => {
    // The directory exists for these. If they ever all gate, the finding is
    // obsolete and the README should say so rather than keep warning.
    expect(WIRING_CASES.filter((wiring) => !wiring.gates).length).toBeGreaterThan(0)
  })

  it('gives every wiring a reason, not just a verdict', () => {
    for (const wiring of WIRING_CASES) {
      expect(wiring.because.length).toBeGreaterThan(20)
      expect(wiring.label.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// The real config — the assertion this module exists for
// ---------------------------------------------------------------------------
describe('lighthouse/lighthouserc.cjs', () => {
  it('enforces every line of budgets.json, at error, with the right ceiling', () => {
    expect(findWiringProblems(publishedRc, budgets).map(formatWiringProblem)).toEqual([])
  })

  it('does not put budgets in ci.collect.settings', () => {
    expect(publishedRc.ci?.collect?.settings).not.toHaveProperty('budgets')
  })

  it('does not assert on either removed budget audit', () => {
    for (const auditId of [DEAD_BUDGET_ASSERTION, DEAD_TIMING_ASSERTION]) {
      expect(publishedRc.ci?.assert?.assertions).not.toHaveProperty(auditId)
    }
  })

  it('asks for the passing rows, which the PR comment needs', () => {
    expect(publishedRc.ci?.assert?.includePassedAssertions).toBe(true)
  })

  it('does not also set budgetsFile, which LHCI refuses to combine with assertions', () => {
    // LHCI throws "Cannot use both budgets AND assertions" — a hard failure
    // rather than a silent one, but still a config nobody can run.
    expect(publishedRc.ci?.assert?.budgetsFile).toBeUndefined()
  })

  it('collects more than one run, because one run is not a measurement', () => {
    expect(publishedRc.ci?.collect?.numberOfRuns ?? 1).toBeGreaterThan(1)
  })

  it('audits at least one URL', () => {
    expect(publishedRc.ci?.collect?.url?.length ?? 0).toBeGreaterThan(0)
  })

  it('enforces more than the budgets alone', () => {
    // The quality assertions are the reason this config derives its budget
    // assertions instead of using `budgetsFile`. If they ever go away, so does
    // the justification.
    const asserted = Object.keys(publishedRc.ci?.assert?.assertions ?? {})
    const budgetIds = new Set(Object.keys(budgetAssertions(budgets)))

    expect(asserted.filter((id) => !budgetIds.has(id)).length).toBeGreaterThan(0)
  })

  it('enforces exactly as many budget rows as budgets.json has lines', () => {
    const asserted = Object.keys(publishedRc.ci?.assert?.assertions ?? {})
    const budgetIds = new Set(Object.keys(budgetAssertions(budgets)))

    expect(asserted.filter((id) => budgetIds.has(id))).toHaveLength(budgetLines(budgets).length)
  })
})
