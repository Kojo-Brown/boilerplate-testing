/**
 * Joining "what layer is this file" to "how many tests does it hold".
 *
 * `classify.ts` answers the first from the source; `collect.ts` answers the
 * second from the runners. Neither is much use alone, and the join is where
 * the interesting failures live — a file one side knows about and the other
 * does not is always a bug in something, and the whole point of doing this at
 * all is that those bugs are silent otherwise.
 *
 * Four of them, each reported rather than smoothed over:
 *
 *   - **Uncollected.** A test file exists on disk and no runner will run a
 *     single test from it. Usually an include glob that stopped matching after
 *     a rename, which is the failure mode where a suite gets quieter and
 *     greener at the same time.
 *   - **Unknown.** A runner collected a file the walker did not find. Means the
 *     two disagree about what a test file is, and the ratio is being computed
 *     over a set nobody has looked at.
 *   - **Double-counted.** Two runners claim the same file, so its tests would
 *     count twice.
 *   - **Stale exception.** A file listed in `EXPECTED_EMPTY` that now collects
 *     tests. The exception has outlived its reason and should go.
 */

import { LAYERS, type Layer } from './boundaries.ts'
import { classifyRepository, REPO_ROOT, type Evidence } from './classify.ts'
import { collectCensus, EXPECTED_EMPTY, type Census } from './collect.ts'
import { evaluate, measure, POLICY, type Measurement, type Policy, type Violation } from './policy.ts'

/** A test file with both halves of the answer attached. */
export interface CountedFile {
  readonly file: string
  readonly layer: Layer
  /** Test cases the runners will run from it. */
  readonly count: number
  readonly evidence: readonly Evidence[]
}

/** Something the census will not vouch for. */
export type CensusProblem =
  | { readonly kind: 'unclassified-module'; readonly detail: string }
  | { readonly kind: 'unparsable-file'; readonly detail: string }
  | { readonly kind: 'uncollected-file'; readonly detail: string }
  | { readonly kind: 'unknown-file'; readonly detail: string }
  | { readonly kind: 'double-counted-file'; readonly detail: string }
  | { readonly kind: 'stale-exception'; readonly detail: string }

export interface FullCensus {
  readonly files: readonly CountedFile[]
  readonly measurement: Measurement
  readonly violations: readonly Violation[]
  readonly problems: readonly CensusProblem[]
  /** Kept for the report: which runner found what. */
  readonly collected: Census
}

/**
 * Run the whole census.
 *
 * `collect` is injectable so the join can be tested against counts that are
 * written down rather than measured — testing a ratio gate by running the real
 * suite would make the test's expectations change every time anyone adds a
 * test, which is the one thing a gate must not do to its own tests.
 */
export function runCensus(
  options: {
    readonly root?: string
    readonly collect?: () => Census
    readonly policy?: Policy
  } = {},
): FullCensus {
  const root = options.root ?? REPO_ROOT
  const policy = options.policy ?? POLICY
  const classification = classifyRepository(root)
  const collected = (options.collect ?? collectCensus)()

  const problems: CensusProblem[] = []

  for (const module of classification.unclassified) {
    problems.push({
      kind: 'unclassified-module',
      detail:
        `${module.file} imports ${module.binding === null ? module.specifier : `{ ${module.binding} } from ${module.specifier}`}` +
        `, which shape/boundaries.ts does not classify. Add it as \`pure\` or as a ` +
        `boundary — an unclassified module counts as a unit test by default, which ` +
        `is the wrong way for this to fail.`,
    })
  }

  for (const file of classification.unparsable) {
    problems.push({
      kind: 'unparsable-file',
      detail: `${file.file} could not be parsed, so its imports are unknown: ${file.message}`,
    })
  }

  for (const { file, runners } of collected.doubleCounted) {
    problems.push({
      kind: 'double-counted-file',
      detail: `${file} was collected by more than one runner (${runners.join(', ')}), so its tests would count twice.`,
    })
  }

  const classifiedPaths = new Set(classification.files.map((file) => file.file))

  for (const file of Object.keys(collected.counts)) {
    if (!classifiedPaths.has(file)) {
      problems.push({
        kind: 'unknown-file',
        detail:
          `${file} was collected by a runner but is not a test file by shape/classify.ts's ` +
          `reckoning, so it has no layer and is missing from the ratio.`,
      })
    }
  }

  const expectedEmpty = new Set(EXPECTED_EMPTY)
  const files: CountedFile[] = []

  for (const classified of classification.files) {
    const count = collected.counts[classified.file] ?? 0

    if (count === 0 && !expectedEmpty.has(classified.file)) {
      problems.push({
        kind: 'uncollected-file',
        detail:
          `${classified.file} is a test file that no runner collects a single test from. ` +
          `Either an include glob no longer matches it, or its suite throws during ` +
          `collection. Add it to EXPECTED_EMPTY in shape/collect.ts only with a reason.`,
      })
    }

    files.push({
      file: classified.file,
      layer: classified.layer,
      count,
      evidence: classified.evidence,
    })
  }

  for (const file of EXPECTED_EMPTY) {
    if ((collected.counts[file] ?? 0) > 0) {
      problems.push({
        kind: 'stale-exception',
        detail:
          `${file} is listed in EXPECTED_EMPTY but now collects ` +
          `${collected.counts[file]} tests. Remove the exception.`,
      })
    }
  }

  const counts = Object.fromEntries(LAYERS.map((layer) => [layer, 0])) as Record<Layer, number>

  for (const file of files) {
    counts[file.layer] += file.count
  }

  const measurement = measure(counts)

  return {
    files: files.sort((a, b) => a.file.localeCompare(b.file)),
    measurement,
    violations: evaluate(measurement, policy),
    problems,
    collected,
  }
}
