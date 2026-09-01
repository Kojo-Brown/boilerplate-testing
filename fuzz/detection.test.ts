// @vitest-environment node
//
// Compiles variants of `config.ts` and imports them off disk, which needs the
// node environment for the same reason `snapshot/detection.test.ts` does:
// jsdom's `import.meta.url` is not a file URL, so `fileURLToPath` throws
// before a single test runs.
import { describe, expect, it } from 'vitest'

import { PROBE_IDS, runProbe, type ProbeId } from './campaign.ts'
import { CROSSOVER, DETECTIONS, probesThatFound } from './corpus.ts'
import { applyEdits, VARIANTS, VARIANT_IDS, type VariantId } from './edits.ts'
import { GENERATOR_IDS } from './generators.ts'
import { configSource, loadControl, loadVariant } from './load.ts'

/**
 * The matrix: five probes against sixteen faults, re-measured for real.
 *
 * This is the audit that keeps `corpus.ts` honest. The committed corpus is a
 * fast regression gate and, on its own, a screenshot — a set of inputs that
 * once reproduced something, replayed forever, agreeing with itself. This
 * suite runs the campaigns again from the seed and fails if the live result
 * and the recorded one disagree in either direction: a fault the campaign
 * stopped finding, or one it started finding, both mean `pnpm fuzz:record`
 * needs running and the README needs rereading.
 *
 * ---------------------------------------------------------------------------
 * The control comes first
 * ---------------------------------------------------------------------------
 * `config.ts` compiled through the same pipeline, unedited, must be clean
 * under all five probes. Without that check a harness that had broken —
 * a stripped type that was load-bearing, a stale temporary file, an oracle
 * throwing on its own — would make every variant look caught, and the matrix
 * would report a perfect score produced entirely by a bug in the measurement.
 * `tdd/characterisation/detection.test.ts` compiles its control first for the
 * same reason.
 */

describe('the control', () => {
  it('compiles and behaves like the module under test', async () => {
    const control = await loadControl()

    expect(control.parseJson('{"a":[1,2]}')).toStrictEqual({ a: [1, 2] })
    expect(control.loadConfig('nonsense')).toMatchObject({ ok: false, stage: 'parse' })
  })

  it.each(PROBE_IDS)('%s finds nothing wrong with it', async (probe) => {
    const control = await loadControl()
    const result = runProbe(control, probe)

    expect(result.finding).toBeNull()
  })
})

describe('every variant is a real, single change to the real source', () => {
  it.each(VARIANTS.map((variant) => [variant.id, variant] as const))(
    '%s edits the source exactly once per edit',
    (_id, variant) => {
      const source = configSource()

      for (const edit of variant.edits) {
        expect(source.split(edit.from).length - 1).toBe(1)
      }

      expect(applyEdits(source, variant.edits)).not.toBe(source)
    },
  )

  it('refuses an edit that matches nothing', () => {
    expect(() => applyEdits('abc', [{ from: 'zzz', to: '' }])).toThrow(/matched 0 times/)
  })

  it('refuses an edit that matches twice', () => {
    expect(() => applyEdits('abcabc', [{ from: 'abc', to: '' }])).toThrow(/matched 2 times/)
  })

  it('describes each fault in a sentence', () => {
    for (const variant of VARIANTS) {
      expect(variant.description.length).toBeGreaterThan(20)
    }
  })

  it('lists every declared id exactly once', () => {
    expect(VARIANTS.map((variant) => variant.id)).toStrictEqual([...VARIANT_IDS])
  })
})

