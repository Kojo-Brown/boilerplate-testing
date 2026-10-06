/**
 * k6 threshold expressions, parsed and evaluated.
 *
 * A threshold is the only thing that makes a load test pass or fail. k6 exits
 * 99 when one is breached and 0 when none are, and that exit code is the whole
 * contract with CI — everything else a run prints is for a human.
 *
 * This module exists because that contract is easy to hold wrong in three
 * specific ways, each of which was measured against `k6 v1.3.0` rather than
 * read off a page. See README.md for the numbers.
 *
 * ---------------------------------------------------------------------------
 * 1. The summary boolean is "breached", not "passed"
 * ---------------------------------------------------------------------------
 * `--summary-export` writes, per metric, `"thresholds": { "p(95)<200": false }`.
 * `false` means the threshold did **not** fail. Read as "passed: false" — the
 * intuitive reading, and the one a reviewer skims past — every passing run
 * looks like a failing one and the gate inverts silently. {@link BREACHED}
 * names the polarity so it cannot be assumed at a call site.
 *
 * ---------------------------------------------------------------------------
 * 2. `rate` means two different things
 * ---------------------------------------------------------------------------
 * On a Counter, `rate` is events per second — `my_count: {count: 9428, rate: 4713.5}`.
 * On a Rate, it is the proportion of truthy samples, and the summary exports it
 * under `value`, with no `rate` key at all — `my_rate: {passes: 9428, fails: 9428, value: 0.5}`.
 * So `http_req_failed: ['rate<0.01']` has to be answered from `value`, while
 * `my_count: ['rate<100']` has to be answered from `rate`, and reading the
 * wrong one is not an error — it is a number, four orders of magnitude out.
 * {@link AGGREGATE_KEYS} encodes the fallback order; {@link readAggregate}
 * reports which key actually answered.
 *
 * ---------------------------------------------------------------------------
 * 3. A threshold can be evaluated and still be absent from the export
 * ---------------------------------------------------------------------------
 * k6 evaluates `p(99)<500` correctly whatever the summary says, but the export
 * only carries the percentiles in `--summary-trend-stats`, which defaults to
 * avg,min,med,max,p(90),p(95). A verdict recomputed from the export is
 * therefore *blind* to a p(99) threshold by default — it cannot disagree with
 * k6, it simply has no number. That is reported as unverifiable rather than as
 * a pass, because a gate that scores a missing measurement as a pass is worse
 * than no gate.
 */

/**
 * What `true` means in the summary export's `thresholds` map.
 *
 * Named rather than inlined: `=== BREACHED` reads correctly and `=== true`
 * reads backwards, and that is the entire defect this constant prevents.
 */
export const BREACHED = true

/** Comparison operators k6 accepts in a threshold expression. */
export const OPERATORS = ['<=', '>=', '===', '!==', '==', '!=', '<', '>'] as const

export type Operator = (typeof OPERATORS)[number]

/** Aggregates k6 accepts, excluding percentiles, which are parameterised. */
export const SCALAR_AGGREGATES = ['avg', 'min', 'med', 'max', 'count', 'rate', 'value'] as const

export type ScalarAggregate = (typeof SCALAR_AGGREGATES)[number]

/** An aggregate: one of the scalars above, or a percentile such as `p(95)`. */
export type Aggregate = ScalarAggregate | `p(${number})`

export interface ParsedThreshold {
  /** The expression as written, normalised (whitespace removed). */
  readonly expression: string
  readonly aggregate: Aggregate
  readonly operator: Operator
  readonly operand: number
}

/**
 * Summary-export keys that can answer an aggregate, in preference order.
 *
 * Only `rate` needs more than one: see note 2 above. The others are exported
 * under their own name by whichever metric type defines them.
 */
export const AGGREGATE_KEYS: Readonly<Record<ScalarAggregate, readonly string[]>> = {
  avg: ['avg'],
  min: ['min'],
  med: ['med'],
  max: ['max'],
  count: ['count'],
  // Counter first: a Counter exports both `rate` and `count`, a Rate exports
  // `value` and no `rate`, so first-present is unambiguous in both directions.
  rate: ['rate', 'value'],
  value: ['value'],
}

const PERCENTILE_PATTERN = /^p\(\s*(\d+(?:\.\d+)?)\s*\)$/

const THRESHOLD_PATTERN = new RegExp(
  '^\\s*' +
    `(${SCALAR_AGGREGATES.join('|')}|p\\(\\s*\\d+(?:\\.\\d+)?\\s*\\))` +
    '\\s*' +
    // Longest-first, so `<=` is not read as `<` with a stray `=`.
    `(${OPERATORS.map((op) => op.replace(/[=<>!]/g, '\\$&')).join('|')})` +
    '\\s*' +
    '(-?\\d+(?:\\.\\d+)?)' +
    '\\s*$',
)

/** True when the aggregate is a percentile, e.g. `p(95)` or `p(99.9)`. */
export function isPercentile(aggregate: string): boolean {
  return PERCENTILE_PATTERN.test(aggregate)
}

/**
 * Parses a k6 threshold expression such as `p(95)<200` or `rate<=0.01`.
 *
 * @throws on anything k6 would also reject, so a typo in a profile fails a
 *   unit test in milliseconds rather than a load test in minutes.
 */
