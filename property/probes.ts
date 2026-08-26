/**
 * The five ways this repository puts a system under test, and the matrix
 * derived by running all five against all ten faults.
 *
 * A probe is deliberately a small thing: hand it an `AvailabilityApi` and it
 * says whether it noticed anything wrong with it, and which check noticed
 * first. That is enough to turn "properties catch more than examples" from an
 * opinion into a table, and it is the same shape `tdd/doubles/probes.ts` uses
 * for the test-double taxonomy — the reader sees the probe, and the matrix is
 * measured from the probe they saw.
 *
 * Four of the five probes run the *same twenty invariants*. They differ only
 * in the arbitrary underneath, which is the point of the exercise: a property
 * suite's reach is decided by its generator, and two suites with identical
 * predicates can have entirely different detection sets.
 *
 * Each probe stops at its first catch. What is being measured is whether the
 * bug is noticed at all, and running the remaining nineteen invariants against
 * an already-condemned system would multiply the cost of the matrix by twenty
 * to learn nothing. The check that *did* catch it is recorded, because "which
 * property saw this" is the interesting half of the answer.
 */

import fc from 'fast-check'
import { availability, type AvailabilityApi, type Interval } from './availability'
import { sampleNamed, type SampleId } from './arbitraries'
import { NUM_RUNS, RUN, SEED } from './config'
import type { Inputs } from './coverage'
import { EXAMPLES, valuesMatch } from './examples'
import { invariantsFor } from './invariants'

/** One call made against the system, with the arguments it was made with. */
export interface RecordedCall extends Inputs {
  readonly operation: string
}

/**
 * An API that answers exactly as the one it wraps and remembers what it was
 * asked.
 *
 * Used only by `inputs()` below, to find out what the example corpus actually
 * puts in front of the system without writing those inputs down a second time
 * next to the examples themselves. A duplicated copy of the arguments would
 * drift; a spy cannot.
 */
export function recordingApi(base: AvailabilityApi): {
  api: AvailabilityApi
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []

  const record = (operation: string, a: readonly Interval[], b: readonly Interval[]): void => {
    calls.push({ operation, a, b })
  }

  const api: AvailabilityApi = {
    normalise: (intervals) => {
      record('normalise', intervals, [])

      return base.normalise(intervals)
    },
    union: (a, b) => {
      record('union', a, b)

      return base.union(a, b)
    },
    intersect: (a, b) => {
      record('intersect', a, b)

      return base.intersect(a, b)
    },
    subtract: (a, b) => {
      record('subtract', a, b)

      return base.subtract(a, b)
    },
    covers: (intervals, point) => {
      record('covers', intervals, [])

      return base.covers(intervals, point)
    },
    duration: (intervals) => {
      record('duration', intervals, [])

      return base.duration(intervals)
    },
  }

  return { api, calls }
}

export const PROBE_IDS = ['examples', 'bounded', 'sparse', 'wide', 'clustered'] as const

export type ProbeId = (typeof PROBE_IDS)[number]

export interface ProbeResult {
  readonly caught: boolean
  /** The example or invariant that noticed, in declaration order. */
  readonly caughtBy: string | null
}

export interface Probe {
  readonly id: ProbeId
  /** One line, in the README's table. */
  readonly label: string
  readonly kind: 'examples' | 'properties'
  readonly run: (api: AvailabilityApi, params?: fc.Parameters<unknown>) => ProbeResult
  /** The inputs this probe puts in front of the system, for `coverage.ts`. */
  readonly inputs: (params?: fc.Parameters<unknown>) => Inputs[]
}

const examplesProbe: Probe = {
  id: 'examples',
  label: `${EXAMPLES.length} hand-written cases`,
  kind: 'examples',
  run: (api) => {
    for (const example of EXAMPLES) {
      let actual: ReturnType<typeof example.actual>

      try {
        actual = example.actual(api)
      } catch {
        return { caught: true, caughtBy: example.id }
      }

      if (!valuesMatch(actual, example.expected)) {
        return { caught: true, caughtBy: example.id }
      }
    }

    return { caught: false, caughtBy: null }
  },
  inputs: () => {
    const { api, calls } = recordingApi(availability)

    for (const example of EXAMPLES) {
      example.actual(api)
    }

    return calls
  },
}

const propertyProbe = (id: Exclude<ProbeId, 'examples'>): Probe => {
  const sample = sampleNamed(id satisfies SampleId)

  return {
    id,
    label: sample.label,
    kind: 'properties',
    run: (api, params = RUN) => {
      for (const invariant of invariantsFor(sample)) {
        if (invariant.check(api, sample, params).failed) {
          return { caught: true, caughtBy: invariant.id }
        }
      }

      return { caught: false, caughtBy: null }
    },
    // `fc.sample` takes its own `Parameters`, so the two fields that matter
    // are read off the run parameters rather than passed through: handing it a
    // `Parameters<unknown>` would pin its element type to `unknown`.
    inputs: (params = RUN) =>
      fc
        .sample(sample.scenario, { seed: params.seed ?? SEED, numRuns: params.numRuns ?? NUM_RUNS })
        .map(({ a, b }) => ({ a, b })),
  }
}

export const PROBES: readonly Probe[] = [
  examplesProbe,
  propertyProbe('bounded'),
  propertyProbe('sparse'),
  propertyProbe('wide'),
  propertyProbe('clustered'),
]

export function probeNamed(id: ProbeId): Probe {
  const probe = PROBES.find((candidate) => candidate.id === id)

  if (probe === undefined) {
    throw new Error(`no probe named ${id}`)
  }

  return probe
}
