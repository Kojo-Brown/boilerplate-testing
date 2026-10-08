import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import {
  assertedCeiling,
  assertionId,
  budgetAssertions,
  budgetLines,
  findBudgetProblems,
  formatBudgetProblem,
  KIB,
  RESOURCE_TYPES,
  TIMING_METRICS,
  type Budget,
} from './budgets.ts'
import { loadBudgets } from './load.ts'

/**
 * LHCI's own modules, reached through LHCI's resolution root.
 *
 * `@lhci/utils` is a transitive dependency, and pnpm's node_modules layout does
 * not make a transitive dependency resolvable from the repository root — so a
 * plain `require('@lhci/utils/...')` fails with MODULE_NOT_FOUND here while
 * working fine in a hoisted install. Seeding `createRequire` with `@lhci/cli`'s
 * own path asks the question from where the answer exists.
 */
const lhciRequire = createRequire(createRequire(import.meta.url).resolve('@lhci/cli/src/cli.js'))

interface BudgetsConverter {
  convertBudgetsToAssertions(budgets: readonly Budget[]): Promise<{
    assertMatrix: { assertions: Record<string, [string, Record<string, number>]> }[]
  }>
}

const converter = lhciRequire('@lhci/utils/src/budgets-converter.js') as BudgetsConverter

const budget = (overrides: Partial<Budget> = {}): Budget => ({
  path: '/*',
  timings: [{ metric: 'first-contentful-paint', budget: 2000 }],
  ...overrides,
})

describe('findBudgetProblems', () => {
  it('passes a budget whose every line names something real', () => {
    expect(findBudgetProblems([budget()])).toEqual([])
  })

  it('rejects a timing metric this repository does not vouch for', () => {
    const problems = findBudgetProblems([
      // `first-meaningful-paint` is accepted by LHCI and reports no numeric
      // value under Lighthouse 12; see the note in budgets.ts.
      budget({ timings: [{ metric: 'first-meaningful-paint' as never, budget: 1000 }] }),
    ])

    expect(problems).toEqual([
      { kind: 'unknown-metric', path: '/*', metric: 'first-meaningful-paint' },
    ])
  })

  it('rejects a resource type the resource summary does not report', () => {
    const problems = findBudgetProblems([
      budget({ resourceSizes: [{ resourceType: 'webfont' as never, budget: 50 }] }),
    ])

    expect(problems).toEqual([
      {
        kind: 'unknown-resource-type',
        path: '/*',
        group: 'resourceSizes',
        resourceType: 'webfont',
      },
    ])
  })

  it('rejects a negative budget', () => {
    const problems = findBudgetProblems([
      budget({ timings: [{ metric: 'speed-index', budget: -1 }] }),
    ])

    expect(problems).toEqual([
      { kind: 'negative-budget', path: '/*', subject: 'speed-index', budget: -1 },
    ])
  })

  it('accepts a zero budget, which is how a count is forbidden outright', () => {
    expect(
      findBudgetProblems([
        budget({ timings: [], resourceCounts: [{ resourceType: 'third-party', budget: 0 }] }),
      ]),
    ).toEqual([])
  })

  it('reports a line budgeted twice, because the later one silently wins', () => {
    const problems = findBudgetProblems([
      budget({
        timings: [],
        resourceSizes: [
          { resourceType: 'script', budget: 300 },
          { resourceType: 'script', budget: 900 },
        ],
      }),
    ])

    expect(problems).toEqual([
      { kind: 'duplicate', path: '/*', subject: 'resourceSizes:script' },
    ])
  })

  it('does not confuse a size and a count for the same resource type', () => {
    expect(
      findBudgetProblems([
        budget({
          timings: [],
          resourceSizes: [{ resourceType: 'script', budget: 300 }],
          resourceCounts: [{ resourceType: 'script', budget: 10 }],
        }),
      ]),
    ).toEqual([])
  })

  it('reports a group that budgets nothing', () => {
    expect(findBudgetProblems([{ path: '/empty' }])).toEqual([
      { kind: 'empty-budget-group', path: '/empty' },
    ])
  })

  it('reports problems per group, so one bad group does not mask another', () => {
    const problems = findBudgetProblems([
      budget({ path: '/a', timings: [{ metric: 'nope' as never, budget: 1 }] }),
      budget({ path: '/b', timings: [{ metric: 'also-nope' as never, budget: 1 }] }),
    ])

    expect(problems.map((problem) => problem.path)).toEqual(['/a', '/b'])
  })
})

describe('formatBudgetProblem', () => {
  it('names the offending metric and what to do about it', () => {
    const message = formatBudgetProblem({ kind: 'unknown-metric', path: '/*', metric: 'ttfb' })

    expect(message).toContain('/*')
    expect(message).toContain('ttfb')
    expect(message).toContain('TIMING_METRICS')
  })

  it('explains that a duplicate is silently resolved rather than rejected', () => {
    expect(
      formatBudgetProblem({ kind: 'duplicate', path: '/*', subject: 'resourceSizes:script' }),
    ).toContain('silently wins')
  })
})

describe('budgetLines', () => {
  it('flattens a group into one row per line', () => {
    const lines = budgetLines([
      budget({
        resourceCounts: [{ resourceType: 'script', budget: 10 }],
        resourceSizes: [{ resourceType: 'script', budget: 300 }],
      }),
    ])

    expect(lines.map((line) => line.kind)).toEqual(['timing', 'count', 'size'])
  })

  it('keeps timings, then counts, then sizes — LHCI’s own order', () => {
    const lines = budgetLines(loadBudgets())
    const kinds = lines.map((line) => line.kind)
    const firstSize = kinds.indexOf('size')
    const lastCount = kinds.lastIndexOf('count')

    expect(kinds.lastIndexOf('timing')).toBeLessThan(kinds.indexOf('count'))
    expect(lastCount).toBeLessThan(firstSize)
  })
})

