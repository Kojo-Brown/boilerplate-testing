/**
 * The agreement run: what a real k6 binary is asked, and what it must answer.
 *
 * Everything in `thresholds.ts` is a claim about how k6 decides pass and fail.
 * A claim about another program's behaviour that is only written down rots the
 * moment that program changes, and the way it rots is silent — the comment
 * still reads true. So each claim is also a case here, with the outcome it must
 * produce, and `check.ts` runs them against the installed binary and fails if
 * any answer differs.
 *
 * The cases are chosen to be decided by arithmetic rather than by timing. A
 * threshold that passes because a loopback server happened to answer in under
 * a millisecond is a flake waiting for a loaded runner; `p(95)<60000` and
 * `p(95)<0.000001` are a pass and a breach on any machine that can run k6 at
 * all, and they exercise the same code path.
 */

import type { LoadProfile } from './config.ts'
import { isPercentile, parseThreshold, type Aggregate } from './thresholds.ts'

/** The Gauge value the scenario reports, so `value==` has something exact. */
export const GAUGE_LEVEL = 42

/** The custom Counter the scenario increments once per iteration. */
export const HITS_METRIC = 'agreement_hits'

/** The custom Gauge the scenario sets to {@link GAUGE_LEVEL}. */
export const LEVEL_METRIC = 'agreement_level'

/** A `phase` tag value no stage uses, for the vacuous-pass demonstration. */
export const ABSENT_PHASE = 'nosuchphase'

/**
 * The profile the agreement run uses: the spike shape, compressed to ten
 * seconds.
 *
 * It is the spike shape and not a flat ramp because the sub-metric cases below
 * need a real `recovery` phase to select on — which is the same mechanism
 * `spikeProfile` depends on, exercised at a duration CI can afford. The
 * published profiles are left alone: a profile edited to fit a CI budget stops
 * describing the test it is named after.
 */
export const AGREEMENT_PROFILE: LoadProfile = {
  stages: [
    { duration: '2s', target: 2,  phase: 'baseline' },
    { duration: '1s', target: 10, phase: 'burst' },
    { duration: '2s', target: 10, phase: 'hold' },
    { duration: '1s', target: 2,  phase: 'drop' },
    { duration: '3s', target: 2,  phase: 'recovery' },
    { duration: '1s', target: 0,  phase: 'ramp-down' },
  ],
  thresholds: {},
}

/** Which k6 semantic a case pins down, for the report and the README. */
export type Claim =
  /** The summary boolean is "breached", not "passed". */
  | 'polarity'
  /** `rate` resolves to `rate` on a Counter and to `value` on a Rate. */
  | 'rate-ambiguity'
  /** A threshold k6 evaluated can be missing from the export. */
  | 'export-blindness'
  /** An empty sub-metric scores zero, so a bad selector passes. */
  | 'vacuous-pass'
  /** Plain arithmetic over an aggregate and an operator. */
  | 'arithmetic'

export interface AgreementCase {
  /** The threshold map key, including any sub-metric selector. */
  readonly metric: string
  readonly expression: string
  /** What k6 itself must conclude. */
  readonly expect: 'pass' | 'breach'
  /**
   * Whether `--summary-export` carries the number under default trend stats.
   *
   * False for exactly one case, and that case is the point of
   * `export-blindness`: k6 scores it either way, and a verdict recomputed from
   * a default export cannot.
   */
  readonly inDefaultExport: boolean
  readonly claim: Claim
  readonly why: string
}

