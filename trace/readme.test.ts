// @vitest-environment node
//
// `README.md`'s tables are not checked against the model — they are *rendered
// from* it and compared as text. The discipline `intercept/`, `matrix/`, `a11y/`
// and `visual/` established: there is no version of this file that agrees with a
// published table holding a wrong cell or a row somebody reordered.
//
// The findings are held to the same standard in both directions. Each one is a
// predicate over a table *and* a heading the README must carry, so a finding that
// stops being true fails here, and a heading with no finding behind it fails here
// too — the prose cannot drift into claiming something the measurement no longer
// supports.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CHANNEL_NAMES } from './channels.ts'
import {
  FINDINGS as EVIDENCE_FINDINGS,
  VERDICTS,
  VERDICT_MEANINGS,
  renderCaseTable,
  renderEvidenceTable,
} from './evidence.ts'
import { CASE_NAMES } from './faults.ts'
import {
  FINDINGS as RETENTION_FINDINGS,
  OUTCOMES,
  RETENTION_MODES,
  recordTheWrongAttempt,
  renderRetentionTable,
  uselessForFlakes,
} from './retention.ts'

const README = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8')

/**
 * The same text with its line wrapping flattened.
 *
 * Prose assertions read this rather than `README`: a sentence that says the right
 * thing should not fail because the paragraph was re-wrapped, and a sentence that
 * says the wrong thing should not pass because it was.
 */
const PROSE = README.replace(/\s+/g, ' ')

const FINDINGS = [...EVIDENCE_FINDINGS, ...RETENTION_FINDINGS]

describe('the tables are rendered, not transcribed', () => {
  it('carries the fault catalogue exactly as `renderCaseTable` prints it', () => {
    expect(README).toContain(renderCaseTable())
  })

  it('carries the evidence table exactly as `renderEvidenceTable` prints it', () => {
    expect(README).toContain(renderEvidenceTable())
  })

  it('carries the retention table exactly as `renderRetentionTable` prints it', () => {
    expect(README).toContain(renderRetentionTable())
  })
})

describe('every finding is published, and every published finding holds', () => {
  for (const finding of FINDINGS) {
    it(`carries and supports: ${finding.heading.replace(/^#+ /, '')}`, () => {
      // Matched as a whole line, so a section renamed to soften a claim fails
      // rather than passing on a substring.
      expect(README.split('\n')).toContain(finding.heading)
      expect(finding.holds()).toBe(true)
    })
  }

  it('has no finding-shaped heading that no finding stands behind', () => {
    const declared = new Set(FINDINGS.map((finding) => finding.heading))
    const structural = new Set([
      '## When to reach for this',
      '## Getting the trace out of CI',
      '## Which runs leave a trace behind',
      '## Eight faults',
      '## What each channel is worth',
      '## A reading order',
      '## What is not measured here',
      '## Files',
    ])

    const orphans = README.split('\n').filter(
      (line) => line.startsWith('## ') && !declared.has(line) && !structural.has(line),
    )

    expect(orphans).toEqual([])
  })
})

describe('the legends match the models', () => {
  it('explains every verdict, in the words `evidence.ts` uses', () => {
    for (const value of VERDICTS) {
      expect(PROSE).toContain(`\`${value}\` — ${VERDICT_MEANINGS[value]}`)
    }
  })

  it('names every channel', () => {
    for (const channel of CHANNEL_NAMES) {
      expect(README).toContain(channel)
    }
  })

  it('names every mode and every outcome', () => {
    for (const mode of RETENTION_MODES) {
      expect(README).toContain(`\`${mode}\``)
    }

    for (const outcome of OUTCOMES) {
      expect(README).toContain(outcome)
    }
  })

  it('names every fault', () => {
    for (const name of CASE_NAMES) {
      expect(README).toContain(`\`${name}\``)
    }
  })
})

describe('the prose agrees with the numbers it quotes', () => {
  it('names the modes it calls useless for a flake', () => {
    const useless = uselessForFlakes()
    // The sentence itself rather than the whole document: a mode that stops
    // being useless has to leave this list, and a mode that starts being
    // useless has to join it, and either way naming it somewhere else in the
    // README must not satisfy this.
    const sentence = /Half the modes cannot help you with a flake ([^.]*)\./.exec(PROSE)?.[1]

    expect(sentence).toBeDefined()
    expect(useless).toHaveLength(3)

    for (const mode of useless) {
      expect(sentence).toContain(`\`${mode}\``)
    }

    expect(sentence).toContain('three of the six')
  })

  it('names both modes that record the attempt that worked', () => {
    for (const mode of recordTheWrongAttempt()) {
      expect(PROSE).toContain(`\`${mode}\``)
    }

    expect(recordTheWrongAttempt()).toHaveLength(2)
  })

  it('quotes the count of faults that do not name themselves', () => {
    // The section heading carries the number, so a change to the table that
    // moves it fails the finding *and* this.
    expect(README).toContain('## Five faults out of eight do not name themselves')
    expect(CASE_NAMES).toHaveLength(8)
  })
})

describe('the guide tells you how to get at a trace', () => {
  it('shows the artefact upload, and does not use `if: failure()` for it', () => {
    expect(README).toContain('actions/upload-artifact')
    expect(README).toContain('if: ${{ !cancelled() }}')
    // `failure()` is the trap the section exists to warn about: a flake that
    // passed on its retry does not fail the job.
    expect(PROSE).toContain('rather than `if: failure()`')
  })

  it('names both ways to open one', () => {
    expect(README).toContain('playwright show-trace')
    expect(README).toContain('trace.playwright.dev')
  })

  it('points at the gate that keeps it honest', () => {
    expect(README).toContain('pnpm trace:check')
  })
})

describe('the files table', () => {
  it('lists every module in the directory', () => {
    for (const file of [
      'subject.ts',
      'server.ts',
      'faults.ts',
      'zip.ts',
      'channels.ts',
      'evidence.ts',
      'retention.ts',
      'evidence.spec.ts',
      'check.ts',
    ]) {
      expect(README).toContain(`| \`${file}\` |`)
    }
  })
})
