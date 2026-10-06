import { describe, expect, it } from 'vitest'

import {
  parseSummary,
  renderReport,
  reportThresholds,
  verdict,
  type SummaryExport,
} from './verdict.ts'

/**
 * A summary export in the shape k6 v1.3.0 writes, trimmed to the metrics a
 * case needs. The `thresholds` booleans are k6's polarity: true is a breach.
 */
const summary: SummaryExport = {
  metrics: {
    http_req_duration: {
      avg: 0.2,
      min: 0.06,
      med: 0.17,
      max: 6,
      'p(90)': 0.28,
      'p(95)': 0.35,
      thresholds: { 'p(95)<200': false, 'p(99)<500': false },
    },
    http_req_failed: {
      passes: 0,
      fails: 17822,
      value: 0,
      thresholds: { 'rate<0.01': false },
    },
    http_reqs: {
      count: 17822,
      rate: 4455.1,
      thresholds: { 'count<1': true },
    },
  },
}

describe('parseSummary', () => {
  it('reads a summary export', () => {
    expect(parseSummary(JSON.stringify(summary)).metrics['http_reqs']).toMatchObject({
      count: 17822,
    })
  })

  it('rejects invalid JSON', () => {
    expect(() => parseSummary('{nope')).toThrow('not valid JSON')
  })

  it('rejects a non-object', () => {
    expect(() => parseSummary('42')).toThrow('not an object')
  })

  it('rejects an object with no metrics, rather than reading it as a clean run', () => {
    // "Nothing breached" and "this is not a summary file" must not look alike:
    // one is a green gate and the other is no gate.
    expect(() => parseSummary('{}')).toThrow('no `metrics` object')
    expect(() => parseSummary('{"metrics": []}')).toThrow('no `metrics` object')
    expect(() => parseSummary('{"metrics": null}')).toThrow('no `metrics` object')
  })
})

describe('reportThresholds', () => {
  it('agrees with k6 on a threshold that passed', () => {
    const [report] = reportThresholds(summary, { http_req_duration: ['p(95)<200'] })

    expect(report).toMatchObject({ k6: true, agreement: 'agree' })
    expect(report!.recomputed).toMatchObject({ verifiable: true, passed: true, key: 'p(95)' })
  })

  it('agrees with k6 on a threshold that breached', () => {
    const [report] = reportThresholds(summary, { http_reqs: ['count<1'] })

    expect(report).toMatchObject({ k6: false, agreement: 'agree' })
    expect(report!.recomputed).toMatchObject({ passed: false })
  })

  it('reads a Rate threshold from `value`', () => {
    const [report] = reportThresholds(summary, { http_req_failed: ['rate<0.01'] })

    expect(report!.recomputed).toMatchObject({ verifiable: true, passed: true, key: 'value' })
    expect(report!.agreement).toBe('agree')
  })

  it('reports unverifiable when k6 scored a percentile the export omits', () => {
    const [report] = reportThresholds(summary, { http_req_duration: ['p(99)<500'] })

    expect(report).toMatchObject({ k6: true, agreement: 'unverifiable' })
  })

  it('reports absent for a declared threshold k6 never scored', () => {
    // The real cause is a sub-metric selector whose tag the scenario never
    // set — the threshold is in the file and enforces nothing.
    const [report] = reportThresholds(summary, {
      'http_req_duration{phase:recovery}': ['p(95)<500'],
    })

    expect(report).toMatchObject({ k6: undefined, agreement: 'absent' })
  })

  it('reports disagree when the recomputed verdict contradicts k6', () => {
    const lying: SummaryExport = {
      metrics: {
        http_reqs: { count: 17822, thresholds: { 'count<1': false } },
      },
    }

    const [report] = reportThresholds(lying, { http_reqs: ['count<1'] })

    expect(report).toMatchObject({ k6: true, agreement: 'disagree' })
  })

  it('scores every expression of every declared metric', () => {
    const reports = reportThresholds(summary, {
      http_req_duration: ['p(95)<200', 'p(99)<500'],
      http_req_failed: ['rate<0.01'],
    })

    expect(reports).toHaveLength(3)
  })
})

describe('verdict', () => {
  it('passes when every threshold passed', () => {
    const result = verdict(reportThresholds(summary, { http_req_duration: ['p(95)<200'] }))

    expect(result.passed).toBe(true)
    expect(result.breached).toHaveLength(0)
  })

  it('fails on a breach', () => {
    const result = verdict(reportThresholds(summary, { http_reqs: ['count<1'] }))

    expect(result.passed).toBe(false)
    expect(result.breached).toHaveLength(1)
  })

  it('fails on a threshold nobody scored', () => {
    // A threshold that was not evaluated did not hold. Scoring it as a pass is
    // how a recovery gate gets switched off by a typo and stays green.
    const result = verdict(
      reportThresholds(summary, { 'http_reqs{phase:recovery}': ['count>0'] }),
    )

    expect(result.passed).toBe(false)
    expect(result.absent).toHaveLength(1)
  })

  it('does not fail on an unverifiable threshold, because k6 did score it', () => {
    const result = verdict(reportThresholds(summary, { http_req_duration: ['p(99)<500'] }))

    expect(result.passed).toBe(true)
    expect(result.unverifiable).toHaveLength(1)
  })

  it('counts a disagreement as a disagreement, not as a breach', () => {
    // Here k6 says the threshold passed and recomputing says it breached. The
    // run's verdict follows k6, because k6's exit code is the contract with
    // CI — a disagreement is a defect in this repository or a change in k6,
    // and `check.ts` is what fails on it. Folding it into `breached` would
    // report a load-test failure for what is a tooling failure.
    const lying: SummaryExport = {
      metrics: { http_reqs: { count: 17822, thresholds: { 'count<1': false } } },
    }

    const result = verdict(reportThresholds(lying, { http_reqs: ['count<1'] }))

    expect(result.disagreed).toHaveLength(1)
    expect(result.breached).toHaveLength(0)
    expect(result.passed).toBe(true)
  })
})

describe('renderReport', () => {
  const rendered = renderReport(
    reportThresholds(summary, {
      http_req_duration: ['p(95)<200', 'p(99)<500'],
      http_reqs: ['count<1'],
    }),
  )

  it('names every threshold with its metric', () => {
    expect(rendered).toContain('http_req_duration: p(95)<200')
    expect(rendered).toContain('http_reqs: count<1')
  })

  it('says BREACH rather than only marking the row', () => {
    expect(rendered).toContain('BREACH')
  })

  it('shows the observed number and which export key answered', () => {
    expect(rendered).toContain('(p(95))')
    expect(rendered).toContain('(count)')
  })

  it('says why an unverifiable row has no number', () => {
    expect(rendered).toContain('no p(99) in export')
  })

  it('aligns into columns with a header', () => {
    const lines = rendered.split('\n')

    expect(lines[0]).toContain('threshold')
    expect(lines[0]).toContain('agreement')
    expect(lines).toHaveLength(4)
  })

  it('leaves no trailing whitespace on a row', () => {
    for (const line of rendered.split('\n')) {
      expect(line).toBe(line.trimEnd())
    }
  })
})