export function parseThreshold(expression: string): ParsedThreshold {
  const match = THRESHOLD_PATTERN.exec(expression)

  if (!match || !match[1] || !match[2] || !match[3]) {
    throw new Error(
      `Invalid threshold expression: ${JSON.stringify(expression)}. ` +
        `Expected <aggregate><operator><number>, e.g. "p(95)<200" or "rate<0.01". ` +
        `Aggregates: ${SCALAR_AGGREGATES.join(', ')}, p(N).`,
    )
  }

  const aggregate = match[1].replace(/\s+/g, '') as Aggregate
  const operand = Number(match[3])

  if (!Number.isFinite(operand)) {
    throw new Error(`Threshold operand is not a finite number: ${JSON.stringify(expression)}`)
  }

  return {
    expression: `${aggregate}${match[2]}${match[3]}`,
    aggregate,
    operator: match[2] as Operator,
    operand,
  }
}

/** Applies an operator. Split out so the operator table is exhaustive by type. */
export function compare(left: number, operator: Operator, right: number): boolean {
  switch (operator) {
    case '<': return left < right
    case '<=': return left <= right
    case '>': return left > right
    case '>=': return left >= right
    case '==':
    case '===': return left === right
    case '!=':
    case '!==': return left !== right
  }
}

/** A metric as the summary export writes it: aggregate name to number. */
export type SummaryMetric = Readonly<Record<string, unknown>>

export type AggregateRead =
  | { readonly found: true; readonly key: string; readonly value: number }
  | { readonly found: false; readonly tried: readonly string[] }

/**
 * Reads the number an aggregate refers to out of an exported metric.
 *
 * Returns rather than throws when the key is absent, because absent is a real
 * and expected state (note 3 above) that the caller has to report differently
 * from a breach.
 */
export function readAggregate(metric: SummaryMetric, aggregate: Aggregate): AggregateRead {
  const tried = isPercentile(aggregate)
    ? [aggregate]
    : (AGGREGATE_KEYS[aggregate as ScalarAggregate] ?? [aggregate])

  for (const key of tried) {
    const value = metric[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { found: true, key, value }
    }
  }

  return { found: false, tried }
}

export type ThresholdOutcome =
  /** The expression was recomputed from the export: `passed` is the result. */
  | {
      readonly verifiable: true
      readonly passed: boolean
      readonly observed: number
      /** Which export key answered the aggregate — see note 2. */
      readonly key: string
    }
  /** No number in the export answers this aggregate — see note 3. */
  | { readonly verifiable: false; readonly tried: readonly string[] }

/** Recomputes one threshold's outcome from an exported metric. */
export function evaluateThreshold(
  parsed: ParsedThreshold,
  metric: SummaryMetric,
): ThresholdOutcome {
  const read = readAggregate(metric, parsed.aggregate)

  if (!read.found) {
    return { verifiable: false, tried: read.tried }
  }

  return {
    verifiable: true,
    passed: compare(read.value, parsed.operator, parsed.operand),
    observed: read.value,
    key: read.key,
  }
}

/**
 * k6's own verdict on one threshold, read out of an exported metric.
 *
 * Returns `undefined` when the metric carries no verdict for the expression,
 * which means k6 never saw that threshold — a declared threshold on a metric
 * no request produced, most often a sub-metric whose tag was never set.
 */
export function k6Passed(metric: SummaryMetric, expression: string): boolean | undefined {
  const thresholds = metric['thresholds']

  if (typeof thresholds !== 'object' || thresholds === null) return undefined

  const breached = (thresholds as Record<string, unknown>)[expression]

  if (typeof breached !== 'boolean') return undefined

  // The inversion. `true` is a breach, so a pass is the other one.
  return breached !== BREACHED
}

// ---------------------------------------------------------------------------
// Sub-metric selectors, and the vacuous pass
// ---------------------------------------------------------------------------

export interface MetricKey {
  /** The base metric, e.g. `http_req_duration`. */
  readonly name: string
  /** The tag selector, e.g. `phase:recovery`, or undefined for the whole metric. */
  readonly selector: string | undefined
}

const METRIC_KEY_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\{(.+)\})?$/

/**
 * Splits a threshold map key into its metric and its tag selector.
 *
 * @throws on a key k6 would not accept, including the easy mistake of an
 *   unclosed brace, which k6 reads as part of the metric name and then scores
 *   against a metric that will never exist.
 */
export function parseMetricKey(key: string): MetricKey {
  const match = METRIC_KEY_PATTERN.exec(key)

  if (!match || !match[1]) {
    throw new Error(
      `Invalid threshold metric key: ${JSON.stringify(key)}. ` +
        'Expected `metric_name` or `metric_name{tag:value}`.',
    )
  }

  return { name: match[1], selector: match[2] }
}

/**
 * A sub-metric that collected nothing, as k6 exports it.
 *
 * Every aggregate is zero because that is what k6 reports for an empty metric
 * — not null, not absent. Measured on k6 v1.3.0; see `config.ts`'s witness
 * note on `spikeProfile`.
 */
export const EMPTY_SUBMETRIC: SummaryMetric = {
  avg: 0,
  min: 0,
  med: 0,
  max: 0,
  'p(90)': 0,
  'p(95)': 0,
  'p(99)': 0,
  count: 0,
  rate: 0,
  value: 0,
  passes: 0,
  fails: 0,
}

/**
 * Whether a threshold would pass against a sub-metric that collected nothing.
 *
 * This is the test for whether a threshold has teeth when its selector matches
 * no requests. `p(95)<500` passes (0 < 500) and enforces nothing; `count>0`
 * fails, which is what makes it usable as a witness. A group of sub-metric
 * thresholds is only a gate if at least one of them answers false here.
 */
export function passesVacuously(parsed: ParsedThreshold): boolean {
  const outcome = evaluateThreshold(parsed, EMPTY_SUBMETRIC)

  // Unverifiable cannot happen against EMPTY_SUBMETRIC for any aggregate the
  // parser accepts except an unusual percentile, which is treated as toothless
  // because it cannot be shown to have teeth.
  return !outcome.verifiable || outcome.passed
}
