/**
 * The properties, as data.
 *
 * Every invariant below is declared once and used three ways: `fc.assert`ed
 * against the real system in `invariants.test.ts`, `fc.check`ed against each
 * broken system in `detection.test.ts`, and quoted verbatim in `README.md`
 * under a test that compares the two. A property that exists in the README and
 * not here — or the reverse — fails `pnpm test`.
 *
 * ---------------------------------------------------------------------------
 * Three families, and why the weak ones are still worth writing
 * ---------------------------------------------------------------------------
 * **Structural** properties describe the *shape* of an output: sorted,
 * non-empty, non-touching, built only from coordinates the caller supplied.
 * They are the cheapest to write and they catch a class of bug nothing else
 * can — `[0, 5)` and `[5, 9)` left unmerged cover exactly the same points as
 * `[0, 9)`, so no comparison of *what* is covered will ever notice.
 *
 * **Metamorphic** properties relate two runs of the system to each other:
 * normalising twice changes nothing, intersection is commutative, subtracting
 * a set from itself leaves nothing. They need no oracle, which is what makes
 * them the family that works on any input domain — including the fractional
 * and negative coordinates the model cannot enumerate.
 *
 * **Model** properties compare the system against the obviously-correct
 * reference in `model.ts`. This is the strongest family and the most
 * constrained: the model enumerates covered points, so it only runs over small
 * integers. Everything a system can get wrong outside that range is invisible
 * to it.
 *
 * A system can satisfy every structural and metamorphic property here and
 * still be wrong — returning `[]` for everything is idempotent, commutative,
 * impeccably sorted and useless — which is the argument for having a model at
 * all. It can also satisfy every model property and still be wrong, which is
 * the argument for not stopping there. `detection.test.ts` measures both
 * directions rather than asserting either.
 */

import fc from 'fast-check'
import { sameIntervals, type AvailabilityApi, type Interval } from './availability'
import { frozen, type Sample, type Scenario } from './arbitraries'
import { RUN } from './config'
import {
  fromPoints,
  intersectPoints,
  samePoints,
  subtractPoints,
  toPoints,
  unionPoints,
} from './model'

/** Which of the three families an invariant belongs to. */
export const FAMILIES = ['structural', 'metamorphic', 'model'] as const

export type Family = (typeof FAMILIES)[number]

/**
 * Where an invariant is meaningful.
 *
 * `any` holds over the whole coordinate space. `bounded` needs small integers —
 * either because it compares against the point-set model, or because it does
 * arithmetic on coordinates and floating-point subtraction is not associative.
 */
export type Domain = 'any' | 'bounded'

/** What `check` reports back, with fast-check's own details erased. */
export interface CheckOutcome {
  readonly failed: boolean
  readonly numRuns: number
  readonly numShrinks: number
  readonly counterexample: unknown
  /** fast-check's report, for a failure message. */
  readonly report: string | null
}

export interface Invariant {
  readonly id: string
  /** The property in one sentence, as it appears in README.md. */
  readonly statement: string
  readonly family: Family
  readonly domain: Domain
  /** The operation it constrains, for grouping in the README. */
  readonly operation: string
  /**
   * The predicate itself.
   *
   * Exposed because `shrinking.ts` has to re-test a reduced counterexample
   * directly: a shrinker that walked off the edge and handed back an input
   * that passes is a worse failure than no shrinking at all, and it is not
   * something fast-check's own report would tell you.
   */
  readonly holds: (api: AvailabilityApi, scenario: Scenario) => boolean
  /** Throw on a counterexample, the way a test wants to. */
  readonly assert: (api: AvailabilityApi, sample: Sample, params?: fc.Parameters<unknown>) => void
  /** Report on a counterexample, the way a probe wants to. */
  readonly check: (
    api: AvailabilityApi,
    sample: Sample,
    params?: fc.Parameters<unknown>,
  ) => CheckOutcome
}

interface InvariantSpec {
  readonly id: string
  readonly statement: string
  readonly family: Family
  readonly domain: Domain
  readonly operation: string
  readonly holds: (api: AvailabilityApi, scenario: Scenario) => boolean
}

function defineInvariant(spec: InvariantSpec): Invariant {
  const property = (api: AvailabilityApi, sample: Sample): fc.IPropertyWithHooks<[Scenario]> =>
    fc.property(sample.scenario, (scenario) => spec.holds(api, scenario))

  return {
    id: spec.id,
    statement: spec.statement,
    family: spec.family,
    domain: spec.domain,
    operation: spec.operation,
    holds: spec.holds,
    assert: (api, sample, params = RUN) => {
      fc.assert(property(api, sample), params)
    },
    check: (api, sample, params = RUN) => {
      const details = fc.check(property(api, sample), params)

      return {
        failed: details.failed,
        numRuns: details.numRuns,
        numShrinks: details.numShrinks,
        counterexample: details.counterexample,
        report: details.failed ? (fc.defaultReportMessage(details) ?? null) : null,
      }
    },
  }
}

