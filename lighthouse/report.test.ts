import { describe, expect, it } from 'vitest'

import { budgetLines, type Budget } from './budgets.ts'
import { loadBudgets } from './load.ts'
import {
  asKib,
  buildBudgetReport,
  formatCeiling,
  formatValue,
  joinBudgetResults,
  lineLabel,
  nonBudgetFailures,
  parseAssertionResults,
  resultAssertionId,
  type AssertionResult,
} from './report.ts'

const budgets: Budget[] = [
  {
    path: '/*',
    timings: [{ metric: 'total-blocking-time', budget: 300 }],
    resourceCounts: [{ resourceType: 'script', budget: 10 }],
    resourceSizes: [{ resourceType: 'script', budget: 300 }],
  },
]

const result = (overrides: Partial<AssertionResult> = {}): AssertionResult => ({
  name: 'maxNumericValue',
  expected: 300,
  actual: 100,
  operator: '<=',
  passed: true,
  auditId: 'total-blocking-time',
  level: 'error',
  url: 'http://localhost/',
  ...overrides,
})

describe('resultAssertionId', () => {
  it('returns the audit id when there is no property', () => {
    expect(resultAssertionId(result({ auditId: 'speed-index' }))).toBe('speed-index')
  })

  // The separator trap: an assertion is *written* with colons, and comes back
  // with the property dot-separated.
  it('rejoins a dotted auditProperty with colons', () => {
    expect(
      resultAssertionId(result({ auditId: 'resource-summary', auditProperty: 'script.size' })),
    ).toBe('resource-summary:script:size')
  })

  it('handles a single-segment property, as categories uses', () => {
    expect(
      resultAssertionId(result({ auditId: 'categories', auditProperty: 'accessibility' })),
    ).toBe('categories:accessibility')
  })
})

describe('joinBudgetResults', () => {
  it('returns one row per budget line, in file order', () => {
    const rows = joinBudgetResults(budgets, [])

    expect(rows).toHaveLength(budgetLines(budgets).length)
    expect(rows.map((row) => row.id)).toEqual([
      'total-blocking-time',
      'resource-summary:script:count',
      'resource-summary:script:size',
    ])
  })

  // The failure this module exists to prevent: an empty results file must not
  // render as a clean run.
  it('scores a line with no result as not-measured, never as passed', () => {
    const rows = joinBudgetResults(budgets, [])

    expect(rows.map((row) => row.status)).toEqual([
      'not-measured',
      'not-measured',
      'not-measured',
    ])
    expect(rows.every((row) => row.actual === null)).toBe(true)
  })

  it('scores a passing result as passed and carries its measurement', () => {
    const rows = joinBudgetResults(budgets, [result({ passed: true, actual: 42 })])
    const row = rows.find((entry) => entry.id === 'total-blocking-time')

    expect(row?.status).toBe('passed')
    expect(row?.actual).toBe(42)
  })

  it('scores a failing result as breached', () => {
    const rows = joinBudgetResults(budgets, [result({ passed: false, actual: 900 })])

    expect(rows.find((entry) => entry.id === 'total-blocking-time')?.status).toBe('breached')
  })

  it('converts a size ceiling to bytes so it is comparable with the measurement', () => {
    const row = joinBudgetResults(budgets, [])
      .find((entry) => entry.id === 'resource-summary:script:size')

    expect(row?.ceiling).toBe(307_200)
  })

  // Several URLs produce several rows for one assertion. A page that breaches
  // must not be hidden behind a sibling that does not.
  it('keeps the worst result when two URLs disagree', () => {
    const rows = joinBudgetResults(budgets, [
      result({ passed: true, actual: 10, url: 'http://localhost/a' }),
      result({ passed: false, actual: 900, url: 'http://localhost/b' }),
    ])
    const row = rows.find((entry) => entry.id === 'total-blocking-time')

    expect(row?.status).toBe('breached')
    expect(row?.url).toBe('http://localhost/b')
  })

  it('keeps the breach whichever order the URLs arrive in', () => {
    const rows = joinBudgetResults(budgets, [
      result({ passed: false, actual: 900, url: 'http://localhost/b' }),
      result({ passed: true, actual: 10, url: 'http://localhost/a' }),
    ])

    expect(rows.find((entry) => entry.id === 'total-blocking-time')?.status).toBe('breached')
  })

  it('carries the documentation link through when LHCI supplies one', () => {
    const rows = joinBudgetResults(budgets, [
      result({ auditDocumentationLink: 'https://example.invalid/tbt' }),
    ])

    expect(rows.find((entry) => entry.id === 'total-blocking-time')?.documentationLink).toBe(
      'https://example.invalid/tbt',
    )
  })

  it('ignores a result for an assertion that is not a budget line', () => {
    const rows = joinBudgetResults(budgets, [
      result({ auditId: 'categories', auditProperty: 'seo', passed: false }),
    ])

    expect(rows.every((row) => row.status === 'not-measured')).toBe(true)
  })
})

