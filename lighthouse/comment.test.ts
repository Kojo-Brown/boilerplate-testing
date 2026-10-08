import { describe, expect, it } from 'vitest'

import type { Budget } from './budgets.ts'
import {
  headline,
  headroom,
  MAX_COMMENT_LENGTH,
  renderComment,
  STICKY_MARKER,
  truncate,
  type CommentContext,
} from './comment.ts'
import { buildBudgetReport, type AssertionResult } from './report.ts'

const budgets: Budget[] = [
  {
    path: '/*',
    timings: [{ metric: 'total-blocking-time', budget: 300 }],
    resourceSizes: [{ resourceType: 'script', budget: 300 }],
  },
]

const context: CommentContext = {
  sha: 'abc1234',
  runs: 3,
  urls: ['http://localhost/'],
}

const tbt = (passed: boolean, actual: number): AssertionResult => ({
  name: 'maxNumericValue',
  expected: 300,
  actual,
  operator: '<=',
  passed,
  auditId: 'total-blocking-time',
  level: 'error',
  url: 'http://localhost/',
})

const scriptSize = (passed: boolean, actual: number): AssertionResult => ({
  name: 'maxNumericValue',
  expected: 307_200,
  actual,
  operator: '<=',
  passed,
  auditId: 'resource-summary',
  auditProperty: 'script.size',
  level: 'error',
  url: 'http://localhost/',
})

const cleanReport = (): ReturnType<typeof buildBudgetReport> =>
  buildBudgetReport(budgets, [tbt(true, 40), scriptSize(true, 102_400)])

describe('headroom', () => {
  it('reports how far under a passing row is', () => {
    const row = cleanReport().rows[0]
    expect(row).toBeDefined()
    expect(headroom(row!)).toBeCloseTo(86.7, 1)
  })

  it('goes negative for a breach', () => {
    const report = buildBudgetReport(budgets, [tbt(false, 600)])
    expect(headroom(report.rows[0]!)).toBeCloseTo(-100, 1)
  })

  it('is null when nothing measured the row', () => {
    const report = buildBudgetReport(budgets, [])
    expect(headroom(report.rows[0]!)).toBeNull()
  })

  it('is null for a zero ceiling rather than dividing by it', () => {
    const zero = buildBudgetReport(
      [{ path: '/*', resourceCounts: [{ resourceType: 'third-party', budget: 0 }] }],
      [
        {
          name: 'maxNumericValue',
          expected: 0,
          actual: 0,
          operator: '<=',
          passed: true,
          auditId: 'resource-summary',
          auditProperty: 'third-party.count',
          level: 'error',
          url: 'http://localhost/',
        },
      ],
    )

    expect(headroom(zero.rows[0]!)).toBeNull()
  })
})

describe('headline', () => {
  it('leads with the breach count', () => {
    expect(headline(buildBudgetReport(budgets, [tbt(false, 600), scriptSize(false, 900_000)]))).toContain(
      '2 budgets over limit',
    )
  })

  it('uses the singular for one breach', () => {
    const report = buildBudgetReport(budgets, [tbt(false, 600), scriptSize(true, 1)])
    expect(headline(report)).toContain('1 budget over limit')
  })

  it('says every budget was met on a clean run', () => {
    expect(headline(cleanReport())).toContain('Every budget met')
  })

  // The distinction the whole module exists for.
  it('does not claim success when rows went unmeasured', () => {
    const headlineText = headline(buildBudgetReport(budgets, []))

    expect(headlineText).not.toContain('Every budget met')
    expect(headlineText).toContain('not measured')
  })

  it('reports other failures even when every budget passed', () => {
    const report = buildBudgetReport(budgets, [
      tbt(true, 10),
      scriptSize(true, 10),
      {
        name: 'minScore',
        expected: 0.9,
        actual: 0.4,
        operator: '>=',
        passed: false,
        auditId: 'categories',
        auditProperty: 'accessibility',
        level: 'error',
        url: 'http://localhost/',
      },
    ])

    expect(headline(report)).toContain('other assertion')
  })
})

