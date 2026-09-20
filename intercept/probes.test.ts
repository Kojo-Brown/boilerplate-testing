/**
 * The probe catalogue's own invariants.
 *
 * Small, and the reason it exists at all is that `probes.ts` is a table two
 * other files index into by name. A duplicate name, an empty vocabulary or a
 * probe with no question would each produce a plausible-looking matrix built
 * on a column nobody can read.
 */

import { describe, expect, it } from 'vitest'

import { ALL_OUTCOMES, PROBES, PROBE_NAMES, probeByName } from './probes'

describe('the probe catalogue', () => {
  it('names every probe exactly once', () => {
    expect(new Set(PROBE_NAMES).size).toBe(PROBE_NAMES.length)
  })

  it('gives every probe a question and a reason it is worth a column', () => {
    for (const probe of PROBES) {
      expect(probe.question.length, `${probe.name} asks nothing`).toBeGreaterThan(0)
      expect(probe.note.length, `${probe.name} has no note`).toBeGreaterThan(0)
    }
  })

  it('ends every question with a question mark, because every one of them is one', () => {
    for (const probe of PROBES) {
      expect(probe.question.endsWith('?'), `${probe.name}: ${probe.question}`).toBe(true)
    }
  })

  it('gives every probe at least two possible answers', () => {
    // A probe with one outcome is a constant, and a column of constants in a
    // comparison matrix is a column nobody can learn anything from.
    for (const probe of PROBES) {
      expect(probe.outcomes.length, `${probe.name} has ${probe.outcomes.length} outcome(s)`)
        .toBeGreaterThan(1)
    }
  })

  it('lists each probe’s outcomes without repeating one', () => {
    for (const probe of PROBES) {
      expect(new Set(probe.outcomes).size, `${probe.name} repeats an outcome`).toBe(
        probe.outcomes.length,
      )
    }
  })

  it('finds a probe by name and nothing by a name it does not have', () => {
    expect(probeByName('known-get')?.name).toBe('known-get')
    expect(probeByName('unknown-get')).toBeUndefined()
  })

  it('collects every outcome word once across the whole catalogue', () => {
    expect(new Set(ALL_OUTCOMES).size).toBe(ALL_OUTCOMES.length)
    expect(ALL_OUTCOMES).toContain('failed')
    expect(ALL_OUTCOMES).toContain('stale')
  })

  it('keeps `failed` available to every probe that can be asked of a dead network', () => {
    // Four probes cannot fail — they are questions about the page's beliefs
    // and about the test's own observations, which have an answer either way.
    // `as readonly string[]` because `PROBES` is `as const`: the tuple's own
    // `includes` narrows its argument to the intersection of the literal
    // types, which is `never` across a heterogeneous catalogue.
    const cannotFail = PROBES.filter(
      (probe) => !(probe.outcomes as readonly string[]).includes('failed'),
    )

    expect(cannotFail.map((probe) => probe.name)).toEqual([
      'reaches-origin',
      'online-flag',
      'offline-event',
      'observed-by-test',
    ])
  })
})
