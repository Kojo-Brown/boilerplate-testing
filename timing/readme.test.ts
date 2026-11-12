// @vitest-environment node
//
// README.md's tables are not checked against the model — they are *rendered
// from* it and compared as text, the discipline the rest of this repository
// established. There is no version of this file that agrees with a published
// table holding a wrong cell.
//
// The findings are held to the same standard in both directions: each is a
// predicate over the measurement plus a heading the README must carry, so a
// finding that stops being true fails here, and a heading with no finding
// behind it fails here too. `findings.test.ts` adds the third direction, which
// is the one that keeps a predicate from being decoration.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BUDGET } from './budget.ts'
import { CORPUS } from './corpus.ts'
import { FAULT_IDS } from './faults.ts'
import { GATE_IDS } from './gates.ts'
import { RUNS, TOTAL_CELLS } from './matrix.ts'
import {
  FINDINGS,
  MEASURED,
  QUOTED,
  renderCalibration,
  renderDilution,
  renderFaults,
  renderGates,
  renderMatrix,
  renderNoise,
  renderThresholds,
} from './render.ts'

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
  it('carries the noise profile as rendered from the corpus', () => {
    expect(README).toContain(renderNoise())
  })

  it('carries the fault catalogue as rendered from the faults', () => {
    expect(README).toContain(renderFaults())
  })

  it('carries the design catalogue as rendered from the gates', () => {
    expect(README).toContain(renderGates())
  })

  it('carries the matrix as rendered from the measurement', () => {
    expect(README).toContain(renderMatrix())
  })

  it('carries the dilution table as rendered from the scaling model', () => {
    expect(README).toContain(renderDilution())
  })

  it('carries the calibration as rendered from budget.json', () => {
    expect(README).toContain(renderCalibration())
  })

  it('carries both sets of thresholds side by side', () => {
    expect(README).toContain(renderThresholds())
  })

  it('names every design and every fault somewhere in the document', () => {
    for (const id of GATE_IDS) expect(README).toContain(id)
    for (const id of FAULT_IDS) expect(README).toContain(id)
  })
})

describe('the findings', () => {
  it('each hold against the measurement as published', () => {
    for (const finding of FINDINGS) {
      expect(finding.holds(MEASURED), finding.heading).toBe(true)
    }
  })

  it('each have their heading in the document', () => {
    for (const finding of FINDINGS) {
      expect(README, finding.heading).toContain(`### ${finding.heading}`)
    }
  })

  // The other direction: a `###` heading in the findings sections with no
  // predicate behind it is a claim nothing checks.
  it('account for every third-level heading the document carries', () => {
    const headings = [...README.matchAll(/^### (.+)$/gm)].map((match) => match[1])
    const claimed = new Set(FINDINGS.map((finding) => finding.heading))
    const unbacked = headings.filter(
      (heading) =>
        heading !== undefined &&
        !claimed.has(heading) &&
        // The two sections that are prose about the calibration rather than a
        // finding over the matrix. Named here so that adding a third has to be
        // a decision rather than an omission.
        heading !== 'What that costs, and why it costs less than it looks',
    )

    expect(unbacked).toEqual([])
  })
})

describe('the numbers in the prose', () => {
  it('quotes the thresholds the code actually uses', () => {
    for (const quoted of QUOTED) {
      expect(PROSE).toContain(quoted)
    }
  })

  it('quotes the calibrated thresholds the gate enforces', () => {
    const { fileDeltaMs, fileFloorMs, totalTolerance, fileTolerance } = BUDGET.thresholds

    expect(PROSE).toContain(`${String(fileDeltaMs)}ms`)
    expect(PROSE).toContain(`${String(fileFloorMs)}ms`)
    expect(PROSE).toContain(`${String(Math.round(totalTolerance * 100))}%`)
    expect(PROSE).toContain(`${String(Math.round(fileTolerance * 100))}%`)
  })

  it('states the cell count and the run count the matrix was taken over', () => {
    expect(PROSE).toContain(String(TOTAL_CELLS))
    expect(PROSE).toContain(String(RUNS))
    expect(RUNS).toBe(CORPUS.recorded.runs)
  })

  it('states the measured coverage both ways round', () => {
    const { policedFiles, policedShareOfWallClock } = BUDGET.calibration

    expect(PROSE).toContain(`${String(policedFiles)} files`)
    expect(PROSE).toContain(`${String(Math.round(policedShareOfWallClock * 100))}%`)
  })
})

describe('the document', () => {
  it('tells a reader how to run the gate, the recorder and the calibration', () => {
    expect(README).toContain('pnpm timing:check')
    expect(README).toContain('node timing/record.ts')
    expect(README).toContain('node timing/calibrate.ts')
  })

  it('says the two reports are measured on one machine in one job', () => {
    expect(PROSE).toMatch(/same machine|one machine/)
    expect(PROSE).toContain('one job')
  })

  // The instruction this directory exists to make unnecessary to repeat.
  it('tells a reader not to lower a threshold to turn a build green', () => {
    expect(PROSE).toMatch(/[Dd]o not lower a threshold/)
  })
})
