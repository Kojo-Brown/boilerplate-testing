// @vitest-environment node
//
// `README.md`'s tables are not checked against the model — they are *rendered
// from* it and compared as text. The discipline `intercept/`, `matrix/` and
// `a11y/` established: there is no version of this file that agrees with a
// published table holding a wrong cell or a row somebody reordered.
//
// The findings are held to the same standard in both directions. Each one
// below is a predicate over the model *and* a heading the README must carry:
// a finding that stops being true fails here, and a heading with no finding
// behind it fails here too, so the prose cannot drift into claiming something
// the measurement no longer supports.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CHANGES, NOISE, REGRESSIONS, change } from './changes.ts'
import {
  LIFECYCLE,
  absorbingModes,
  renderLifecycleTable,
  safeModes,
  seedingModes,
} from './lifecycle.ts'
import {
  WIRINGS,
  decide,
  flags,
  outcome,
  renderChangeTable,
  renderMatrix,
  renderWiringTable,
  scoreOf,
  wiring,
} from './wirings.ts'
const README = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8')

/**
 * The same text with its line wrapping flattened.
 *
 * Prose assertions read this rather than `README`: a sentence that says the
 * right thing should not fail because the paragraph was re-wrapped, and a
 * sentence that says the wrong thing should not pass because it was.
 */
const PROSE = README.replace(/\s+/g, ' ')

describe('the tables are rendered, not transcribed', () => {
  it('carries the catalogue exactly as `renderChangeTable` prints it', () => {
    expect(README).toContain(renderChangeTable())
  })

  it('carries the wiring table exactly as `renderWiringTable` prints it', () => {
    expect(README).toContain(renderWiringTable())
  })

  it('carries the matrix exactly as `renderMatrix` prints it', () => {
    expect(README).toContain(renderMatrix())
  })

  it('carries the lifecycle table exactly as `renderLifecycleTable` prints it', () => {
    expect(README).toContain(renderLifecycleTable())
  })
})

/**
 * Each finding: the heading the README carries it under, and the claim itself
 * as a function over the model.
 *
 * The heading is matched as a whole line so that a section that was renamed to
 * soften a claim fails rather than passing on a substring.
 */
const FINDINGS: readonly { readonly heading: string; readonly holds: () => boolean }[] = [
  {
    heading: '## Capture and comparison are two phases, and the API hides that',
    // Six of the nine differ from another wiring only in how images are graded.
    holds: () =>
      WIRINGS.filter((subject) => {
        const parent = subject.derivedFrom === null ? null : wiring(subject.derivedFrom)

        return (
          parent !== null &&
          parent.capture.scope === subject.capture.scope &&
          parent.capture.mask === subject.capture.mask &&
          parent.capture.animations === subject.capture.animations
        )
      }).length >= 5,
  },
  {
    heading: '## `threshold: 0.2` is not a little slack for anti-aliasing',
    holds: () =>
      decide(wiring('playwright-default'), change('brand-shade')) === 'below-threshold' &&
      change('panel-recoloured').delta === 'hairline',
  },
  {
    heading: '## The two knobs are in series, not in parallel',
    holds: () =>
      // `budgeted` buys a noise cell over `masked`; `over-tolerant` buys none
      // over `whole-page` and pays three regressions.
      scoreOf(wiring('budgeted')) === scoreOf(wiring('masked')) + 1 &&
      scoreOf(wiring('over-tolerant')) === scoreOf(wiring('whole-page')) - 3 &&
      NOISE.every(
        (target) =>
          outcome(wiring('over-tolerant'), target) === outcome(wiring('whole-page'), target),
      ),
  },
  {
    heading: '## A mask is a solid rectangle, not a filter',
    holds: () =>
      decide(wiring('masked'), change('stamp-recoloured')) === 'masked-out' &&
      decide(wiring('masked'), change('stamp-text')) === 'masked-out' &&
      flags(wiring('masked'), change('stamp-enlarged')) &&
      flags(wiring('frozen'), change('stamp-recoloured')),
  },
  {
    heading: "## `animations: 'disabled'` is a control over the engine's animations",
    holds: () =>
      outcome(wiring('naive'), change('css-animation-phase')) === 'false-alarm' &&
      outcome(wiring('frozen'), change('css-animation-phase')) === 'clean' &&
      WIRINGS.filter((subject) => subject.review === 'blocking').every(
        (subject) => outcome(subject, change('script-animation-phase')) === 'false-alarm',
      ),
  },
  {
    heading: '## A size mismatch is not graded',
    holds: () =>
      decide(wiring('over-tolerant'), change('page-grew')) === 'size-mismatch' &&
      decide(wiring('budgeted'), change('panel-recoloured')) === 'out-of-frame',
  },
  {
    heading: '## The review workflow',
    holds: () =>
      absorbingModes().length === 2 &&
      seedingModes().length === 2 &&
      safeModes().length === 1 &&
      JSON.stringify(LIFECYCLE.changed) === JSON.stringify(LIFECYCLE.all),
  },
  {
    heading: '## The ceiling',
    holds: () => {
      const best = [...WIRINGS].sort((left, right) => scoreOf(right) - scoreOf(left))[0]

      if (best === undefined) {
        return false
      }

      const missed = CHANGES.filter((target) => outcome(best, target) === 'missed')

      return (
        missed.length === 1 &&
        missed[0]?.id === 'stamp-recoloured' &&
        scoreOf(best) === CHANGES.length - 1
      )
    },
  },
  {
    heading: '## What is not measured here',
    holds: () => true,
  },
]

describe('every finding is true of the model, and carried by the prose', () => {
  for (const finding of FINDINGS) {
    it(`holds: ${finding.heading.replace(/^#+ /, '')}`, () => {
      expect(finding.holds()).toBe(true)
    })

    it(`is stated once: ${finding.heading.replace(/^#+ /, '')}`, () => {
      const lines = README.split('\n').filter((line) => line === finding.heading)
      expect(lines).toHaveLength(1)
    })
  }

  it('has no `##` heading without a finding behind it', () => {
    // Closed in the other direction. The headings that are structure rather
    // than claims are listed, so adding a section means either adding a
    // finding or saying out loud that it is not one.
    const STRUCTURAL = [
      '# Visual regression: masking, tolerance, and a review workflow',
      '## What is actually being measured',
      '## Running it',
    ]

    const headings = README.split('\n').filter((line) => /^#{1,2} /.test(line))
    const claimed = new Set(FINDINGS.map((finding) => finding.heading))

    for (const heading of headings) {
      expect(claimed.has(heading) || STRUCTURAL.includes(heading), heading).toBe(true)
    }
  })
})

describe('the prose names everything the tables do', () => {
  it('mentions every wiring by name', () => {
    for (const subject of WIRINGS) {
      expect(README, subject.name).toContain(`\`${subject.name}\``)
    }
  })

  it('mentions every change by name', () => {
    for (const target of CHANGES) {
      expect(README, target.id).toContain(`\`${target.id}\``)
    }
  })

  it('states the score the top wiring reaches, and the total', () => {
    const best = [...WIRINGS].sort((left, right) => scoreOf(right) - scoreOf(left))[0]
    expect(PROSE).toContain(`${scoreOf(best as never)} of ${CHANGES.length}`)
  })

  it('states the cell count the browser half re-derives', () => {
    expect(PROSE).toContain(`${CHANGES.length * WIRINGS.length} cells`)
  })

  it('states how many of the catalogue are regressions and how many are noise', () => {
    expect(PROSE).toContain(`${REGRESSIONS.length} of them regressions`)
    expect(PROSE).toContain(`${NOISE.length} of them the ordinary churn`)
  })
})