export const AGREEMENT_CASES: readonly AgreementCase[] = [
  // --- arithmetic over every aggregate the published profiles use ----------
  {
    metric: 'http_reqs',
    expression: 'count>0',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'The scenario makes requests, so the Counter is above zero.',
  },
  {
    metric: 'http_reqs',
    expression: 'count<1',
    expect: 'breach',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'The same Counter cannot be below one. A breach reached by arithmetic, not by timing.',
  },
  {
    metric: 'http_req_duration',
    expression: 'p(95)<60000',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'A loopback reply inside sixty seconds. True on any machine that can run k6.',
  },
  {
    metric: 'http_req_duration',
    expression: 'p(95)<0.000001',
    expect: 'breach',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'A sub-nanosecond HTTP round trip is impossible, so this breaches everywhere.',
  },
  {
    metric: 'http_req_duration',
    expression: 'avg<60000',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'Covers the `avg` aggregate.',
  },
  {
    metric: 'http_req_duration',
    expression: 'min>=0',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'Covers `min` and the `>=` operator. A duration is never negative.',
  },
  {
    metric: 'http_req_duration',
    expression: 'med<60000',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'Covers the `med` aggregate, whose export key is `med` and not `median`.',
  },
  {
    metric: 'http_req_duration',
    expression: 'max<=60000',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'Covers `max` and the `<=` operator.',
  },
  {
    metric: 'http_req_waiting',
    expression: 'p(95)<60000',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: '`loadProfile` sets a threshold on this metric, so the run must produce it.',
  },

  // --- the summary boolean's polarity -------------------------------------
  {
    metric: HITS_METRIC,
    expression: 'count>0',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'polarity',
    why:
      'A custom Counter that must pass. Its exported boolean is `false`, which is ' +
      'what a pass looks like — read as "passed: false" the whole gate inverts.',
  },
  {
    metric: HITS_METRIC,
    expression: 'count<0',
    expect: 'breach',
    inDefaultExport: true,
    claim: 'polarity',
    why: 'The same Counter, breaching, so the boolean is `true`. The pair pins the polarity.',
  },

  // --- `rate` means two things --------------------------------------------
  {
    metric: 'http_req_failed',
    expression: 'rate<0.5',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'rate-ambiguity',
    why:
      'A Rate metric: the scenario only calls /health, so the failure rate is exactly 0. ' +
      'The export carries it under `value`, with no `rate` key at all.',
  },
  {
    metric: 'http_req_failed',
    expression: 'rate>0.5',
    expect: 'breach',
    inDefaultExport: true,
    claim: 'rate-ambiguity',
    why: 'The same Rate, breaching, so both directions are read from `value`.',
  },
  {
    metric: HITS_METRIC,
    expression: 'rate>0',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'rate-ambiguity',
    why:
      'The same word on a Counter means iterations per second — a number in the thousands ' +
      'where the Rate above is a proportion in [0,1]. Reading the wrong key is not an ' +
      'error, it is a number four orders of magnitude out.',
  },
  {
    metric: LEVEL_METRIC,
    expression: `value===${GAUGE_LEVEL}`,
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'Covers the `value` aggregate on a Gauge, and the `===` operator k6 also accepts.',
  },
  {
    metric: LEVEL_METRIC,
    expression: `value!=${GAUGE_LEVEL}`,
    expect: 'breach',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'Covers `!=`. The Gauge is set to exactly one value, so this cannot hold.',
  },

  // --- a threshold k6 scored that the export cannot answer -----------------
  {
    metric: 'http_req_duration',
    expression: 'p(99)<60000',
    expect: 'pass',
    inDefaultExport: false,
    claim: 'export-blindness',
    why:
      'k6 evaluates p(99) correctly, but --summary-trend-stats defaults to ' +
      'avg,min,med,max,p(90),p(95), so the export has no p(99) to recompute from. ' +
      'Three of the five published profiles set a p(99) threshold.',
  },

  // --- the vacuous pass, and the witness that catches it -------------------
  {
    metric: 'http_req_duration{phase:recovery}',
    expression: 'p(95)<60000',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why:
      'The mechanism `spikeProfile` depends on: a threshold scoped to one phase of the ' +
      'run, which only works if the scenario tags requests with the phase it is in.',
  },
  {
    metric: 'http_reqs{phase:recovery}',
    expression: 'count>0',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'arithmetic',
    why: 'The selector matches real requests, so the witness holds.',
  },
  {
    metric: `http_req_duration{phase:${ABSENT_PHASE}}`,
    expression: 'p(95)<60000',
    expect: 'pass',
    inDefaultExport: true,
    claim: 'vacuous-pass',
    why:
      'No stage carries this phase, so the sub-metric collects nothing — and k6 scores an ' +
      'empty Trend as p(95)=0, which passes. This is a misspelt selector reporting green ' +
      'while enforcing nothing, and it is why `spikeProfile` carries a witness.',
  },
  {
    metric: `http_reqs{phase:${ABSENT_PHASE}}`,
    expression: 'count>0',
    expect: 'breach',
    inDefaultExport: true,
    claim: 'vacuous-pass',
    why:
      'The witness, on the same empty sub-metric that just passed a latency threshold. ' +
      '`count>0` is the one shape that cannot pass on no samples.',
  },
]

/**
 * The cases as a k6 `thresholds` map.
 *
 * Several cases share a metric, which is why this groups rather than maps:
 * k6 takes a list of expressions per metric and scores each one separately.
 */
export function agreementThresholds(
  cases: readonly AgreementCase[] = AGREEMENT_CASES,
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}

  for (const testCase of cases) {
    const expressions = (grouped[testCase.metric] ??= [])

    if (!expressions.includes(testCase.expression)) {
      expressions.push(testCase.expression)
    }
  }

  return grouped
}

/**
 * The aggregate form a threshold uses, with percentiles collapsed to `p(N)`.
 *
 * `p(95)` and `p(99)` are the same code path through k6 and through
 * `thresholds.ts`; the number is the argument, not the form. Collapsing them
 * is what lets the coverage test demand every *form* be exercised without
 * demanding a case per percentile.
 */
export function aggregateForm(expression: string): Aggregate | 'p(N)' {
  const { aggregate } = parseThreshold(expression)

  return isPercentile(aggregate) ? 'p(N)' : aggregate
}

/** Every aggregate form appearing in a profile's (or any) threshold map. */
export function aggregateForms(
  thresholds: Readonly<Record<string, readonly string[]>>,
): ReadonlySet<Aggregate | 'p(N)'> {
  const forms = new Set<Aggregate | 'p(N)'>()

  for (const expressions of Object.values(thresholds)) {
    for (const expression of expressions) {
      forms.add(aggregateForm(expression))
    }
  }

  return forms
}