describe('the live matrix agrees with the recorded corpus', () => {
  it.each(VARIANT_IDS)(
    '%s is found by exactly the probes corpus.ts records',
    async (id) => {
      const subject = await loadVariant(id)
      const live = PROBE_IDS.filter((probe) => runProbe(subject, probe).finding !== null)

      expect(live).toStrictEqual(probesThatFound(id))
    },
    30_000,
  )

  it('records a reason for every detection and nothing else', () => {
    for (const detection of DETECTIONS) {
      expect(VARIANT_IDS).toContain(detection.variant)
      expect(PROBE_IDS).toContain(detection.probe)
      expect(detection.reason.length).toBeGreaterThan(0)
    }
  })

  it('holds at most one row per fault and probe', () => {
    const keys = DETECTIONS.map((detection) => `${detection.variant}/${detection.probe}`)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

/**
 * The findings the matrix is quoted for.
 *
 * Stated as tests rather than as prose so that a change to the subject, the
 * generators or the oracles that invalidates one of them fails here instead of
 * leaving a wrong sentence in a README. Every claim below is computed from
 * `DETECTIONS`, which `the live matrix agrees with the recorded corpus` has
 * just re-derived from a real campaign.
 */
describe('what the matrix says', () => {
  const foundBy = (probe: ProbeId): VariantId[] =>
    VARIANT_IDS.filter((id) => probesThatFound(id).includes(probe))

  const parserFaults = VARIANTS.filter((variant) => variant.half === 'parser').map(({ id }) => id)
  const validatorFaults = VARIANTS.filter((variant) => variant.half === 'validator').map(
    ({ id }) => id,
  )

  it('the crash oracle finds one fault in sixteen', () => {
    expect(foundBy('crash')).toStrictEqual(['NO_DEPTH_LIMIT'])
  })

  it('the one crash is found by three of the four oracles, not only by crash', () => {
    // A crash is not an oracle's verdict; it is the absence of one. Any probe
    // that runs the subject reports it, which is why "we fuzzed it and it
    // never crashed" is a claim about the runtime rather than the program.
    expect(probesThatFound('NO_DEPTH_LIMIT')).toContain('roundtrip')
    expect(probesThatFound('NO_DEPTH_LIMIT')).toContain('invariant')
  })

  it('the strongest oracle is the one that misses the crash', () => {
    // `differential` excuses input past `MAX_DEPTH` because the depth limit is
    // a declared divergence from `JSON.parse` — so it never runs the subject
    // on the documents that expose the missing guard. An excuse list is a hole
    // with a comment above it.
    expect(probesThatFound('NO_DEPTH_LIMIT')).not.toContain('differential')
  })

  it('the differential oracle finds parser faults and no validator fault at all', () => {
    const found = foundBy('differential')

    expect(found.every((id) => parserFaults.includes(id))).toBe(true)
    expect(found.length).toBe(8)
  })

  it('the invariant oracle is the only one that reaches the validator', () => {
    const validatorFound = validatorFaults.filter((id) => probesThatFound(id).length > 1)

    for (const id of validatorFound) {
      expect(probesThatFound(id)).toContain('invariant')
    }
  })

  it('the round-trip oracle finds two faults, being a comparison of a subject with itself', () => {
    expect(foundBy('roundtrip')).toHaveLength(2)
  })

  it('the automated probes together miss exactly the two faults that reject valid input', () => {
    // The headline. Every oracle here is a statement about what the subject
    // *accepts*; nothing in a fuzzing campaign generates a known-good input
    // and demands that it be accepted. So over-rejection is invisible by
    // construction, and both faults in the corpus of that shape survive.
    const missed = VARIANT_IDS.filter(
      (id) => probesThatFound(id).filter((probe) => probe !== 'examples').length === 0,
    )

    expect(missed).toStrictEqual(['EXPONENT_PLUS_REJECTED', 'RATIO_UPPER_BOUND_EXCLUSIVE'])

    for (const id of missed) {
      expect(VARIANTS.find((variant) => variant.id === id)?.direction).toBe('over-rejects')
    }
  })

  it('the example suite catches all sixteen, which is the number to distrust', () => {
    // Circular by construction: the same person wrote the examples and the
    // faults. `property/README.md` reports the same problem and it is the
    // reason the interesting column is the *disagreement* rather than this
    // total. See README.md.
    expect(foundBy('examples')).toStrictEqual([...VARIANT_IDS])
  })

  it('the automated probes are a strict subset of the examples on this corpus', () => {
    // Stated rather than glossed over. Every fault the campaign found, a
    // hand-written case found too, so nothing in this directory's own numbers
    // says fuzzing pays for itself — see README.md for the part the matrix
    // cannot express, which is that one list was written knowing the answers
    // and the other was not.
    const automated = VARIANT_IDS.filter((id) =>
      probesThatFound(id).some((probe) => probe !== 'examples'),
    )
    const byExamples = foundBy('examples')

    expect(automated.every((id) => byExamples.includes(id))).toBe(true)
    expect(automated.length).toBeLessThan(byExamples.length)
  })

  it('every fault is caught by something', () => {
    for (const id of VARIANT_IDS) {
      expect(probesThatFound(id).length).toBeGreaterThan(0)
    }
  })
})

/**
 * The other half of the argument: hold the oracle still, vary the generator.
 *
 * Four faults, one oracle each, four campaigns per row. Re-measured here for
 * the same reason the main matrix is — a recorded table that nothing re-derives
 * is a table that was true once.
 */
describe('the same oracle, four generators', () => {
  it.each(CROSSOVER.map((row) => [`${row.variant} / ${row.probe}`, row] as const))(
    '%s is found by exactly the generators corpus.ts records',
    async (_label, row) => {
      const subject = await loadVariant(row.variant)
      const live = GENERATOR_IDS.filter(
        (generator) => runProbe(subject, row.probe, { generator }).finding !== null,
      )

      expect(live).toStrictEqual(row.foundBy)
    },
    30_000,
  )

  it('the naive generator finds none of them', () => {
    for (const row of CROSSOVER) {
      expect(row.foundBy).not.toContain('random')
    }
  })

  it('the two specialised generators each miss something the other finds', () => {
    const mutateOnly = CROSSOVER.filter(
      (row) => row.foundBy.includes('mutate') && !row.foundBy.includes('grammar'),
    )
    const grammarOnly = CROSSOVER.filter(
      (row) => row.foundBy.includes('grammar') && !row.foundBy.includes('mutate'),
    )

    expect(mutateOnly.length).toBeGreaterThan(0)
    expect(grammarOnly.length).toBeGreaterThan(0)
  })

  it('the rotation finds all of them', () => {
    for (const row of CROSSOVER) {
      expect(row.foundBy).toContain('mixed')
    }
  })
})
