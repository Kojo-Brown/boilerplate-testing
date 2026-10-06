import { describe, expect, it } from 'vitest'

import {
  ABSENT_PHASE,
  AGREEMENT_CASES,
  AGREEMENT_PROFILE,
  GAUGE_LEVEL,
  HITS_METRIC,
  LEVEL_METRIC,
  aggregateForm,
  aggregateForms,
  agreementThresholds,
  type Claim,
} from './agreement.ts'
import { phaseAt, profileDuration, profiles } from './config.ts'
import { parseMetricKey, parseThreshold, passesVacuously } from './thresholds.ts'

describe('agreementThresholds', () => {
  it('groups the cases by metric, because k6 takes a list per metric', () => {
    const thresholds = agreementThresholds([
      {
        metric: 'http_reqs',
        expression: 'count>0',
        expect: 'pass',
        inDefaultExport: true,
        claim: 'arithmetic',
        why: 'fixture',
      },
      {
        metric: 'http_reqs',
        expression: 'count<1',
        expect: 'breach',
        inDefaultExport: true,
        claim: 'arithmetic',
        why: 'fixture',
      },
    ])

    expect(thresholds).toEqual({ http_reqs: ['count>0', 'count<1'] })
  })

  it('covers every case exactly once', () => {
    const grouped = agreementThresholds()
    const total = Object.values(grouped).reduce((acc, list) => acc + list.length, 0)

    expect(total).toBe(AGREEMENT_CASES.length)
  })

  it('declares no duplicate expression on a metric', () => {
    for (const [metric, expressions] of Object.entries(agreementThresholds())) {
      expect(new Set(expressions).size, metric).toBe(expressions.length)
    }
  })
})

