// @vitest-environment node
/**
 * The corpus, checked for the ways a timeline can be quietly meaningless.
 *
 * A hazard that finishes a run it never started, or expects a live environment
 * and never probes one, does not fail. It produces a cell, and the cell is
 * wrong in a way no amount of staring at the matrix reveals: a `finish` whose
 * label has a typo in it is indistinguishable from a run that was cancelled,
 * so the whole column would read as a concurrency finding. Runs are named by
 * hand, so that typo is one keystroke away, and these checks are what stands
 * between it and a plausible wrong table.
 */

import { describe, expect, it } from 'vitest'

import { HAZARDS, hazardByKey, hazardKeys, schemaOf, type Step } from './hazards.ts'
import { OUTCOMES } from './scoring.ts'
import { BASE_SCHEMA } from './seeds.ts'

const runsStarted = (steps: readonly Step[]): readonly string[] =>
  steps.flatMap((step) =>
    step.kind === 'open' || step.kind === 'push' || step.kind === 'label' || step.kind === 'close'
      ? [step.run]
      : [],
  )

const runsResolved = (steps: readonly Step[]): readonly string[] =>
  steps.flatMap((step) => (step.kind === 'finish' || step.kind === 'cancel' ? [step.run] : []))

const prsOpened = (steps: readonly Step[]): readonly number[] =>
  steps.flatMap((step) => (step.kind === 'open' ? [step.pr] : []))

describe('the corpus', () => {
  it('gives every hazard a distinct key', () => {
    expect(new Set(hazardKeys()).size).toBe(HAZARDS.length)
  })

  it('states a correct answer drawn from the outcome vocabulary', () => {
    for (const hazard of HAZARDS) expect(OUTCOMES).toContain(hazard.correct)
  })

  it('states a correct answer that is consistent with what it expects to be left', () => {
    for (const hazard of HAZARDS) {
      const permitted = hazard.expect === 'live' ? ['live'] : ['clean', 'reaped']

      expect(permitted, `${hazard.key} expects ${hazard.expect}`).toContain(hazard.correct)
    }
  })

  it('gives every hazard a blurb that is a sentence', () => {
    for (const hazard of HAZARDS) {
      expect(hazard.blurb.length).toBeGreaterThan(20)
      expect(hazard.blurb.endsWith('.')).toBe(true)
    }
  })

  it('refuses a key it does not have', () => {
    expect(() => hazardByKey('invented')).toThrow('no hazard called invented')
  })
})

describe('every timeline', () => {
  it('opens the pull request it is judged on', () => {
    for (const hazard of HAZARDS) {
      expect(prsOpened(hazard.steps), hazard.key).toContain(hazard.subject)
    }
  })

  it('only finishes or cancels runs some earlier step started', () => {
    for (const hazard of HAZARDS) {
      const started = new Set(runsStarted(hazard.steps))

      for (const label of runsResolved(hazard.steps)) {
        expect(started, `${hazard.key} resolves ${label}`).toContain(label)
      }
    }
  })

  it('gives each run at most one fate', () => {
    for (const hazard of HAZARDS) {
      const resolved = runsResolved(hazard.steps)

      expect(new Set(resolved).size, hazard.key).toBe(resolved.length)
    }
  })

  it('names each run it starts exactly once', () => {
    for (const hazard of HAZARDS) {
      const started = runsStarted(hazard.steps)

      expect(new Set(started).size, hazard.key).toBe(started.length)
    }
  })

  it('touches a pull request only after opening it', () => {
    for (const hazard of HAZARDS) {
      const opened = new Set<number>()

      for (const step of hazard.steps) {
        if (step.kind === 'open') {
          opened.add(step.pr)
          continue
        }

        if (!('pr' in step)) continue

        expect(opened, `${hazard.key} touches ${String(step.pr)}`).toContain(step.pr)
      }
    }
  })
})

describe('a hazard that expects a live environment', () => {
  it('probes the pull request it is judged on, because there is nothing to read otherwise', () => {
    for (const hazard of HAZARDS) {
      if (hazard.expect !== 'live') continue

      const probed = hazard.steps.flatMap((step) => (step.kind === 'probe' ? [step.pr] : []))

      expect(probed, hazard.key).toContain(hazard.subject)
    }
  })

  it('probes last, so the reading is of the state the timeline ends in', () => {
    for (const hazard of HAZARDS) {
      if (hazard.expect !== 'live') continue

      expect(hazard.steps.at(-1)?.kind, hazard.key).toBe('probe')
    }
  })
})

describe('a hazard that expects a clean account', () => {
  it('closes the pull request it is judged on', () => {
    for (const hazard of HAZARDS) {
      if (hazard.expect !== 'clean') continue
      // The fork rows are the exception with a reason: nothing should ever have
      // been created, so there is nothing for a close to tear down and the
      // pull request is still open at the end.
      if (hazard.key.startsWith('fork-')) continue

      const closed = hazard.steps.flatMap((step) => (step.kind === 'close' ? [step.pr] : []))

      expect(closed, hazard.key).toContain(hazard.subject)
    }
  })
})

describe('commit metadata', () => {
  it('reads the base schema for a commit that does not carry a migration', () => {
    expect(schemaOf({})).toBe(BASE_SCHEMA)
  })

  it('reads the declared schema for a commit that does', () => {
    expect(schemaOf({ schema: 'v2' })).toBe('v2')
  })

  it('puts a migration in exactly one hazard, so its row is attributable', () => {
    const migrating = HAZARDS.filter((hazard) =>
      hazard.steps.some((step) => (step.kind === 'open' || step.kind === 'push') && step.schema !== undefined),
    )

    expect(migrating.map((hazard) => hazard.key)).toEqual(['migration-in-pr'])
  })
})
