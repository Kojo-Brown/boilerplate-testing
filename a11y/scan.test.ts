/**
 * The scan helpers, which are where the per-state strategies become usable.
 *
 * `findingsFrom` is the interesting one: the default is to read `incomplete`
 * as well as `violations`, which is the opposite of every example on the
 * internet, and two of the twelve defects in `page.ts` are only visible that
 * way. The rest is fingerprinting and formatting — the part that decides
 * whether a six-state report is something anybody reads.
 */

import type { AxeResults, Result } from 'axe-core'
import { describe, expect, it } from 'vitest'

import {
  dedupe,
  enableAll,
  findingsFrom,
  fingerprint,
  format,
  rulesIn,
  DISABLED_BY_DEFAULT,
  type Finding,
} from './scan.ts'

/** A minimal axe `Result`, with one node per target. */
function result(id: string, targets: readonly string[], impact = 'serious'): Result {
  return {
    id,
    impact: impact as Result['impact'],
    tags: [],
    description: `${id} description`,
    help: `${id} help`,
    helpUrl: `https://example.test/${id}`,
    nodes: targets.map((target) => ({
      target: [target],
      html: `<p>${target}</p>`,
      failureSummary: `Fix ${target}`,
      any: [],
      all: [],
      none: [],
      impact: impact as Result['impact'],
    })),
  } as Result
}

function results(violations: Result[], incomplete: Result[] = []): AxeResults {
  return { violations, incomplete, passes: [], inapplicable: [] } as unknown as AxeResults
}

describe('reading an axe result', () => {
  it('counts the incomplete bucket by default', () => {
    const findings = findingsFrom(
      results([result('image-alt', ['img'])], [result('aria-valid-attr-value', ['#name'])]),
      'validation-error',
    )

    expect(rulesIn(findings)).toEqual(['aria-valid-attr-value', 'image-alt'])
  })

  it('discards the incomplete bucket when asked, which is what the canonical assertion does', () => {
    const findings = findingsFrom(
      results([result('image-alt', ['img'])], [result('aria-valid-attr-value', ['#name'])]),
      'validation-error',
      { includeIncomplete: false },
    )

    expect(rulesIn(findings)).toEqual(['image-alt'])
  })

  it('labels each finding with the bucket it came out of', () => {
    const findings = findingsFrom(
      results([result('image-alt', ['img'])], [result('aria-hidden-focus', ['main'])]),
      'dialog-open',
    )

    expect(findings.map((finding) => finding.bucket)).toEqual(['violation', 'incomplete'])
  })

  it('carries the journey state into every finding, since a scanner cannot infer it', () => {
    const findings = findingsFrom(results([result('image-alt', ['img', 'img:nth-child(2)'])]), 'toast')

    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.state === 'toast')).toBe(true)
  })

  it('flattens a rule with many nodes into one finding per node', () => {
    const findings = findingsFrom(results([result('image-alt', ['a', 'b', 'c'])]), 'landing-settled')

    expect(findings.map((finding) => finding.target)).toEqual(['a', 'b', 'c'])
  })
})

describe('recognising one defect seen many times', () => {
  const seen = (state: string): Finding =>
    findingsFrom(results([result('color-contrast', ['#count'])]), state)[0]!

  it('fingerprints on the rule and the node, deliberately not the state', () => {
    expect(fingerprint(seen('landing-load'))).toBe(fingerprint(seen('toast')))
    expect(fingerprint(seen('landing-load'))).toBe('color-contrast@#count')
  })

  it('collapses a header defect found in six states into one entry', () => {
    const states = ['landing-load', 'landing-settled', 'dialog-open', 'validation-error', 'toast']
    const collapsed = dedupe(states.map(seen))

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.states).toEqual(states)
  })

  it('keeps distinct nodes of the same rule apart', () => {
    const findings = findingsFrom(results([result('image-alt', ['img.a', 'img.b'])]), 'landing-settled')

    expect(dedupe(findings)).toHaveLength(2)
  })

  it('reports a state once however often the same defect is seen there', () => {
    const twice = [seen('toast'), seen('toast')]

    expect(dedupe(twice)[0]?.states).toEqual(['toast'])
  })
})

describe('the failure message', () => {
  it('names the states a defect was found in, which is the part that is hard to guess', () => {
    const findings = ['dialog-open', 'toast'].map(
      (state) => findingsFrom(results([result('color-contrast', ['#count'])]), state)[0]!,
    )

    const text = format(findings)

    expect(text).toContain('color-contrast (violation) in dialog-open, toast')
    expect(text).toContain('target: #count')
    expect(text).toContain('Fix #count')
  })

  it('says so plainly when there is nothing to report', () => {
    expect(format([])).toBe('no accessibility findings')
  })

  it('prints one block per distinct defect rather than one per sighting', () => {
    const findings = ['landing-load', 'toast'].map(
      (state) => findingsFrom(results([result('color-contrast', ['#count'])]), state)[0]!,
    )

    expect(format(findings).split('\n\n')).toHaveLength(1)
  })
})

describe('the rules axe-core ships switched off', () => {
  it('turns every one of them on', () => {
    const options = enableAll()

    expect(Object.keys(options)).toEqual([...DISABLED_BY_DEFAULT])
    expect(Object.values(options).every((rule) => rule.enabled)).toBe(true)
  })

  it('turns on only what it is given when it is given a list', () => {
    expect(enableAll(['target-size'])).toEqual({ 'target-size': { enabled: true } })
  })

  it('lists them in sorted order so a diff against axe-core is readable', () => {
    expect([...DISABLED_BY_DEFAULT]).toEqual([...DISABLED_BY_DEFAULT].sort())
  })
})
