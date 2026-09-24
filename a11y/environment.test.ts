/**
 * The jsdom column of `environments.ts`, re-derived on every `pnpm test`.
 *
 * This is the half of the comparison that needs no browser, which is the point:
 * whatever a machine with no Chromium can tell you about this repository's
 * accessibility coverage, it can tell you here, and what it cannot tell you is
 * exactly the two rows that move.
 */

import axe from 'axe-core'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  ENVIRONMENT_FIXTURE,
  ENVIRONMENT_ROWS,
  journeyRules,
  movesWithEnvironment,
  PLACEMENTS,
  type Placement,
} from './environments.ts'
import { DISABLED_BY_DEFAULT, enableAll } from './scan.ts'

/** Where axe put a rule's result, or `absent` if the rule did not run. */
function placementOf(results: axe.AxeResults, rule: string): Placement {
  if (results.violations.some((result) => result.id === rule)) return 'violation'
  if (results.incomplete.some((result) => result.id === rule)) return 'incomplete'
  if (results.passes.some((result) => result.id === rule)) return 'passes'

  return 'absent'
}

/**
 * Scanned once and shared.
 *
 * Not an optimisation: axe's `color-contrast` rule reaches for a canvas to
 * decide whether text is an icon ligature, jsdom does not implement
 * `getContext`, and every scan therefore prints a stack trace to stderr. That
 * is the mechanism behind this table's most interesting row, so it is worth
 * seeing — once, rather than once per assertion.
 */
let results: axe.AxeResults

beforeAll(async () => {
  document.body.innerHTML = ENVIRONMENT_FIXTURE

  // Disabled rules on, so that `target-size` is comparable rather than absent
  // in both columns for an uninteresting reason.
  results = await axe.run(document.body, { rules: enableAll() })
})

describe('axe-core under jsdom, on the markup the browser half also scans', () => {
  it.each(ENVIRONMENT_ROWS.map((row) => [row.rule, row.jsdom] as const))(
    'puts %s in %s',
    (rule, expected) => {
      expect(placementOf(results, rule)).toBe(expected)
    },
  )

  it('passes two twenty-pixel buttons that a browser calls a violation', () => {
    // Stated on its own because it is the expensive one. `incomplete` tells a
    // reader the check could not be made; `passes` tells them it was made and
    // found nothing, and here that is untrue.
    expect(placementOf(results, 'target-size')).toBe('passes')

    const boxes = ['refresh', 'export'].map((id) =>
      document.getElementById(id)?.getBoundingClientRect(),
    )

    // The reason, rather than the symptom: jsdom lays nothing out, so the
    // geometry the rule reasons about is zero in every direction.
    for (const box of boxes) {
      expect(box?.width).toBe(0)
      expect(box?.height).toBe(0)
    }
  })

  it('degrades honestly on contrast, which is the same failure made visible', () => {
    expect(placementOf(results, 'color-contrast')).toBe('incomplete')
  })
})

describe('the two tables in this directory', () => {
  it('names the same axe rules in the catalogue and the environment comparison', () => {
    expect([...ENVIRONMENT_ROWS.map((row) => row.rule)].sort()).toEqual([...journeyRules()])
  })

  it('moves exactly the two rules that need a rendering engine', () => {
    expect(movesWithEnvironment().map((row) => row.rule)).toEqual(['color-contrast', 'target-size'])
  })

  it('records a placement that axe can actually produce', () => {
    for (const row of ENVIRONMENT_ROWS) {
      expect(PLACEMENTS).toContain(row.jsdom)
      expect(PLACEMENTS).toContain(row.browser)
    }
  })
})

describe('the list of rules axe-core ships switched off', () => {
  it('matches what the installed axe-core actually disables', () => {
    // `axe._audit` is private and this is the only place the repository reads
    // it: the point is to audit the hardcoded list in `scan.ts` rather than to
    // depend on the field at scan time. When a future axe-core enables
    // `target-size`, this fails here instead of quietly over-reporting in CI.
    const audit = (axe as unknown as { _audit: { rules: { id: string; enabled?: boolean }[] } })
      ._audit

    const disabled = audit.rules
      .filter((rule) => rule.enabled === false)
      .map((rule) => rule.id)
      .sort()

    expect(disabled).toEqual([...DISABLED_BY_DEFAULT].sort())
  })

  it('includes the WCAG 2.2 target-size rule, which is the one that costs', () => {
    expect(DISABLED_BY_DEFAULT).toContain('target-size')
    expect(Object.keys(enableAll())).toEqual([...DISABLED_BY_DEFAULT])
  })
})
