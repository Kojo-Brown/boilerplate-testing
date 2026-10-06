import { describe, expect, it } from 'vitest'

import {
  AGGREGATE_KEYS,
  BREACHED,
  EMPTY_SUBMETRIC,
  OPERATORS,
  SCALAR_AGGREGATES,
  compare,
  evaluateThreshold,
  isPercentile,
  k6Passed,
  parseMetricKey,
  parseThreshold,
  passesVacuously,
  readAggregate,
  type Operator,
} from './thresholds.ts'

describe('parseThreshold', () => {
  it('parses a percentile threshold', () => {
    expect(parseThreshold('p(95)<200')).toEqual({
      expression: 'p(95)<200',
      aggregate: 'p(95)',
      operator: '<',
      operand: 200,
    })
  })

  it('parses a fractional percentile', () => {
    expect(parseThreshold('p(99.9)<1000').aggregate).toBe('p(99.9)')
  })

  it('parses every scalar aggregate', () => {
    for (const aggregate of SCALAR_AGGREGATES) {
      expect(parseThreshold(`${aggregate}<1`).aggregate).toBe(aggregate)
    }
  })

  it('parses every operator', () => {
    for (const operator of OPERATORS) {
      expect(parseThreshold(`count${operator}1`).operator).toBe(operator)
    }
  })

  it('does not read `<=` as `<` with a stray equals', () => {
    expect(parseThreshold('count<=1').operator).toBe('<=')
    expect(parseThreshold('count>=1').operator).toBe('>=')
    expect(parseThreshold('count!==1').operator).toBe('!==')
    expect(parseThreshold('count===1').operator).toBe('===')
  })

  it('tolerates whitespace and normalises it away', () => {
    expect(parseThreshold('  p( 95 ) < 200  ').expression).toBe('p(95)<200')
  })

  it('parses a fractional operand', () => {
    expect(parseThreshold('rate<0.01').operand).toBe(0.01)
  })

  it.each([
    ['', 'empty'],
    ['p(95)', 'no operator'],
    ['<200', 'no aggregate'],
    ['p(95)<', 'no operand'],
    ['mean<200', 'not a k6 aggregate'],
    ['p(95)=200', 'assignment rather than comparison'],
    ['p(95)<abc', 'non-numeric operand'],
    ['median<200', 'the export key is `med`'],
    ['p95<200', 'missing parentheses'],
  ])('rejects %j (%s)', (expression) => {
    expect(() => parseThreshold(expression)).toThrow('Invalid threshold expression')
  })
})

describe('compare', () => {
  it.each<[number, Operator, number, boolean]>([
    [1, '<', 2, true],
    [2, '<', 1, false],
    [2, '<=', 2, true],
    [3, '>', 2, true],
    [2, '>=', 3, false],
    [2, '==', 2, true],
    [2, '===', 2, true],
    [2, '!=', 3, true],
    [2, '!==', 2, false],
  ])('%d %s %d is %s', (left, operator, right, expected) => {
    expect(compare(left, operator, right)).toBe(expected)
  })
})

describe('isPercentile', () => {
  it('recognises percentiles and nothing else', () => {
    expect(isPercentile('p(95)')).toBe(true)
    expect(isPercentile('p(99.9)')).toBe(true)
    expect(isPercentile('avg')).toBe(false)
    expect(isPercentile('rate')).toBe(false)
    expect(isPercentile('p()')).toBe(false)
  })
})

describe('readAggregate: `rate` means two different things', () => {
  // Both fixtures are shapes a real k6 v1.3.0 export was observed to produce.
  const counter = { count: 9428, rate: 4713.5 }
  const rateMetric = { passes: 9428, fails: 9428, value: 0.5 }

  it('reads a Counter rate as events per second', () => {
    expect(readAggregate(counter, 'rate')).toEqual({ found: true, key: 'rate', value: 4713.5 })
  })

  it('reads a Rate rate from `value`, because the export has no `rate` key', () => {
    expect(readAggregate(rateMetric, 'rate')).toEqual({ found: true, key: 'value', value: 0.5 })
  })

  it('prefers `rate` over `value` when both exist, so a Counter is never misread', () => {
    expect(readAggregate({ ...counter, value: 0.5 }, 'rate')).toMatchObject({
      found: true,
      key: 'rate',
    })
  })

  it('declares the fallback order rather than leaving it to key iteration', () => {
    expect(AGGREGATE_KEYS.rate).toEqual(['rate', 'value'])
  })

  it('reports which keys it tried when none are present', () => {
    expect(readAggregate({ count: 1 }, 'rate')).toEqual({ found: false, tried: ['rate', 'value'] })
  })

  it('ignores a non-numeric or non-finite value', () => {
    expect(readAggregate({ count: 'lots' }, 'count').found).toBe(false)
    expect(readAggregate({ count: Number.NaN }, 'count').found).toBe(false)
  })
})

