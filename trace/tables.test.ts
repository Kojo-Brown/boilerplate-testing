// @vitest-environment node
//
// Both tables, and the catalogue they index, checked for the things a browser
// cannot tell you: that every fault has a row, every row has a verdict for every
// channel, and every finding still holds over the numbers it was derived from.
//
// `check.ts` repeats the findings against the same tables, and that repetition is
// deliberate: `pnpm trace:check` is meant to be a complete verdict on this
// directory, and `pnpm test` is meant to catch a broken finding on a machine with
// no browser. Neither is the other's backstop.

import { describe, expect, it } from 'vitest'

import { CHANNEL_DESCRIPTIONS, CHANNEL_NAMES } from './channels.ts'
import {
  EVIDENCE,
  FINDINGS as EVIDENCE_FINDINGS,
  VERDICTS,
  VERDICT_MEANINGS,
  causesFor,
  emptyCount,
  emptyFor,
  renderCaseTable,
  renderEvidenceTable,
  verdict,
} from './evidence.ts'
import { CASES, CASE_NAMES, caseByName, pageFaults } from './faults.ts'
import {
  FINDINGS as RETENTION_FINDINGS,
  KEPT,
  OUTCOMES,
  OUTCOME_MEANINGS,
  RETENTION,
  RETENTION_MODES,
  isRetentionMode,
  keepsAFailedAttempt,
  keepsEveryFailedAttempt,
  kept,
  recordTheWrongAttempt,
  renderRetentionTable,
  uselessForFlakes,
} from './retention.ts'

describe('the catalogue', () => {
  it('has a case for every page fault and one that is not a page fault', () => {
    const named = new Set<string>(CASE_NAMES)

    for (const fault of pageFaults()) {
      expect(named.has(fault)).toBe(true)
    }

    // `missing-env` is the extra: the fault that never reaches a browser, and
    // the row that marks the boundary of what a trace can explain.
    expect(CASE_NAMES.length).toBe(pageFaults().length + 1)
    expect(named.has('missing-env')).toBe(true)
  })

  it('names each case once', () => {
    expect(new Set(CASE_NAMES).size).toBe(CASE_NAMES.length)
  })

  it('says what is wrong and what CI reports, for every case', () => {
    for (const entry of CASES) {
      expect(entry.defect.length).toBeGreaterThan(10)
      expect(entry.reportedAs.length).toBeGreaterThan(5)
    }
  })

  it('refuses a name it does not have', () => {
    // @ts-expect-error -- the point of the check is the runtime guard.
    expect(() => caseByName('no-such-fault')).toThrow(/Unknown case/)
  })

  it('reports most faults as something other than their defect', () => {
    // The premise of the whole directory. If a CI log said what was wrong,
    // nobody would need a trace.
    const timeouts = CASES.filter((entry) => entry.reportedAs.includes('timeout'))

    expect(timeouts.length).toBeGreaterThanOrEqual(CASES.length / 2)
  })
})

describe('the evidence table', () => {
  it('has a row for every case and a column for every channel', () => {
    expect(Object.keys(EVIDENCE).sort()).toEqual([...CASE_NAMES].sort())

    for (const name of CASE_NAMES) {
      expect(Object.keys(EVIDENCE[name]).sort()).toEqual([...CHANNEL_NAMES].sort())
    }
  })

  it('uses only declared verdicts', () => {
    for (const name of CASE_NAMES) {
      for (const channel of CHANNEL_NAMES) {
        expect(VERDICTS).toContain(verdict(name, channel))
      }
    }
  })

  it('explains every verdict and every channel', () => {
    for (const value of VERDICTS) {
      expect(VERDICT_MEANINGS[value].length).toBeGreaterThan(10)
    }

    for (const channel of CHANNEL_NAMES) {
      expect(CHANNEL_DESCRIPTIONS[channel].length).toBeGreaterThan(10)
    }
  })

  it('never declares the error channel empty', () => {
    // A failing test always records an error. A row claiming otherwise would be
    // describing a trace of something that passed.
    for (const name of CASE_NAMES) {
      expect(verdict(name, 'error')).not.toBe('empty')
    }
  })

  it('agrees with its own accessors', () => {
    for (const name of CASE_NAMES) {
      expect(causesFor(name).every((channel) => verdict(name, channel) === 'cause')).toBe(true)
      expect(emptyCount(name)).toBe(
        CHANNEL_NAMES.filter((channel) => verdict(name, channel) === 'empty').length,
      )
    }

    for (const channel of CHANNEL_NAMES) {
      expect(emptyFor(channel).every((name) => verdict(name, channel) === 'empty')).toBe(true)
    }
  })

  it('renders one row per case, in catalogue order', () => {
    const lines = renderEvidenceTable().split('\n')

    expect(lines).toHaveLength(CASE_NAMES.length + 2)

    for (const [index, name] of CASE_NAMES.entries()) {
      expect(lines[index + 2]).toContain(`\`${name}\``)
    }
  })

  it('renders the catalogue with the same rows', () => {
    expect(renderCaseTable().split('\n')).toHaveLength(CASES.length + 2)
  })
})

