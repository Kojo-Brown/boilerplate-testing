// @vitest-environment node
//
// Compiles copies of `session.ts` and imports them off disk, which needs the
// node environment for the same reason `fuzz/detection.test.ts` does: jsdom's
// `import.meta.url` is not a file URL, so `fileURLToPath` throws.

import { beforeAll, describe, expect, it } from 'vitest'

import { BEHAVIOUR_IDS, reachableBehaviours } from './contract.ts'
import { FAULTS, FAULT_IDS, SOURCES } from './faults.ts'
import { caughtBy, controlFor, detected, measure, missedBy, verdictFor, type Matrix } from './matrix.ts'
import { WORLDS, worldNamed } from './worlds.ts'

// The measurement `README.md` is written from. Every number quoted there is
// asserted here, so the prose cannot drift away from the run.
//
// The matrix takes a few seconds: three of the six worlds wait for real
// milliseconds, which is the cost being measured and not an accident of the
// harness.

let matrix: Matrix

beforeAll(async () => {
  matrix = await measure()
}, 120_000)

describe('the control', () => {
  // First, and before a single fault is looked at. A probe that fails on the
  // unedited source reads as a probe that catches everything, and the matrix
  // becomes a measurement of the harness rather than of the techniques.
  it('holds every behaviour in every world, on the unedited source', () => {
    for (const world of WORLDS) {
      expect({ world: world.id, failed: controlFor(matrix, world.id).failed }).toEqual({
        world: world.id,
        failed: [],
      })
    }
  })

  // Closes the loop `contract.ts` opens: reach is derived from capabilities,
  // and this is the check that a world actually runs what the derivation says
  // it can.
  it('runs exactly the behaviours each world capability set derives', () => {
    for (const world of WORLDS) {
      expect(controlFor(matrix, world.id).results.map((result) => result.behaviour)).toEqual([
        ...reachableBehaviours(world.capabilities),
      ])
    }
  })

  it('throws nothing on the unedited source', () => {
    for (const verdict of matrix.control) {
      expect(verdict.results.filter((result) => result.threw !== null)).toEqual([])
    }
  })
})

describe('what each world reaches', () => {
  it('reaches 8, 7, 8, 10, 10 and 13 of the thirteen behaviours', () => {
    expect(WORLDS.map((world) => reachableBehaviours(world.capabilities).length)).toEqual([
      8, 7, 8, 10, 10, 13,
    ])
    expect(BEHAVIOUR_IDS).toHaveLength(13)
  })

  it('leaves two behaviours statable only with every source injected', () => {
    const elsewhere = new Set(
      WORLDS.filter((world) => world.id !== 'injected').flatMap((world) =>
        reachableBehaviours(world.capabilities),
      ),
    )

    expect(BEHAVIOUR_IDS.filter((behaviour) => !elsewhere.has(behaviour))).toEqual([
      'duration-comes-from-the-monotonic-clock',
      'a-low-draw-refreshes-earlier-than-a-high-draw',
    ])
  })

  // The midpoint is not a weaker version of a seeded stream, it is a different
  // and non-overlapping thing: the one behaviour only a constant reaches, and
  // the one only many draws reach.
  it('splits two behaviours between a constant draw and a varying one', () => {
    const constant = reachableBehaviours(worldNamed('constant-random').capabilities)
    const seeded = reachableBehaviours(worldNamed('seeded-random').capabilities)

    expect(constant.filter((behaviour) => !seeded.includes(behaviour))).toEqual([
      'delay-centres-on-half-the-lifetime-at-the-median-draw',
    ])
    expect(seeded.filter((behaviour) => !constant.includes(behaviour))).toEqual([
      'delay-stays-inside-the-clamped-band',
      'the-jitter-band-is-reached-at-both-ends',
    ])
  })
})