describe('assertionId', () => {
  it('uses the metric itself for a timing', () => {
    expect(assertionId({ kind: 'timing', path: '/*', metric: 'speed-index', budget: 1 })).toBe(
      'speed-index',
    )
  })

  it('writes a resource assertion with colons, which is how LHCI reads a key', () => {
    expect(assertionId({ kind: 'size', path: '/*', resourceType: 'script', budget: 1 })).toBe(
      'resource-summary:script:size',
    )
    expect(assertionId({ kind: 'count', path: '/*', resourceType: 'image', budget: 1 })).toBe(
      'resource-summary:image:count',
    )
  })
})

describe('assertedCeiling', () => {
  it('multiplies a size budget by 1024, because budget sizes are KiB', () => {
    expect(assertedCeiling({ kind: 'size', path: '/*', resourceType: 'script', budget: 300 })).toBe(
      307_200,
    )
  })

  it('leaves a count alone', () => {
    expect(assertedCeiling({ kind: 'count', path: '/*', resourceType: 'script', budget: 10 })).toBe(
      10,
    )
  })

  it('leaves a timing alone — milliseconds are the audit’s own unit', () => {
    expect(
      assertedCeiling({ kind: 'timing', path: '/*', metric: 'total-blocking-time', budget: 300 }),
    ).toBe(300)
  })

  it('uses KiB and not kB, a 7.2% difference at a 300-unit budget', () => {
    const asKib = 300 * KIB
    const asKb = 300 * 1000
    expect(asKib - asKb).toBe(7_200)
  })
})

describe('budgetAssertions', () => {
  it('puts every line at error, because a warning is not a budget', () => {
    const assertions = budgetAssertions(loadBudgets())
    const levels = [...new Set(Object.values(assertions).map(([level]) => level))]

    expect(levels).toEqual(['error'])
  })

  it('produces one assertion per budget line', () => {
    const budgets = loadBudgets()
    expect(Object.keys(budgetAssertions(budgets))).toHaveLength(budgetLines(budgets).length)
  })

  // The assertion this module exists for. LHCI's converter is the definition of
  // what a budget line means; if this repository's copy drifts from it, the
  // published config enforces something other than what budgets.json says.
  it('agrees with LHCI’s own converter on the real budget file', async () => {
    const budgets = loadBudgets()
    const theirs = await converter.convertBudgetsToAssertions(budgets)

    expect(theirs.assertMatrix).toHaveLength(budgets.length)
    expect(budgetAssertions(budgets)).toEqual(theirs.assertMatrix[0]?.assertions)
  })

  it('agrees with LHCI’s converter on a budget using every resource type', async () => {
    const everything: Budget[] = [
      {
        path: '/*',
        // Every metric, CLS included: it is unitless where the others are
        // milliseconds, and LHCI converts it identically — which is worth
        // holding rather than assuming.
        timings: TIMING_METRICS.map((metric, index) => ({
          metric,
          budget: (index + 1) * 100,
        })),
        resourceSizes: RESOURCE_TYPES.map((resourceType, index) => ({
          resourceType,
          budget: (index + 1) * 11,
        })),
        resourceCounts: RESOURCE_TYPES.map((resourceType, index) => ({
          resourceType,
          budget: index + 1,
        })),
      },
    ]

    const theirs = await converter.convertBudgetsToAssertions(everything)

    expect(budgetAssertions(everything)).toEqual(theirs.assertMatrix[0]?.assertions)
  })
})

describe('the published budget file', () => {
  it('loads and validates', () => {
    expect(() => loadBudgets()).not.toThrow()
  })

  it('names only metrics LHCI’s validator still accepts', () => {
    // LHCI carries a copy of Lighthouse's old budget validation and throws on a
    // metric outside it. TIMING_METRICS must stay a subset, or `budgetsFile` —
    // a wiring this repository documents as working — stops working.
    const theirs: readonly string[] = [
      'first-contentful-paint',
      'interactive',
      'first-meaningful-paint',
      'max-potential-fid',
      'total-blocking-time',
      'speed-index',
      'largest-contentful-paint',
      'cumulative-layout-shift',
    ]

    expect(TIMING_METRICS.filter((metric) => !theirs.includes(metric))).toEqual([])
  })

  it('excludes first-meaningful-paint, which LHCI accepts and Lighthouse does not measure', () => {
    expect(TIMING_METRICS).not.toContain('first-meaningful-paint')
  })

  it('declares the resource types Lighthouse’s resource summary reports, and no others', () => {
    const theirs = [
      'total',
      'document',
      'script',
      'stylesheet',
      'image',
      'media',
      'font',
      'other',
      'third-party',
    ]

    expect([...RESOURCE_TYPES].sort()).toEqual([...theirs].sort())
  })

  it('budgets at least one timing and one resource size', () => {
    // A budget file that had drifted to timings only would still pass every
    // other test here while enforcing nothing about payload.
    const kinds = new Set(budgetLines(loadBudgets()).map((line) => line.kind))

    expect(kinds).toContain('timing')
    expect(kinds).toContain('size')
    expect(kinds).toContain('count')
  })
})