describe('the agreement cases', () => {
  it('every metric key and expression parses', () => {
    for (const testCase of AGREEMENT_CASES) {
      expect(() => parseMetricKey(testCase.metric), testCase.metric).not.toThrow()
      expect(() => parseThreshold(testCase.expression), testCase.expression).not.toThrow()
    }
  })

  it('each case carries a rationale', () => {
    for (const testCase of AGREEMENT_CASES) {
      expect(testCase.why.length, `${testCase.metric}: ${testCase.expression}`).toBeGreaterThan(20)
    }
  })

  it('is unique on metric and expression', () => {
    const keys = AGREEMENT_CASES.map((c) => `${c.metric}: ${c.expression}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('contains both outcomes, so the gate is known to fail as well as pass', () => {
    // A set of cases that only ever passes cannot tell a working gate from a
    // gate that scores everything green.
    expect(AGREEMENT_CASES.some((c) => c.expect === 'pass')).toBe(true)
    expect(AGREEMENT_CASES.some((c) => c.expect === 'breach')).toBe(true)
  })

  it('exercises every claim the thresholds module makes', () => {
    const claims: readonly Claim[] = [
      'polarity',
      'rate-ambiguity',
      'export-blindness',
      'vacuous-pass',
      'arithmetic',
    ]

    for (const claim of claims) {
      expect(
        AGREEMENT_CASES.filter((c) => c.claim === claim),
        `no case pins down ${claim}`,
      ).not.toHaveLength(0)
    }
  })

  it('has exactly one case the default export cannot answer', () => {
    // More than one and `check.ts`'s count assertion stops localising which
    // finding changed; none and `export-blindness` is no longer measured.
    expect(AGREEMENT_CASES.filter((c) => !c.inDefaultExport)).toHaveLength(1)
  })

  it('pins the vacuous pass with both a toothless threshold and a witness', () => {
    const vacuous = AGREEMENT_CASES.filter((c) => c.claim === 'vacuous-pass')

    const toothless = vacuous.filter(
      (c) => c.expect === 'pass' && passesVacuously(parseThreshold(c.expression)),
    )
    const witness = vacuous.filter(
      (c) => c.expect === 'breach' && !passesVacuously(parseThreshold(c.expression)),
    )

    expect(toothless, 'no case shows a bad selector passing').not.toHaveLength(0)
    expect(witness, 'no case shows a witness catching it').not.toHaveLength(0)

    // Both must select on the same absent phase, or they are not the same
    // demonstration — one would be about a tag and the other about a metric.
    for (const testCase of [...toothless, ...witness]) {
      expect(parseMetricKey(testCase.metric).selector).toBe(`phase:${ABSENT_PHASE}`)
    }
  })

  it('selects on a phase the agreement profile never enters', () => {
    expect(AGREEMENT_PROFILE.stages.map((stage) => stage.phase)).not.toContain(ABSENT_PHASE)
  })

  it('names the custom metrics the scenario creates', () => {
    const metrics = new Set(AGREEMENT_CASES.map((c) => parseMetricKey(c.metric).name))

    expect(metrics).toContain(HITS_METRIC)
    expect(metrics).toContain(LEVEL_METRIC)
  })

  it('compares the Gauge against the value the scenario reports', () => {
    const gauge = AGREEMENT_CASES.filter((c) => c.metric === LEVEL_METRIC)

    expect(gauge).not.toHaveLength(0)

    for (const testCase of gauge) {
      expect(parseThreshold(testCase.expression).operand).toBe(GAUGE_LEVEL)
    }
  })
})

describe('aggregateForm', () => {
  it('collapses percentiles to one form, since the number is the argument', () => {
    expect(aggregateForm('p(95)<200')).toBe('p(N)')
    expect(aggregateForm('p(99)<500')).toBe('p(N)')
  })

  it('leaves scalar aggregates as themselves', () => {
    expect(aggregateForm('rate<0.01')).toBe('rate')
    expect(aggregateForm('count>0')).toBe('count')
    expect(aggregateForm('value===42')).toBe('value')
  })
})

describe('the agreement run covers the published profiles', () => {
  // This is the gate that keeps the two files honest with each other: a new
  // threshold form in a profile — a `med`, a Gauge `value`, anything — has
  // never been checked against a real k6 binary until a case exercises it, and
  // this fails in milliseconds rather than waiting for the load job.
  const covered = aggregateForms(agreementThresholds())

  for (const [name, profile] of Object.entries(profiles)) {
    for (const form of aggregateForms(profile.thresholds)) {
      it(`${name} uses ${form}, which the agreement run exercises`, () => {
        expect(covered).toContain(form)
      })
    }
  }

  it('exercises every metric the published profiles set thresholds on', () => {
    const exercised = new Set(AGREEMENT_CASES.map((c) => parseMetricKey(c.metric).name))

    for (const [name, profile] of Object.entries(profiles)) {
      for (const key of Object.keys(profile.thresholds)) {
        expect(exercised, `${name}: ${key}`).toContain(parseMetricKey(key).name)
      }
    }
  })
})

describe('AGREEMENT_PROFILE', () => {
  it('runs in well under a minute, because CI runs it twice', () => {
    expect(profileDuration(AGREEMENT_PROFILE)).toBeLessThan(30)
  })

  it('has the spike shape, so a recovery selector has samples to match', () => {
    expect(AGREEMENT_PROFILE.stages.map((stage) => stage.phase)).toEqual([
      'baseline',
      'burst',
      'hold',
      'drop',
      'recovery',
      'ramp-down',
    ])
  })

  it('spends real time in the recovery phase', () => {
    const total = profileDuration(AGREEMENT_PROFILE)
    const recovery = Array.from({ length: Math.ceil(total * 10) }, (_, tick) =>
      phaseAt(tick / 10, AGREEMENT_PROFILE),
    ).filter((phase) => phase === 'recovery')

    expect(recovery.length / (total * 10)).toBeGreaterThan(0.2)
  })

  it('declares no thresholds of its own — the cases are the thresholds', () => {
    expect(AGREEMENT_PROFILE.thresholds).toEqual({})
  })
})