describe('the retention table', () => {
  it('has a row for every mode and a column for every outcome', () => {
    expect(Object.keys(RETENTION).sort()).toEqual([...RETENTION_MODES].sort())

    for (const mode of RETENTION_MODES) {
      expect(Object.keys(RETENTION[mode]).sort()).toEqual([...OUTCOMES].sort())
    }
  })

  it('uses only declared answers', () => {
    for (const mode of RETENTION_MODES) {
      for (const outcome of OUTCOMES) {
        expect(KEPT).toContain(kept(mode, outcome))
      }
    }
  })

  it('explains every outcome', () => {
    for (const outcome of OUTCOMES) {
      expect(OUTCOME_MEANINGS[outcome].length).toBeGreaterThan(10)
    }
  })

  it('keeps nothing at all under `off`', () => {
    for (const outcome of OUTCOMES) {
      expect(kept('off', outcome)).toBe('none')
      expect(keepsAFailedAttempt('off', outcome)).toBe(false)
    }
  })

  it('never credits a passing test with a failed attempt', () => {
    for (const mode of RETENTION_MODES) {
      expect(keepsAFailedAttempt(mode, 'passing')).toBe(false)
    }
  })

  it('counts a flake as helped only when the failed attempt survived', () => {
    for (const mode of RETENTION_MODES) {
      const attempts = kept(mode, 'flaky')

      expect(keepsAFailedAttempt(mode, 'flaky')).toBe(attempts === 'first' || attempts === 'both')
    }

    // The two sets are complements by construction, and the README quotes both.
    expect(
      [...uselessForFlakes(), ...RETENTION_MODES.filter((m) => keepsAFailedAttempt(m, 'flaky'))]
        .length,
    ).toBe(RETENTION_MODES.length)
    expect(recordTheWrongAttempt().every((mode) => uselessForFlakes().includes(mode))).toBe(true)
  })

  it('is stricter about every failed attempt than about some failed attempt', () => {
    for (const mode of RETENTION_MODES) {
      if (keepsEveryFailedAttempt(mode)) {
        expect(keepsAFailedAttempt(mode, 'failing')).toBe(true)
        expect(keepsAFailedAttempt(mode, 'flaky')).toBe(true)
      }
    }
  })

  it('renders one row per mode, in declaration order', () => {
    const lines = renderRetentionTable().split('\n')

    expect(lines).toHaveLength(RETENTION_MODES.length + 2)

    for (const [index, mode] of RETENTION_MODES.entries()) {
      expect(lines[index + 2]).toContain(`\`${mode}\``)
    }
  })

  it('accepts every mode it publishes and nothing else', () => {
    for (const mode of RETENTION_MODES) {
      expect(isRetentionMode(mode)).toBe(true)
    }

    expect(isRetentionMode('retain-on-retry')).toBe(false)
  })
})

describe('the findings', () => {
  for (const finding of [...EVIDENCE_FINDINGS, ...RETENTION_FINDINGS]) {
    it(`holds: ${finding.heading.replace(/^#+ /, '')}`, () => {
      expect(finding.holds()).toBe(true)
    })
  }

  it('states each one once', () => {
    const headings = [...EVIDENCE_FINDINGS, ...RETENTION_FINDINGS].map((entry) => entry.heading)

    expect(new Set(headings).size).toBe(headings.length)
  })
})
