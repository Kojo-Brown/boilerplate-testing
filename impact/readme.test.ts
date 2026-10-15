// @vitest-environment node
//
// README.md's tables are not checked against the model — they are *rendered
// from* it and compared as text, the discipline the rest of this repository
// established. There is no version of this file that agrees with a published
// table holding a wrong cell.
//
// The findings are held to the same standard in both directions: each is a
// predicate over the measured matrix plus a heading the README must carry, so
// a finding that stops being true fails here, and a heading with no finding
// behind it fails here too.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { FAULTS } from './faults.ts'
import { MATRIX, TOTAL_SUITES, totalSelected } from './matrix.ts'
import {
  FINDINGS,
  MEASURED_AGAINST,
  renderFaults,
  renderMatrix,
  renderStrategies,
} from './render.ts'
import { STRATEGIES } from './strategies.ts'

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
  it('carries the fault catalogue as rendered from the measured ground truth', () => {
    expect(README).toContain(renderFaults())
  })

  it('carries the strategy catalogue as rendered from the strategies', () => {
    expect(README).toContain(renderStrategies())
  })

  it('carries the matrix as rendered from the measured cells', () => {
    expect(README).toContain(renderMatrix())
  })

  it('names the versions every cell was measured against', () => {
    expect(PROSE).toContain(MEASURED_AGAINST)
  })

  it('states the number of cells the suite re-derives', () => {
    const cells = STRATEGIES.length * FAULTS.length

    expect(cells).toBe(64)
    expect(PROSE).toContain(`all ${String(cells)} cells`)
  })
})

describe('the findings', () => {
  it.each(FINDINGS.map((finding) => finding.heading))('"%s" is still true of the measurement', (heading) => {
    const finding = FINDINGS.find((candidate) => candidate.heading === heading)

    expect(finding?.holds()).toBe(true)
  })

  it.each(FINDINGS.map((finding) => finding.heading))('"%s" has a heading in the README', (heading) => {
    expect(README).toContain(`## ${heading}`)
  })

  // The other direction: a section that reads like a finding and has no
  // predicate behind it is how a document starts describing a measurement
  // nobody takes any more.
  it('has a finding behind every finding-shaped heading', () => {
    const headings = [...README.matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? '')
    const structural = new Set([
      'The subject',
      'The faults',
      'The strategies',
      'The matrix',
      'Using it',
      'What is not measured here',
    ])
    const claims = headings.filter((heading) => !structural.has(heading))

    expect(claims).toEqual(FINDINGS.map((finding) => finding.heading))
  })
})

describe('the numbers in the prose', () => {
  it('states what the cheapest strategy costs and what it misses', () => {
    expect(totalSelected('changed-tests')).toBe(1)
    expect(PROSE).toContain(`**1 suite out of ${String(TOTAL_SUITES)}**`)
    expect(PROSE).toContain('seven faults out of eight')
  })

  it('states what the safe strategy runs, as the fraction it measured', () => {
    expect(totalSelected('transitive-triggers-edges')).toBe(21)
    expect(PROSE).toContain(`**21 of ${String(TOTAL_SUITES)}**`)
  })

  it('states the tighter coverage selection it compares the graph against', () => {
    expect(MATRIX.coverage['scale-cents'].selected).toBe(4)
    expect(MATRIX['importers-transitive']['scale-cents'].selected).toBe(5)
    expect(PROSE).toContain('(4 suites against 5)')
  })

  it('states the cost of the co-location heuristic beside the safe one', () => {
    expect(totalSelected('same-directory')).toBe(17)
    expect(PROSE).toContain(`17 suites against the safe selector's ${String(totalSelected('transitive-triggers-edges'))}`)
  })

  // The two documented entry points, named in the one place somebody reads
  // before running anything.
  it('names both scripts', () => {
    expect(README).toContain('pnpm impact:check')
    expect(README).toContain('pnpm impact:run')
  })

  it('says plainly that the full run is what gates the merge', () => {
    expect(PROSE).toContain('fast feedback **beside** the full run')
  })
})