describe('evaluateThreshold', () => {
  const trend = { avg: 0.2, min: 0.06, med: 0.17, max: 6, 'p(90)': 0.28, 'p(95)': 0.35 }

  it('passes a threshold the metric satisfies', () => {
    expect(evaluateThreshold(parseThreshold('p(95)<200'), trend)).toEqual({
      verifiable: true,
      passed: true,
      observed: 0.35,
      key: 'p(95)',
    })
  })

  it('fails a threshold the metric breaches', () => {
    const outcome = evaluateThreshold(parseThreshold('p(95)<0.1'), trend)
    expect(outcome).toMatchObject({ verifiable: true, passed: false })
  })

  it('reports unverifiable rather than passing when the aggregate is absent', () => {
    // The real case: a default --summary-trend-stats export carries p(90) and
    // p(95) but not p(99), while k6 happily evaluated a p(99) threshold. A
    // recomputation that scored this as a pass would be inventing a verdict.
    expect(evaluateThreshold(parseThreshold('p(99)<500'), trend)).toEqual({
      verifiable: false,
      tried: ['p(99)'],
    })
  })
})

describe('k6Passed: the summary boolean is inverted', () => {
  it('documents that `true` means breached', () => {
    expect(BREACHED).toBe(true)
  })

  it('reads `false` as a pass', () => {
    expect(k6Passed({ thresholds: { 'p(95)<200': false } }, 'p(95)<200')).toBe(true)
  })

  it('reads `true` as a breach', () => {
    expect(k6Passed({ thresholds: { 'p(95)<200': true } }, 'p(95)<200')).toBe(false)
  })

  it('returns undefined when the threshold is not in the export', () => {
    expect(k6Passed({ thresholds: { 'p(95)<200': false } }, 'p(99)<500')).toBeUndefined()
  })

  it('returns undefined when the metric carries no thresholds at all', () => {
    expect(k6Passed({ count: 1 }, 'count>0')).toBeUndefined()
    expect(k6Passed({ thresholds: null }, 'count>0')).toBeUndefined()
  })

  it('matches on the normalised expression, not the one as typed', () => {
    const parsed = parseThreshold(' p( 95 ) < 200 ')
    expect(k6Passed({ thresholds: { 'p(95)<200': false } }, parsed.expression)).toBe(true)
  })
})

describe('parseMetricKey', () => {
  it('splits a sub-metric selector from its metric', () => {
    expect(parseMetricKey('http_req_duration{phase:recovery}')).toEqual({
      name: 'http_req_duration',
      selector: 'phase:recovery',
    })
  })

  it('reports no selector for a whole metric', () => {
    expect(parseMetricKey('http_req_failed')).toEqual({
      name: 'http_req_failed',
      selector: undefined,
    })
  })

  it('keeps a multi-tag selector intact', () => {
    expect(parseMetricKey('http_reqs{phase:recovery,endpoint:health}').selector).toBe(
      'phase:recovery,endpoint:health',
    )
  })

  it.each([
    'http_req_duration{phase:recovery',
    'http_req_duration}',
    '{phase:recovery}',
    '1_starts_with_a_digit',
    'has-a-hyphen',
  ])('rejects %j', (key) => {
    expect(() => parseMetricKey(key)).toThrow('Invalid threshold metric key')
  })
})

describe('passesVacuously: why a sub-metric threshold needs a witness', () => {
  // k6 v1.3.0, measured: `http_req_duration{phase:typo}` on a tag no request
  // carried exported `{"p(95)": 0, "thresholds": {"p(95)<500": false}}` — a
  // pass. These are the shapes that do and do not survive that.
  it('a latency threshold passes against a sub-metric that collected nothing', () => {
    expect(passesVacuously(parseThreshold('p(95)<500'))).toBe(true)
    expect(passesVacuously(parseThreshold('avg<300'))).toBe(true)
    expect(passesVacuously(parseThreshold('max<1000'))).toBe(true)
  })

  it('a failure-rate threshold passes too, because an empty Rate is 0', () => {
    expect(passesVacuously(parseThreshold('rate<0.01'))).toBe(true)
  })

  it('`count>0` does not, which is what makes it usable as a witness', () => {
    expect(passesVacuously(parseThreshold('count>0'))).toBe(false)
    expect(passesVacuously(parseThreshold('count>=1'))).toBe(false)
  })

  it('agrees with evaluating against the empty sub-metric directly', () => {
    for (const expression of ['p(95)<500', 'rate<0.01', 'count>0', 'value===42']) {
      const parsed = parseThreshold(expression)
      const outcome = evaluateThreshold(parsed, EMPTY_SUBMETRIC)

      expect(passesVacuously(parsed), expression).toBe(outcome.verifiable && outcome.passed)
    }
  })

  it('reports every aggregate as zero, as k6 does for an empty metric', () => {
    for (const aggregate of SCALAR_AGGREGATES) {
      expect(readAggregate(EMPTY_SUBMETRIC, aggregate), aggregate).toMatchObject({
        found: true,
        value: 0,
      })
    }
  })
})