/** Every coordinate in `intervals`, split by which end of a range it is. */
const endpointsOf = (
  intervals: readonly Interval[],
): { starts: ReadonlySet<number>; ends: ReadonlySet<number> } => ({
  starts: new Set(intervals.map((candidate) => candidate.start)),
  ends: new Set(intervals.map((candidate) => candidate.end)),
})

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

const structural: readonly Invariant[] = [
  defineInvariant({
    id: 'normalise/canonical-form',
    operation: 'normalise',
    family: 'structural',
    domain: 'any',
    statement:
      'the output is sorted by start, contains no empty range, and no two consecutive ranges ' +
      'overlap or touch',
    holds: (api, { a }) => {
      const result = api.normalise(a)

      return result.every((candidate, index) => {
        if (candidate.end <= candidate.start) {
          return false
        }

        const previous = result[index - 1]

        return previous === undefined || candidate.start > previous.end
      })
    },
  }),

  defineInvariant({
    id: 'normalise/uses-input-endpoints',
    operation: 'normalise',
    family: 'structural',
    domain: 'any',
    statement:
      'every start in the output is a start the caller supplied, and every end is an end the ' +
      'caller supplied — merging chooses among coordinates, it never invents one',
    holds: (api, { a }) => {
      const { starts, ends } = endpointsOf(a)

      return api
        .normalise(a)
        .every((candidate) => starts.has(candidate.start) && ends.has(candidate.end))
    },
  }),

  defineInvariant({
    id: 'normalise/does-not-mutate-input',
    operation: 'normalise',
    family: 'structural',
    domain: 'any',
    statement: 'the caller’s array and ranges come back untouched',
    holds: (api, { a }) => {
      // `readonly Interval[]` is erased before anything runs. Freezing is how
      // the property actually observes an in-place sort: modules are strict
      // mode, so the write throws instead of succeeding quietly.
      try {
        api.normalise(frozen(a))

        return true
      } catch {
        return false
      }
    },
  }),

  defineInvariant({
    id: 'subtract/output-already-normalised',
    operation: 'subtract',
    family: 'structural',
    domain: 'any',
    statement:
      'subtract returns a canonical set directly, so normalising it again changes nothing',
    holds: (api, { a, b }) => {
      const difference = api.subtract(a, b)

      return sameIntervals(api.normalise(difference), difference)
    },
  }),
]

// ---------------------------------------------------------------------------
// Metamorphic
// ---------------------------------------------------------------------------

