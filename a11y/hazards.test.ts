// @vitest-environment node
//
// Reads `page.ts` off disk to check the catalogue against the fixture, and
// resolves it relative to `import.meta.url`, which the project-default jsdom
// environment rewrites to an http: URL that `fileURLToPath` rejects.

/**
 * The catalogue against the fixture it describes.
 *
 * `journey.spec.ts` checks the expensive half — what axe does with each defect
 * — against a real browser. This file checks the half that needs no browser
 * and would otherwise be nobody's job: that every hazard is actually planted,
 * that the table is internally consistent, and that the counts the README
 * quotes are the counts the data supports.
 *
 * The on-disk check is the one that earns its place. A hazard is a claim that
 * `page.ts` contains a specific defect, and the cheapest way for this directory
 * to become a lie is for somebody to fix the fixture — which looks like an
 * improvement — without touching the table.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  HAZARDS,
  hazardsAt,
  hazardsInJourneyOrder,
  hazardsWith,
  rulesNamed,
  VERDICTS,
} from './hazards.ts'
import { PAGE_HTML, RELEASE_ORDERS } from './page.ts'
import { JOURNEY_STATES, requiresInteraction } from './states.ts'

const page = readFileSync(fileURLToPath(new URL('./page.ts', import.meta.url)), 'utf8')

describe('the catalogue', () => {
  it('gives every hazard a distinct id', () => {
    expect(new Set(HAZARDS.map((hazard) => hazard.id)).size).toBe(HAZARDS.length)
  })

  it('places every hazard in a state the journey actually visits', () => {
    for (const hazard of HAZARDS) {
      expect(JOURNEY_STATES, `${hazard.id} sits in no known state`).toContain(hazard.state)
    }
  })

  it('names a rule for every verdict that implies one, and none for the verdict that does not', () => {
    for (const hazard of HAZARDS) {
      if (hazard.verdict === 'none') {
        expect(hazard.rule, `${hazard.id} claims no rule and names one`).toBeNull()
      } else {
        expect(hazard.rule, `${hazard.id} claims a verdict and names no rule`).not.toBeNull()
      }
    }
  })

  it('uses only the four verdicts axe-core was observed to produce', () => {
    for (const hazard of HAZARDS) {
      expect(VERDICTS).toContain(hazard.verdict)
    }
  })

  it('explains every verdict with a mechanism rather than a restatement', () => {
    for (const hazard of HAZARDS) {
      expect(hazard.because.length, `${hazard.id} has no explanation`).toBeGreaterThan(40)
      expect(hazard.wcag, `${hazard.id} cites no success criterion`).toMatch(/^\d\.\d\.\d /)
    }
  })
})

describe('the fixture the catalogue describes', () => {
  it('carries a marker comment for every hazard', () => {
    // Both directions. A hazard with no marker is a defect nobody planted; a
    // marker naming no hazard is a defect nobody wrote down.
    const marked = [...page.matchAll(/HAZARD ([a-z-]+)/g)].map((match) => match[1] ?? '')

    expect([...new Set(marked)].sort()).toEqual(HAZARDS.map((hazard) => hazard.id).sort())
  })

  it('gates its one piece of asynchrony on a call rather than a clock', () => {
    // The property `playwright-a11y.config.ts` sets `retries: 0` on. A timer
    // here would make the scan-at-load cell a race against axe's own injection
    // time, which is how this fixture started and why it does not any more.
    //
    // Asserted against the emitted document rather than the module text: the
    // comment above RELEASE_ORDERS discusses the timer it replaced, and a
    // check that forbade the word would forbid explaining the decision.
    expect(PAGE_HTML).not.toContain('setTimeout')
    expect(PAGE_HTML).toContain(`window.${RELEASE_ORDERS} = function`)
    expect(page).toContain('export const RELEASE_ORDERS')
  })
})

describe('what the catalogue adds up to', () => {
  it('splits evenly between what axe can report and what it cannot', () => {
    // The README's headline. Six of the twelve defects are invisible to axe
    // however it is configured, which is the sentence the whole directory is
    // arranged to make checkable.
    expect(hazardsWith('none')).toHaveLength(6)
    expect(HAZARDS.filter((hazard) => hazard.rule !== null)).toHaveLength(6)
    expect(HAZARDS).toHaveLength(12)
  })

  it('files only one hazard under a rule that does not run', () => {
    expect(hazardsWith('disabled').map((hazard) => hazard.rule)).toEqual(['target-size'])
  })

  it('files two hazards in the bucket the canonical assertion discards', () => {
    expect(hazardsWith('incomplete').map((hazard) => hazard.id)).toEqual([
      'background-hidden-focusable',
      'name-describedby-dangling',
    ])
  })

  it('puts all but one hazard behind an interaction', () => {
    // `landing-load` is the only state a navigation produces, and it holds two
    // of the twelve — one of which needs a rule that is switched off. That
    // arithmetic is where `per-page-on-load` scoring 1 comes from.
    const atLoad = hazardsAt('landing-load')

    expect(atLoad).toHaveLength(2)
    expect(HAZARDS.filter((hazard) => requiresInteraction(hazard.state))).toHaveLength(10)
  })

  it('makes a claim about six distinct axe rules', () => {
    expect(rulesNamed()).toEqual([
      'aria-dialog-name',
      'aria-hidden-focus',
      'aria-valid-attr-value',
      'color-contrast',
      'image-alt',
      'target-size',
    ])
  })

  it('orders the journey view by the order the journey meets each state', () => {
    const order = hazardsInJourneyOrder().map((hazard) => JOURNEY_STATES.indexOf(hazard.state))

    expect(order).toEqual([...order].sort((left, right) => left - right))
  })
})