describe('nonBudgetFailures', () => {
  it('returns failing assertions that no budget line claims', () => {
    const failures = nonBudgetFailures(budgets, [
      result({ auditId: 'categories', auditProperty: 'accessibility', passed: false }),
      result({ passed: false }),
    ])

    expect(failures.map(resultAssertionId)).toEqual(['categories:accessibility'])
  })

  it('ignores passing non-budget assertions', () => {
    expect(
      nonBudgetFailures(budgets, [
        result({ auditId: 'categories', auditProperty: 'seo', passed: true }),
      ]),
    ).toEqual([])
  })
})

describe('buildBudgetReport', () => {
  it('counts each status', () => {
    const report = buildBudgetReport(budgets, [
      result({ passed: true }),
      result({ auditId: 'resource-summary', auditProperty: 'script.count', passed: false }),
    ])

    expect(report.passed).toBe(1)
    expect(report.breached).toBe(1)
    expect(report.notMeasured).toBe(1)
  })

  it('is not ok when a line breached', () => {
    expect(buildBudgetReport(budgets, [result({ passed: false })]).ok).toBe(false)
  })

  it('is not ok when a line went unmeasured, even with nothing breached', () => {
    expect(buildBudgetReport(budgets, []).ok).toBe(false)
  })

  it('is not ok when a non-budget assertion failed', () => {
    const everyLine = budgetLines(budgets).map((line, index) =>
      result({
        passed: true,
        auditId: line.kind === 'timing' ? line.metric : 'resource-summary',
        ...(line.kind === 'timing'
          ? {}
          : { auditProperty: `${line.resourceType}.${line.kind}` }),
        actual: index,
      }),
    )

    const report = buildBudgetReport(budgets, [
      ...everyLine,
      result({ auditId: 'categories', auditProperty: 'seo', passed: false }),
    ])

    expect(report.breached).toBe(0)
    expect(report.notMeasured).toBe(0)
    expect(report.ok).toBe(false)
  })

  it('is ok only when every line passed and nothing else failed', () => {
    const everyLine = budgetLines(budgets).map((line) =>
      result({
        passed: true,
        auditId: line.kind === 'timing' ? line.metric : 'resource-summary',
        ...(line.kind === 'timing'
          ? {}
          : { auditProperty: `${line.resourceType}.${line.kind}` }),
      }),
    )

    expect(buildBudgetReport(budgets, everyLine).ok).toBe(true)
  })
})

describe('parseAssertionResults', () => {
  it('parses an array of results', () => {
    expect(parseAssertionResults('[]', 'x.json')).toEqual([])
  })

  it('names the file in the error when the JSON is malformed', () => {
    expect(() => parseAssertionResults('{', '/tmp/x.json')).toThrow('/tmp/x.json')
  })

  it('rejects valid JSON that is not an array', () => {
    expect(() => parseAssertionResults('{"a":1}', '/tmp/x.json')).toThrow('array')
  })
})

describe('formatting', () => {
  it('reports a size in KiB, the unit the budget is written in', () => {
    expect(asKib(307_200)).toBe('300.0 KiB')
  })

  it('reports a timing in whole milliseconds', () => {
    expect(
      formatValue({ kind: 'timing', path: '/*', metric: 'speed-index', budget: 1 }, 2710.49),
    ).toBe('2710 ms')
  })

  it('reports CLS to three decimals, because it is unitless and small', () => {
    expect(
      formatValue(
        { kind: 'timing', path: '/*', metric: 'cumulative-layout-shift', budget: 1 },
        0.0812,
      ),
    ).toBe('0.081')
  })

  it('reports a count as a whole number', () => {
    expect(formatValue({ kind: 'count', path: '/*', resourceType: 'script', budget: 1 }, 3)).toBe(
      '3',
    )
  })

  it('formats a ceiling in the same units as the measurement', () => {
    expect(formatCeiling({ kind: 'size', path: '/*', resourceType: 'script', budget: 300 })).toBe(
      '300.0 KiB',
    )
  })

  it('labels a resource line with its type and kind', () => {
    expect(lineLabel({ kind: 'size', path: '/*', resourceType: 'stylesheet', budget: 1 })).toBe(
      'stylesheet size',
    )
    expect(lineLabel({ kind: 'count', path: '/*', resourceType: 'image', budget: 1 })).toBe(
      'image count',
    )
  })

  it('labels a timing line with the metric itself', () => {
    expect(lineLabel({ kind: 'timing', path: '/*', metric: 'interactive', budget: 1 })).toBe(
      'interactive',
    )
  })
})

describe('the published budgets', () => {
  it('produce a report with a row for every line, from no results at all', () => {
    const published = loadBudgets()
    const report = buildBudgetReport(published, [])

    expect(report.rows).toHaveLength(budgetLines(published).length)
    expect(report.notMeasured).toBe(budgetLines(published).length)
    expect(report.ok).toBe(false)
  })
})