const metamorphic: readonly Invariant[] = [
  defineInvariant({
    id: 'normalise/idempotent',
    operation: 'normalise',
    family: 'metamorphic',
    domain: 'any',
    statement: 'normalising an already-normalised set returns it unchanged',
    holds: (api, { a }) => {
      const once = api.normalise(a)

      return sameIntervals(api.normalise(once), once)
    },
  }),

  defineInvariant({
    id: 'normalise/preserves-covered-points',
    operation: 'normalise',
    family: 'metamorphic',
    domain: 'any',
    statement: 'a point is covered by the normalised set exactly when it was covered before',
    holds: (api, { a, point }) => api.covers(api.normalise(a), point) === api.covers(a, point),
  }),

  defineInvariant({
    id: 'union/commutative',
    operation: 'union',
    family: 'metamorphic',
    domain: 'any',
    statement: 'union gives the same answer whichever way round its operands are',
    holds: (api, { a, b }) => sameIntervals(api.union(a, b), api.union(b, a)),
  }),

  defineInvariant({
    id: 'union/covers-either-operand',
    operation: 'union',
    family: 'metamorphic',
    domain: 'any',
    statement: 'the union covers a point exactly when at least one operand does',
    holds: (api, { a, b, point }) =>
      api.covers(api.union(a, b), point) === (api.covers(a, point) || api.covers(b, point)),
  }),

  defineInvariant({
    id: 'intersect/commutative',
    operation: 'intersect',
    family: 'metamorphic',
    domain: 'any',
    statement: 'intersection gives the same answer whichever way round its operands are',
    holds: (api, { a, b }) => sameIntervals(api.intersect(a, b), api.intersect(b, a)),
  }),

  defineInvariant({
    id: 'intersect/covers-both-operands',
    operation: 'intersect',
    family: 'metamorphic',
    domain: 'any',
    statement: 'the intersection covers a point exactly when both operands do',
    holds: (api, { a, b, point }) =>
      api.covers(api.intersect(a, b), point) === (api.covers(a, point) && api.covers(b, point)),
  }),

  defineInvariant({
    id: 'intersect/self-is-normalise',
    operation: 'intersect',
    family: 'metamorphic',
    domain: 'any',
    statement: 'a set intersected with itself is that set, normalised',
    holds: (api, { a }) => sameIntervals(api.intersect(a, a), api.normalise(a)),
  }),

  defineInvariant({
    id: 'subtract/covers-difference',
    operation: 'subtract',
    family: 'metamorphic',
    domain: 'any',
    statement:
      'the difference covers a point exactly when the first operand covered it and the second ' +
      'did not',
    holds: (api, { a, b, point }) =>
      api.covers(api.subtract(a, b), point) === (api.covers(a, point) && !api.covers(b, point)),
  }),

  defineInvariant({
    id: 'subtract/self-is-empty',
    operation: 'subtract',
    family: 'metamorphic',
    domain: 'any',
    statement: 'a set with itself removed leaves nothing',
    holds: (api, { a }) => api.subtract(a, a).length === 0,
  }),

  defineInvariant({
    id: 'subtract/empty-removal-is-normalise',
    operation: 'subtract',
    family: 'metamorphic',
    domain: 'any',
    statement: 'removing nothing from a set is the same as normalising it',
    holds: (api, { a }) => sameIntervals(api.subtract(a, []), api.normalise(a)),
  }),

  defineInvariant({
    id: 'duration/inclusion-exclusion',
    operation: 'duration',
    family: 'metamorphic',
    domain: 'bounded',
    statement:
      'the covered length of the union plus that of the intersection equals the two operands’ ' +
      'lengths added together',
    // Bounded rather than `any` because this is the one invariant that adds
    // coordinates together. Over doubles the two sides differ in the last bit
    // for reasons that are floating-point arithmetic's rather than the
    // system's, and a tolerance would make it blind to the small errors it
    // exists to catch.
    holds: (api, { a, b }) =>
      api.duration(api.union(a, b)) + api.duration(api.intersect(a, b)) ===
      api.duration(a) + api.duration(b),
  }),
]

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const model: readonly Invariant[] = [
  defineInvariant({
    id: 'normalise/matches-point-model',
    operation: 'normalise',
    family: 'model',
    domain: 'bounded',
    statement: 'normalising a set gives the canonical cover of exactly the points it covered',
    holds: (api, { a }) => sameIntervals(api.normalise(a), fromPoints(toPoints(a))),
  }),

  defineInvariant({
    id: 'union/matches-point-model',
    operation: 'union',
    family: 'model',
    domain: 'bounded',
    statement: 'the union covers the union of the two point sets',
    holds: (api, { a, b }) =>
      samePoints(toPoints(api.union(a, b)), unionPoints(toPoints(a), toPoints(b))),
  }),

  defineInvariant({
    id: 'intersect/matches-point-model',
    operation: 'intersect',
    family: 'model',
    domain: 'bounded',
    statement: 'the intersection covers the intersection of the two point sets',
    holds: (api, { a, b }) =>
      samePoints(toPoints(api.intersect(a, b)), intersectPoints(toPoints(a), toPoints(b))),
  }),

  defineInvariant({
    id: 'subtract/matches-point-model',
    operation: 'subtract',
    family: 'model',
    domain: 'bounded',
    statement: 'the difference covers the difference of the two point sets',
    holds: (api, { a, b }) =>
      samePoints(toPoints(api.subtract(a, b)), subtractPoints(toPoints(a), toPoints(b))),
  }),

  defineInvariant({
    id: 'duration/is-point-count',
    operation: 'duration',
    family: 'model',
    domain: 'bounded',
    statement: 'the covered length equals the number of points covered',
    holds: (api, { a }) => api.duration(a) === toPoints(a).size,
  }),
]

/** Every invariant, structural first, then metamorphic, then model. */
export const INVARIANTS: readonly Invariant[] = [...structural, ...metamorphic, ...model]

/** The subset that is meaningful over a given arbitrary. */
export const invariantsFor = (sample: Sample): readonly Invariant[] =>
  INVARIANTS.filter((invariant) => invariant.domain === 'any' || sample.modelled)

export function invariantNamed(id: string): Invariant {
  const invariant = INVARIANTS.find((candidate) => candidate.id === id)

  if (invariant === undefined) {
    throw new Error(`no invariant named ${id}`)
  }

  return invariant
}