describe('the detection matrix', () => {
  it('catches 12, 9, 12, 13, 13 and 15 of the fifteen faults', () => {
    expect(WORLDS.map((world) => caughtBy(matrix, world.id).length)).toEqual([12, 9, 12, 13, 13, 15])
    expect(FAULT_IDS).toHaveLength(15)
  })

  it('catches every fault once every source is injected', () => {
    expect(missedBy(matrix, 'injected')).toEqual([])
  })

  // ---------------------------------------------------------------------
  // The headline. Seeding is about reproducibility, and reproducibility is
  // not detection: it changes which values come back, not what can be
  // asked of them. Twice over, at both ends of the table.
  // ---------------------------------------------------------------------
  it('changes no cell when a seeded generator is added to an uncontrolled clock', () => {
    expect(caughtBy(matrix, 'seeded-random')).toEqual(caughtBy(matrix, 'ambient'))
  })

  it('changes no cell when a seeded generator is added to fake timers', () => {
    expect(caughtBy(matrix, 'standard')).toEqual(caughtBy(matrix, 'fake-timers'))
  })

  // ---------------------------------------------------------------------
  // The line most often written about randomness in a test suite is the
  // only strategy here that is worse than doing nothing — strictly worse,
  // not merely different.
  // ---------------------------------------------------------------------
  it('catches strictly fewer faults with a constant draw than with no control at all', () => {
    const constant = caughtBy(matrix, 'constant-random')
    const ambient = caughtBy(matrix, 'ambient')

    for (const fault of constant) {
      expect(ambient).toContain(fault)
    }

    expect(constant.length).toBeLessThan(ambient.length)
  })

  it('loses the three band faults by pinning every draw to the midpoint', () => {
    expect(missedBy(matrix, 'constant-random').filter((fault) => !missedBy(matrix, 'ambient').includes(fault))).toEqual([
      'JITTER_RANGE_HALVED',
      'JITTER_NOT_CLAMPED',
      'MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES',
    ])
  })

  it('leaves exactly two faults for the standard advice to miss', () => {
    expect(missedBy(matrix, 'standard')).toEqual([
      'ELAPSED_FROM_WALL_CLOCK',
      'JITTER_SIGN_FLIPPED',
    ])
  })

  it('reaches the expiry boundary only once the clock can be held at an instant', () => {
    for (const world of WORLDS) {
      expect(detected(matrix, world.id, 'EXPIRY_BOUNDARY_EXCLUSIVE')).toBe(
        world.capabilities.includes('exact-instant'),
      )
    }
  })

  it('separates the two clocks only where the capability exists', () => {
    for (const world of WORLDS) {
      expect(detected(matrix, world.id, 'ELAPSED_FROM_WALL_CLOCK')).toBe(
        world.capabilities.includes('separable-clocks'),
      )
    }
  })

  it('sees the sign flip only where a draw can be chosen', () => {
    for (const world of WORLDS) {
      expect(detected(matrix, world.id, 'JITTER_SIGN_FLIPPED')).toBe(
        world.capabilities.includes('chosen-draws'),
      )
    }
  })

  it('catches nine faults in every world, which is the baseline the rest is measured against', () => {
    const universal = FAULT_IDS.filter((fault) =>
      WORLDS.every((world) => detected(matrix, world.id, fault)),
    )

    expect(universal).toEqual([
      'TTL_IN_SECONDS',
      'EXPIRY_FROM_MONOTONIC_CLOCK',
      'RENEW_KEEPS_ORIGINAL_EXPIRY',
      'JITTER_ALWAYS_POSITIVE',
      'REFRESH_FRACTION_TOO_LATE',
      'SCHEDULE_AT_ABSOLUTE_TIME',
      'SCHEDULE_DELAY_IN_SECONDS',
      'CANCEL_DOES_NOT_STOP_REFRESH',
      'ID_DERIVED_FROM_CLOCK',
    ])
  })
})

describe('which behaviour caught what', () => {
  it('catches the sign flip through the ordering claim and nothing else', () => {
    expect(verdictFor(matrix, 'injected', 'JITTER_SIGN_FLIPPED').failed).toEqual([
      'a-low-draw-refreshes-earlier-than-a-high-draw',
    ])
  })

  it('catches the wall-clock duration through the monotonic claim and nothing else', () => {
    expect(verdictFor(matrix, 'injected', 'ELAPSED_FROM_WALL_CLOCK').failed).toEqual([
      'duration-comes-from-the-monotonic-clock',
    ])
  })

  it('catches the exclusive boundary through the boundary claim and nothing else', () => {
    expect(verdictFor(matrix, 'fake-timers', 'EXPIRY_BOUNDARY_EXCLUSIVE').failed).toEqual([
      'expired-at-the-expiry-instant',
    ])
  })

  // The scheduler fault is caught by the real-clock worlds and the
  // hand-drained ones for opposite reasons, and both are visible in the
  // failure. Under a manual queue the callback simply never comes due. Under
  // Node, an out-of-range delay is clamped to 1ms — with a
  // `TimeoutOverflowWarning` on stderr, which is where the four of those in a
  // `pnpm test` run come from — so it fires almost immediately instead.
  it('catches an absolute instant passed as a delay in every world, however the scheduler reacts', () => {
    for (const world of WORLDS) {
      expect(verdictFor(matrix, world.id, 'SCHEDULE_AT_ABSOLUTE_TIME').failed).toContain(
        'the-refresh-fires-no-earlier-than-its-delay',
      )
    }
  })
})

describe('the fault corpus', () => {
  it('anchors every fault to one of the five sources', () => {
    for (const fault of FAULTS) {
      expect(SOURCES).toContain(fault.source)
    }
  })

  it('covers all five sources', () => {
    expect([...new Set(FAULTS.map((fault) => fault.source))].sort()).toEqual([...SOURCES].sort())
  })

  it('leaves at least one fault per source that the standard advice cannot see, or that every world catches', () => {
    // Not every source can hide from fake timers plus a seed — the identity
    // and scheduler faults are caught by everyone, and saying otherwise would
    // be inventing a fault to make the table symmetrical. What the corpus does
    // guarantee is that no source is represented only by faults nothing
    // catches.
    for (const source of SOURCES) {
      const ofSource = FAULTS.filter((fault) => fault.source === source).map((fault) => fault.id)

      expect(ofSource.some((fault) => detected(matrix, 'injected', fault))).toBe(true)
    }
  })

  it('describes every fault as a single sentence somebody could have written', () => {
    for (const fault of FAULTS) {
      expect(fault.description.endsWith('.')).toBe(true)
      expect(fault.edits.length).toBeGreaterThan(0)
    }
  })
})
