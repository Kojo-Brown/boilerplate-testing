// @vitest-environment node
//
// README.md's tables are not checked against the model — they are *rendered
// from* it and compared as text, the discipline `intercept/`, `trace/` and
// `authstate/` established. There is no version of this file that agrees with a
// published table holding a wrong cell.
//
// The findings are held to the same standard in both directions: each is a
// predicate plus a heading the README must carry, so a finding that stops being
// true fails here, and a heading with no finding behind it fails here too. The
// prose cannot drift into claiming something the measurement no longer supports.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { AGREEMENT_CASES } from './agreement.ts'
import { profiles, type ProfileName } from './config.ts'
import {
  FINDINGS,
  MEASURED_AGAINST,
  QUESTIONS,
  renderProfileTable,
  renderWitnessTable,
} from './findings.ts'

const README = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8')

/**
 * The same text with its line wrapping flattened.
 *
 * Prose assertions read this: a sentence that says the right thing should not
 * fail because the paragraph was re-wrapped, and a sentence that says the wrong
 * thing should not pass because it was.
 */
const PROSE = README.replace(/\s+/g, ' ')

describe('the tables are rendered, not transcribed', () => {
  it('carries the scenario table exactly as `renderProfileTable` prints it', () => {
    expect(README).toContain(renderProfileTable())
  })

  it('carries the witness table exactly as `renderWitnessTable` prints it', () => {
    expect(README).toContain(renderWitnessTable())
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

  it('publishes no finding under "What was measured" that has no finding behind it', () => {
    // Scoped to that section: `###` is also used for ordinary subheadings
    // elsewhere, and a heading is only a *claim* where the claims are
    // published. The section must exist, or the scoping would silently check
    // nothing.
    const start = README.indexOf('\n## What was measured\n')
    expect(start, 'the findings section is missing').toBeGreaterThan(-1)

    const end = README.indexOf('\n## ', start + 1)
    const section = README.slice(start, end === -1 ? undefined : end)

    const published = section.split('\n').filter((line) => line.startsWith('### '))
    const claimed = FINDINGS.map((finding) => finding.heading)

    expect(published.filter((heading) => !claimed.includes(heading))).toEqual([])
    // And in the other direction: every finding is published *in that section*,
    // not merely somewhere in the file.
    expect(claimed.filter((heading) => !published.includes(heading))).toEqual([])
  })
})

describe('the scenarios are documented', () => {
  for (const name of Object.keys(profiles) as ProfileName[]) {
    it(`says when to use \`${name}\``, () => {
      expect(PROSE).toContain(`**\`${name}\`**`)
    })

    it(`publishes the question \`${name}\` answers`, () => {
      expect(PROSE).toContain(QUESTIONS[name])
    })
  }
})

describe('the numbers in the prose are the measured ones', () => {
  it('names the k6 version every measurement was taken against', () => {
    expect(PROSE).toContain(MEASURED_AGAINST.replace('k6 ', ''))
  })

  it('states the agreement case count the gate actually runs', () => {
    // Two places say it, and both are generated from the same array in
    // `agreement.ts`, so adding a case without updating the prose fails.
    expect(PROSE).toContain(`${AGREEMENT_CASES.length} cases`)
    expect(PROSE).toContain(`the ${AGREEMENT_CASES.length} cases`)
  })

  it('states k6 default --summary-trend-stats as the export-blindness finding needs it', () => {
    expect(PROSE).toContain('avg,min,med,max,p(90),p(95)')
  })

  it('states the exit codes the gate asserts', () => {
    expect(PROSE).toContain('exit 99')
    expect(PROSE).toContain('exit 0')
  })
})

describe('the file table covers the directory', () => {
  const listed = [...README.matchAll(/^\| `([a-z.-]+\.(?:ts|md))`/gm)].map((match) => match[1])

  it('lists every source file in this directory', async () => {
    const { readdirSync } = await import('node:fs')
    const onDisk = readdirSync(fileURLToPath(new URL('.', import.meta.url)))
      .filter((file) => file.endsWith('.ts'))
      // Tests and configs are not patterns to be chosen between, which is what
      // the table is for.
      .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.json'))

    expect([...listed].sort()).toEqual(onDisk.sort())
  })
})

describe('the install line matches the version measured', () => {
  it('pins the same k6 version in the curl line as in the claims', () => {
    const version = MEASURED_AGAINST.replace('k6 ', '')
    const installs = [...README.matchAll(/k6-(v\d+\.\d+\.\d+)-linux-amd64/g)].map((m) => m[1])

    expect(installs.length).toBeGreaterThan(0)
    expect([...new Set(installs)]).toEqual([version])
  })
})
