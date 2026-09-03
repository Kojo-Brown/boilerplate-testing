import { describe, expect, it } from 'vitest'

import {
  BEHAVIOURS,
  BEHAVIOUR_IDS,
  CAPABILITIES,
  CAPABILITY_NOTES,
  behaviourNamed,
  reachableBehaviours,
  type Capability,
} from './contract.ts'
import { PROBE_IDS, WORLDS, worldNamed } from './worlds.ts'

describe('the behaviour contract', () => {
  it('holds one specification per declared identifier, in the declared order', () => {
    expect(BEHAVIOURS.map((behaviour) => behaviour.id)).toEqual([...BEHAVIOUR_IDS])
  })

  it('states every claim as a sentence about the system', () => {
    for (const behaviour of BEHAVIOURS) {
      expect(behaviour.claim.endsWith('.')).toBe(true)
      expect(behaviour.claim.length).toBeGreaterThan(30)
    }
  })

  it('requires only capabilities that exist', () => {
    for (const behaviour of BEHAVIOURS) {
      for (const capability of behaviour.requires) {
        expect(CAPABILITIES).toContain(capability)
      }
    }
  })

  it('explains every capability it defines', () => {
    expect(Object.keys(CAPABILITY_NOTES).sort()).toEqual([...CAPABILITIES].sort())
  })

  // A capability nothing needs is a distinction the measurement never tests,
  // and it would sit in the table looking like a finding.
  it('puts every capability to use in at least one behaviour', () => {
    const required = new Set(BEHAVIOURS.flatMap((behaviour) => behaviour.requires))

    expect([...required].sort()).toEqual([...CAPABILITIES].sort())
  })

  it('names the behaviour asked for, and refuses one that does not exist', () => {
    expect(behaviourNamed('live-when-issued').requires).toEqual([])
    expect(() => behaviourNamed('nonsense' as never)).toThrow(/no behaviour named/)
  })
})

describe('deriving reach from capabilities', () => {
  it('reaches only the unconditional behaviours with no capabilities at all', () => {
    expect(reachableBehaviours([])).toEqual(
      BEHAVIOURS.filter((behaviour) => behaviour.requires.length === 0).map((b) => b.id),
    )
  })

  it('reaches everything with every capability', () => {
    expect(reachableBehaviours(CAPABILITIES)).toEqual([...BEHAVIOUR_IDS])
  })

  it('keeps a behaviour out of reach until every capability it needs is present', () => {
    const needsTwo: readonly Capability[] = ['chosen-draws']

    expect(reachableBehaviours(needsTwo)).toContain('a-low-draw-refreshes-earlier-than-a-high-draw')
    expect(reachableBehaviours([])).not.toContain(
      'a-low-draw-refreshes-earlier-than-a-high-draw',
    )
  })

  it('grows monotonically as capabilities are added', () => {
    const fewer = reachableBehaviours(['many-draws'])
    const more = reachableBehaviours(['many-draws', 'exact-instant'])

    for (const behaviour of fewer) {
      expect(more).toContain(behaviour)
    }

    expect(more.length).toBeGreaterThan(fewer.length)
  })
})

describe('the six worlds', () => {
  it('declares one world per identifier, in the declared order', () => {
    expect(WORLDS.map((world) => world.id)).toEqual([...PROBE_IDS])
  })

  it('names the world asked for, and refuses one that does not exist', () => {
    expect(worldNamed('injected').capabilities).toContain('separable-clocks')
    expect(() => worldNamed('nonsense' as never)).toThrow(/no world named/)
  })

  it('claims only capabilities that exist', () => {
    for (const world of WORLDS) {
      for (const capability of world.capabilities) {
        expect(CAPABILITIES).toContain(capability)
      }
    }
  })

  // The one world that can do everything, and the reason the comparison has a
  // ceiling to measure against.
  it('gives only the injected world every capability', () => {
    const complete = WORLDS.filter((world) => world.capabilities.length === CAPABILITIES.length)

    expect(complete.map((world) => world.id)).toEqual(['injected'])
  })

  // The claim `README.md` leads with, in its structural form: seeding changes
  // which values come back, not which questions can be asked.
  it('leaves reach unchanged when a seed is added to a world', () => {
    expect(reachableBehaviours(worldNamed('seeded-random').capabilities)).toEqual(
      reachableBehaviours(worldNamed('ambient').capabilities),
    )
    expect(reachableBehaviours(worldNamed('standard').capabilities)).toEqual(
      reachableBehaviours(worldNamed('fake-timers').capabilities),
    )
  })

  it('offers a skew only where the capability is claimed', () => {
    for (const world of WORLDS) {
      const claimed = world.capabilities.includes('separable-clocks')

      expect(world.create().skew === null).toBe(!claimed)
    }
  })

  it('offers an exact instant only where the capability is claimed', () => {
    for (const world of WORLDS) {
      const claimed = world.capabilities.includes('exact-instant')

      expect(world.create().setInstant === null).toBe(!claimed)
    }
  })

  it('honours requested draws only where the capability is claimed', () => {
    for (const world of WORLDS) {
      const instance = world.create([0.123_456])
      const honoured = instance.env.random() === 0.123_456

      expect(honoured).toBe(world.capabilities.includes('chosen-draws'))
    }
  })

  it('draws exactly the midpoint wherever the median capability is claimed', () => {
    for (const world of WORLDS.filter((w) => w.capabilities.includes('median-draw'))) {
      const instance = world.create([0.5])

      expect(instance.env.random()).toBe(0.5)
    }
  })

  it('waits for real time in exactly the worlds that borrow the runtime clock', () => {
    for (const world of WORLDS) {
      expect(world.create().grace > 0).toBe(world.realTime)
    }
  })
})
