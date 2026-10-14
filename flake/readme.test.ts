// @vitest-environment node
//
// README.md's tables are not checked against the model — they are *rendered
// from* it and compared as text, the discipline `k6/`, `intercept/`, `trace/`
// and `lighthouse/` established. There is no version of this file that agrees
// with a published table holding a wrong cell.
//
// The findings are held to the same standard in both directions: each is a
// predicate over the measured tables plus a heading the README must carry, so
// a finding that stops being true fails here, and a heading with no finding
// behind it fails here too.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EXPECTED } from './matrix.ts'
import { DEFAULT_QUARANTINE_POLICY } from './quarantine.ts'
import { FINDINGS, MEASURED_AGAINST, renderIdentity, renderMatrix, renderWirings, SOUND_WIRINGS } from './render.ts'
import { WIRINGS } from './wirings.ts'

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
  it('carries the rerun matrix as rendered from the measured rows', () => {
    expect(README).toContain(renderMatrix())
  })

  it('carries the wiring catalogue as rendered from the wirings', () => {
    expect(README).toContain(renderWirings())
  })

  it('carries the identity table as rendered from the measured forms', () => {
    expect(README).toContain(renderIdentity())
  })

  it('names the versions every cell was measured against', () => {
    expect(PROSE).toContain(MEASURED_AGAINST)
  })

  it('states the number of cells the suite re-derives', () => {
    const cells = WIRINGS.length * 7

    expect(cells).toBe(77)
    expect(PROSE).toContain(`all ${String(cells)} cells`)
  })
})

describe('the findings', () => {
  for (const finding of FINDINGS) {
    describe(finding.heading, () => {
      it('still holds against the measured tables', () => {
        expect(finding.holds()).toBe(true)
      })

      it('has a heading in README.md', () => {
        expect(README).toContain(`### ${finding.heading}`)
      })
    })
  }

  it('has a finding behind every finding-level heading', () => {
    const headings = [...README.matchAll(/^### (.+)$/gm)].map((match) => match[1])
    const claimed = FINDINGS.map((finding) => finding.heading)

    expect(headings.filter((heading) => heading !== undefined && !claimed.includes(heading))).toEqual([])
  })
})

describe('the prose', () => {
  it('says how many wirings have retries in them, and how many of those record soundly', () => {
    const retrying = WIRINGS.filter((wiring) => wiring.retries > 0)
    const soundAndRetrying = retrying.filter((wiring) => EXPECTED[wiring.id]?.counting === 'sound')

    expect(retrying).toHaveLength(7)
    expect(soundAndRetrying).toHaveLength(2)
    expect(PROSE).toContain('seven wirings make the build pass, and two of the seven')
  })

  it('does not claim a sound record from a wiring that has none', () => {
    const unsound = WIRINGS.map((wiring) => wiring.id).filter((id) => EXPECTED[id]?.counting !== 'sound')

    expect(SOUND_WIRINGS).not.toEqual(expect.arrayContaining(unsound))
  })

  it('quotes the quarantine policy’s own numbers', () => {
    expect(PROSE).toContain(`at most ${String(DEFAULT_QUARANTINE_POLICY.maximumEntries)} entries`)
    expect(PROSE).toContain(`more than ${String(DEFAULT_QUARANTINE_POLICY.maximumDays)} days`)
  })

  it('lists every file in the directory’s table of files', () => {
    // A directory whose README stops mentioning a module is how a reader comes
    // to believe the module is internal.
    const listed = [...README.matchAll(/^\| `([\w./-]+)` \| /gm)].map((match) => match[1])

    for (const file of [
      'wirings.ts',
      'read.ts',
      'probes.ts',
      'runs.ts',
      'matrix.ts',
      'identity.ts',
      'reporter.ts',
      'attempts.ts',
      'history.ts',
      'quarantine.ts',
      'dashboard.ts',
      'collect.ts',
      'check.ts',
      'fixture/',
    ]) {
      expect(listed).toContain(file)
    }
  })

  it('names the five defects of the mechanism it replaces', () => {
    for (const defect of [
      'had no call sites',
      'could not pass',
      'could not load the file that defines quarantine',
      'was never written',
      'is the one that never shows them',
    ]) {
      expect(PROSE).toContain(defect)
    }
  })

  it('tells the reader the commands that re-measure it', () => {
    for (const command of ['pnpm flake:check', 'pnpm test:quarantine', 'FLAKE_HISTORY']) {
      expect(README).toContain(command)
    }
  })
})
