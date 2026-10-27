// @vitest-environment node
//
// README.md's tables are not checked against the model — they are *rendered
// from* it and compared as text, the discipline the rest of this repository
// established. There is no version of this file that agrees with a published
// table holding a wrong cell.
//
// The findings are held to the same standard in both directions: each is a
// predicate over the measured tables plus a heading the README must carry, so a
// finding that stops being true fails here, and a heading with no finding
// behind it fails here too. `findings.test.ts` adds the third direction, which
// is the one that keeps a predicate from being decoration: every finding is
// handed a table with one cell moved and has to notice.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { FAULTS, FAULT_IDS } from './faults.ts'
import { LAYER_IDS } from './layers.ts'
import { TABLES, TOTAL_CELLS } from './matrix.ts'
import { POLICY_IDS } from './policies.ts'
import {
  FINDINGS,
  MEASURED_AGAINST,
  QUOTED,
  disagreements,
  renderDisagreements,
  renderFaults,
  renderLayers,
  renderPolicies,
  renderTable,
} from './render.ts'
import { BUDGET_MS, INJECTED_MS } from './timings.ts'

const here = dirname(fileURLToPath(import.meta.url))
const README = readFileSync(join(here, 'README.md'), 'utf8')

/**
 * The same text with its line wrapping flattened.
 *
 * Prose assertions read this: a sentence that says the right thing should not
 * fail because the paragraph was re-wrapped, and a sentence that says the
 * wrong thing should not pass because it was.
 */
const PROSE = README.replace(/\s+/g, ' ')

describe('the published tables', () => {
  it('carries the fault catalogue as rendered from the catalogue', () => {
    expect(README).toContain(renderFaults())
  })

  it('carries the wiring catalogue as rendered from the wirings', () => {
    expect(README).toContain(renderPolicies())
  })

  it('carries the layer catalogue as rendered from the layers', () => {
    expect(README).toContain(renderLayers())
  })

  it.each([...LAYER_IDS])('carries the %s table as rendered from the measured cells', (layer) => {
    expect(README).toContain(renderTable(layer))
  })

  it('carries the disagreement table as rendered from the two tables', () => {
    expect(README).toContain(renderDisagreements())
  })

  it('states the number of cells the suite re-derives', () => {
    expect(TOTAL_CELLS).toBe(POLICY_IDS.length * FAULT_IDS.length * LAYER_IDS.length)
    expect(PROSE).toContain(`**${String(TOTAL_CELLS)} cells**`)
  })

  it('names the runtime every cell was measured against', () => {
    expect(PROSE).toContain(MEASURED_AGAINST)
  })
})

describe('the findings', () => {
  it.each(FINDINGS.map((finding) => finding.heading))('"%s" is still true of the measurement', (heading) => {
    const finding = FINDINGS.find((candidate) => candidate.heading === heading)

    expect(finding?.holds(TABLES)).toBe(true)
  })

  it.each(FINDINGS.map((finding) => finding.heading))('"%s" has a heading in the README', (heading) => {
    expect(README).toContain(`## ${heading}`)
  })

  // The other direction: a section that reads like a finding and has no
  // predicate behind it is how a document starts describing a measurement
  // nobody takes any more.
  it('has a finding behind every finding-shaped heading, in the same order', () => {
    const headings = [...README.matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? '')
    const structural = new Set([
      'The subject',
      'The faults',
      'The wirings',
      'The matrix',
      'The two injection layers',
      'The same table, injected the cheap way',
      'Where the two layers disagree',
      'Using it',
      'What is not measured here',
    ])
    const claims = headings.filter((heading) => !structural.has(heading))

    expect(claims).toEqual(FINDINGS.map((finding) => finding.heading))
  })

  // Every structural heading is also required to exist, so that deleting one
  // of the tables' sections cannot quietly pass by making its heading
  // "non-structural" and therefore unchecked.
  it.each([
    'The subject',
    'The faults',
    'The wirings',
    'The matrix',
    'The two injection layers',
    'The same table, injected the cheap way',
    'Where the two layers disagree',
    'Using it',
    'What is not measured here',
  ])('carries the structural heading "%s"', (heading) => {
    expect(README).toContain(`## ${heading}`)
  })
})

describe('the numbers in the prose', () => {
  it('states how many cells the two layers disagree about', () => {
    expect(disagreements()).toHaveLength(12)
    expect(QUOTED.disagreements).toBe(12)
    expect(PROSE).toContain('all twelve such cells')
    expect(PROSE).toContain('Twelve cells of fifty-four')
  })

  it('states the four-by-three shape the twelve disagreements have', () => {
    const faults = new Set(disagreements().map((entry) => entry.fault))
    const policies = new Set(disagreements().map((entry) => entry.policy))

    expect([...faults].sort()).toEqual(['black-hole', 'slow-body', 'slow-headers'])
    expect(policies.size).toBe(4)
    expect(PROSE).toContain('Four times three is twelve')
  })

  it('states the six columns the two layers agree on completely', () => {
    const disagreeing = new Set(disagreements().map((entry) => entry.fault))
    const agreeing = FAULT_IDS.filter((fault) => !disagreeing.has(fault))

    expect(agreeing).toHaveLength(6)

    for (const fault of agreeing) {
      expect(PROSE).toContain(`\`${fault}\``)
    }

    expect(PROSE).toContain('six columns, every wiring, exact agreement')
  })

  it('states how late the broken timeout answers, as a multiple of its budget', () => {
    expect(INJECTED_MS / BUDGET_MS).toBe(9)
    expect(PROSE).toContain('nine times its own budget late')
    expect(PROSE).toContain(`${String(BUDGET_MS)}ms SLA gets a ${String(INJECTED_MS)}ms answer`)
  })

  it('states the amplification factor the retry column shows', () => {
    const amplified = FAULT_IDS.filter(
      (fault) =>
        TABLES.socket['retry-any'][fault].requests === TABLES.socket['retry-5xx'][fault].requests * QUOTED.attempts,
    )

    expect(amplified).toHaveLength(6)
    expect(PROSE).toContain('on six of the nine, where `retry-any` sends exactly three times as many')
  })

  it('states how many faults the breaker row cannot tell apart', () => {
    const open = FAULT_IDS.filter((fault) => TABLES.socket.breaker[fault].outcome === 'breaker-open')

    expect(open).toHaveLength(7)
    expect(PROSE).toContain("On seven of the nine faults the breaker's cell is **identical**")
  })

  it('states the fault catalogue\'s shape', () => {
    expect(FAULTS).toHaveLength(9)
    expect(PROSE).toContain('Nine faults, six resilience wirings')
    expect(PROSE).toContain('Two per latency, three per error, three per outage, and a control')
  })

  it('says plainly that there is no gate of its own and why', () => {
    expect(PROSE).toContain('There is no `chaos:check` script and no CI job of its own')
    expect(PROSE).toContain('belongs inside `pnpm test`')
  })

  it('names the one fault worth copying first', () => {
    expect(PROSE).toContain('take `slow-body`')
  })

  it('declares the layer it does not measure', () => {
    expect(PROSE).toContain('MSW')
    expect(PROSE).toContain('makes no claim about it')
  })
})
