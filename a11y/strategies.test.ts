/**
 * The reachability model, without a browser.
 *
 * `journey.spec.ts` runs each strategy against Chromium and checks that what it
 * finds is what `caughtBy` predicted. That is the expensive half and it only
 * runs where there is an engine. This file checks the model's own shape — that
 * the ladder is a ladder, that each rung undoes exactly one mechanism, and
 * that the scores the README prints follow from the catalogue — so the
 * interesting arithmetic stays covered on a machine with no browser at all.
 */

import { describe, expect, it } from 'vitest'

import { HAZARDS } from './hazards.ts'
import { JOURNEY_STATES } from './states.ts'
import {
  catches,
  caughtBy,
  missedBy,
  scoreOf,
  strategy,
  STRATEGIES,
  STRATEGY_NAMES,
  renderHazardTable,
  renderMatrix,
  renderScoreTable,
} from './strategies.ts'

describe('the ladder of strategies', () => {
  it('scores the canonical implementation at one of twelve', () => {
    // The headline. "axe per page" — navigate, analyze, assert violations is
    // empty — finds the contrast failure in the header and nothing else.
    expect(scoreOf(strategy('per-page-on-load'))).toBe(1)
    expect(caughtBy(strategy('per-page-on-load')).map((hazard) => hazard.id)).toEqual([
      'muted-contrast',
    ])
  })

  it('climbs 1, 2, 3, 6, 12 as each mechanism is undone', () => {
    expect(STRATEGIES.map(scoreOf)).toEqual([1, 2, 3, 6, 12])
  })

  it('finds everything only once assertions about the journey are added', () => {
    const top = strategy('per-state-and-journey')

    expect(scoreOf(top)).toBe(HAZARDS.length)
    expect(missedBy(top)).toEqual([])
  })

  it('leaves half the catalogue unreachable to the best axe-only wiring', () => {
    // The ceiling that matters: with every rule enabled, `incomplete` treated
    // as failure and a scan in all six states, axe still cannot see six of the
    // twelve defects. No configuration closes that gap.
    const best = strategy('per-state-full-axe')

    expect(scoreOf(best)).toBe(6)
    expect(missedBy(best).every((hazard) => hazard.rule === null)).toBe(true)
  })

  it('makes each strategy a superset of the one above it', () => {
    // What licenses reading the score column as a cost rather than a menu.
    for (let at = 1; at < STRATEGIES.length; at += 1) {
      const lower = new Set(caughtBy(STRATEGIES[at - 1] ?? STRATEGIES[0]!).map((h) => h.id))
      const higher = new Set(caughtBy(STRATEGIES[at]!).map((h) => h.id))

      for (const id of lower) {
        expect(higher, `${STRATEGIES[at]?.name} lost ${id}`).toContain(id)
      }
    }
  })
})

describe('what makes a strategy find a hazard', () => {
  it('requires the strategy to be looking at the state the defect lives in', () => {
    const perPage = strategy('per-page-on-load')
    const dialog = HAZARDS.find((hazard) => hazard.id === 'dialog-unnamed')

    // An unambiguous violation, missed purely because the scan never happens
    // in the state where the dialog exists.
    expect(dialog?.verdict).toBe('violation')
    expect(catches(perPage, dialog!)).toBe(false)
  })

  it('requires the strategy to act on what axe said as well as to be present', () => {
    const perState = strategy('per-state')
    const deferred = HAZARDS.find((hazard) => hazard.id === 'name-describedby-dangling')

    // Scanned in the right state and still missed: the result is in
    // `incomplete`, and this strategy reads only `violations`.
    expect(perState.observes).toContain(deferred?.state)
    expect(catches(perState, deferred!)).toBe(false)
    expect(catches(strategy('per-state-full-axe'), deferred!)).toBe(true)
  })

  it('names every strategy in the published order', () => {
    expect(STRATEGIES.map((subject) => subject.name)).toEqual([...STRATEGY_NAMES])
  })

  it('rejects a name it does not define', () => {
    // @ts-expect-error — the point is the runtime guard behind the union type.
    expect(() => strategy('per-page-sometimes')).toThrow(/no strategy named/)
  })

  it('observes states drawn from the declared journey', () => {
    for (const subject of STRATEGIES) {
      for (const state of subject.observes) {
        expect(JOURNEY_STATES).toContain(state)
      }
    }
  })
})

describe('the rendered tables', () => {
  it('prints a row per hazard, a row per strategy, and a grid of the two', () => {
    const hazardRows = renderHazardTable().split('\n')
    const scoreRows = renderScoreTable().split('\n')
    const matrixRows = renderMatrix().split('\n')

    // Header plus separator plus body, in all three.
    expect(hazardRows).toHaveLength(HAZARDS.length + 2)
    expect(scoreRows).toHaveLength(STRATEGIES.length + 2)
    expect(matrixRows).toHaveLength(HAZARDS.length + 2)
  })

  it('marks a cell found exactly when the model catches it', () => {
    const rows = renderMatrix().split('\n').slice(2)

    for (const [at, hazard] of HAZARDS.entries()) {
      const cells = (rows[at] ?? '').split('|').slice(2, -1).map((cell) => cell.trim())

      expect(cells).toEqual(
        STRATEGIES.map((subject) => (catches(subject, hazard) ? 'found' : '·')),
      )
    }
  })

  it('renders three distinct tables rather than one of them twice', () => {
    const rendered = [renderHazardTable(), renderScoreTable(), renderMatrix()]

    expect(new Set(rendered).size).toBe(rendered.length)
  })
})