describe('renderComment', () => {
  it('starts with the sticky marker, so the next run updates rather than appends', () => {
    expect(renderComment(cleanReport(), context).startsWith(STICKY_MARKER)).toBe(true)
  })

  // Changing the marker orphans every comment already posted.
  it('pins the marker literal', () => {
    expect(STICKY_MARKER).toBe('<!-- lighthouse-budgets -->')
  })

  it('puts breaches above the fold, outside the collapsed section', () => {
    const body = renderComment(buildBudgetReport(budgets, [tbt(false, 600), scriptSize(true, 1)]), context)
    const breachRow = body.indexOf('❌ total-blocking-time')
    const details = body.indexOf('<details')

    expect(breachRow).toBeGreaterThan(-1)
    expect(breachRow).toBeLessThan(details)
  })

  it('collapses the full table on a clean run', () => {
    const body = renderComment(cleanReport(), context)

    expect(body).toContain('<details>')
    expect(body).not.toContain('<details open>')
  })

  it('opens the full table when there is something wrong', () => {
    expect(renderComment(buildBudgetReport(budgets, [tbt(false, 600)]), context)).toContain(
      '<details open>',
    )
  })

  it('reports headroom on a clean run, which is what the check cannot say', () => {
    const body = renderComment(cleanReport(), context)

    expect(body).toContain('under')
    expect(body).toContain('headroom')
  })

  it('shows a breach as a percentage over, not as negative headroom', () => {
    const body = renderComment(buildBudgetReport(budgets, [tbt(false, 600)]), context)

    expect(body).toContain('% over')
    expect(body).not.toContain('-100% under')
  })

  it('gives unmeasured rows their own section and explains them', () => {
    const body = renderComment(buildBudgetReport(budgets, []), context)

    expect(body).toContain('_not measured_')
    expect(body).toContain('did not run')
  })

  it('lists failing non-budget assertions separately from the budget table', () => {
    const body = renderComment(
      buildBudgetReport(budgets, [
        tbt(true, 1),
        scriptSize(true, 1),
        {
          name: 'minScore',
          expected: 0.9,
          actual: 0.4,
          operator: '>=',
          passed: false,
          auditId: 'categories',
          auditProperty: 'accessibility',
          level: 'error',
          url: 'http://localhost/',
        },
      ]),
      context,
    )

    expect(body).toContain('Other failing assertions')
    expect(body).toContain('categories:accessibility')
  })

  it('omits the other-failures section when there are none', () => {
    expect(renderComment(cleanReport(), context)).not.toContain('Other failing assertions')
  })

  it('links a row to its documentation when LHCI supplied a link', () => {
    const body = renderComment(
      buildBudgetReport(budgets, [
        { ...tbt(true, 1), auditDocumentationLink: 'https://example.invalid/tbt' },
      ]),
      context,
    )

    expect(body).toContain('[total-blocking-time](https://example.invalid/tbt)')
  })

  it('records the run count, so a reader knows it is a median', () => {
    expect(renderComment(cleanReport(), context)).toContain('median of 3 runs')
  })

  it('says single run when there was only one', () => {
    expect(renderComment(cleanReport(), { ...context, runs: 1 })).toContain('single run')
  })

  it('names the URL when there is one, and counts them when there are more', () => {
    expect(renderComment(cleanReport(), context)).toContain('http://localhost/')
    expect(
      renderComment(cleanReport(), { ...context, urls: ['http://a/', 'http://b/'] }),
    ).toContain('2 URLs')
  })

  it('links the workflow run when given one', () => {
    expect(
      renderComment(cleanReport(), { ...context, runUrl: 'https://github.invalid/run/1' }),
    ).toContain('[workflow run](https://github.invalid/run/1)')
  })

  it('names the commit', () => {
    expect(renderComment(cleanReport(), context)).toContain('abc1234')
  })

  it('renders a table row per budget line in the collapsed section', () => {
    const body = renderComment(cleanReport(), context)
    const rows = body.split('\n').filter((line) => line.startsWith('| ✅'))

    // Two lines, each appearing once: the clean run has no above-the-fold table.
    expect(rows).toHaveLength(2)
  })
})

describe('truncate', () => {
  it('leaves a body inside the limit alone', () => {
    expect(truncate('short')).toBe('short')
  })

  it('cuts a body over the limit and says so', () => {
    const body = truncate('x'.repeat(MAX_COMMENT_LENGTH + 1_000))

    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH)
    expect(body).toContain('truncated')
  })

  // A truncated body that lost its marker makes the next run post a duplicate.
  it('keeps the marker when it cuts', () => {
    const body = truncate(`${STICKY_MARKER}\n${'x'.repeat(MAX_COMMENT_LENGTH)}`)

    expect(body.startsWith(STICKY_MARKER)).toBe(true)
  })
})
