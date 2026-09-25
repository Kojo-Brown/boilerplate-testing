// @vitest-environment node
//
// The model, without a browser. What `decide` predicts is checked against
// Chromium by `matrix.spec.ts`; what is checked here is that the model is the
// shape it claims to be — adjacent rows, a closed vocabulary, and the specific
// comparisons the README makes in prose.

import { describe, expect, it } from 'vitest'

import { CHANGES, NOISE, REGRESSIONS, change } from './changes.ts'
import {
  DECISIONS,
  GOOD_OUTCOMES,
  OUTCOMES,
  PIXEL_BUDGET,
  REVIEWS,
  REVIEW_POLICIES,
  WIRINGS,
  WIRING_NAMES,
  captureConfigurations,
  captureSignature,
  consultsBudget,
  decide,
  flags,
  outcome,
  renderMatrix,
  scoreOf,
  wiring,
  type Wiring,
} from './wirings.ts'

/** The four controls adjacency is measured over. */
function controlsOf(subject: Wiring): Record<string, string> {
  return {
    scope: subject.capture.scope,
    mask: String(subject.capture.mask),
    animations: subject.capture.animations,
    threshold: String(subject.compare.threshold),
    maxDiffPixels: String(subject.compare.maxDiffPixels),
    review: subject.review,
  }
}

function differences(left: Wiring, right: Wiring): string[] {
  const a = controlsOf(left)
  const b = controlsOf(right)

  return Object.keys(a).filter((key) => a[key] !== b[key])
}

/** The changes on which two wirings disagree. */
function disagreements(left: Wiring, right: Wiring): string[] {
  return CHANGES.filter((target) => flags(left, target) !== flags(right, target)).map(
    (target) => target.id,
  )
}

describe('the ladder', () => {
  it('gives every wiring but the first exactly one control of difference', () => {
    for (const subject of WIRINGS) {
      if (subject.derivedFrom === null) {
        continue
      }

      expect(differences(wiring(subject.derivedFrom), subject), subject.name).toHaveLength(1)
    }
  })

  it('starts from exactly one wiring and never points forward', () => {
    const roots = WIRINGS.filter((subject) => subject.derivedFrom === null)
    expect(roots.map((subject) => subject.name)).toEqual(['naive'])

    // A `derivedFrom` pointing at a later row would make "one control from the
    // row above" unreadable as a ladder, and would let a cycle through.
    for (const [index, subject] of WIRINGS.entries()) {
      if (subject.derivedFrom === null) {
        continue
      }

      const parent = WIRINGS.findIndex((candidate) => candidate.name === subject.derivedFrom)
      expect(parent, subject.name).toBeGreaterThanOrEqual(0)
      expect(parent, subject.name).toBeLessThan(index)
    }
  })

  it('has unique names, and rejects one it does not have', () => {
    expect(new Set(WIRING_NAMES).size).toBe(WIRINGS.length)
    expect(() => wiring('masked-tuned')).toThrow(/no wiring named masked-tuned/)
    expect(() => change('brand-drift')).toThrow(/no change named brand-drift/)
  })

  it('shares four capture configurations between nine wirings', () => {
    // The capture/comparison split as a saving rather than as an argument:
    // five of the nine differ from another only in how the images are graded,
    // so the browser is asked four times per revision instead of nine.
    const configurations = captureConfigurations()
    expect(configurations).toHaveLength(4)

    const signatures = new Set(WIRINGS.map((subject) => captureSignature(subject.capture)))
    expect(signatures.size).toBe(configurations.length)
  })
})

describe('what each control is worth', () => {
  it('buys `frozen` exactly the CSS animation over `naive`', () => {
    expect(disagreements(wiring('naive'), wiring('frozen'))).toEqual(['css-animation-phase'])
  })

  it('costs `playwright-default` two colour regressions over `frozen`', () => {
    // The headline. Turning on Playwright's own default threshold is the one
    // step down this ladder that makes the suite see *less*, and what it stops
    // seeing is the brand bar moving a step along its ramp. Only two here, not
    // three, because `panel-recoloured` is below the fold and neither of these
    // two viewport wirings ever framed it — the same threshold costs a third
    // regression the moment the capture is widened. See `over-tolerant`.
    expect(disagreements(wiring('frozen'), wiring('playwright-default'))).toEqual([
      'brand-shade',
      'brand-hairline',
    ])

    for (const id of ['brand-shade', 'brand-hairline']) {
      expect(decide(wiring('playwright-default'), change(id)), id).toBe('below-threshold')
    }
  })

  it('buys `masked` two noise cells and costs it a defect', () => {
    const moved = disagreements(wiring('frozen'), wiring('masked'))
    expect(moved).toEqual(['stamp-recoloured', 'stamp-text', 'avatar-tint'])

    // Two of the three are the point of masking and the third is its price:
    // the mask cannot tell the clock in the header from the header breaking.
    expect(decide(wiring('masked'), change('stamp-recoloured'))).toBe('masked-out')
    expect(decide(wiring('masked'), change('stamp-text'))).toBe('masked-out')
  })

  it('buys `budgeted` exactly the sub-pixel jitter over `masked`', () => {
    expect(disagreements(wiring('masked'), wiring('budgeted'))).toEqual(['subpixel-jitter'])
    expect(decide(wiring('budgeted'), change('subpixel-jitter'))).toBe('within-budget')
  })

  it('buys `whole-page` the two changes a viewport never framed', () => {
    expect(disagreements(wiring('budgeted'), wiring('whole-page'))).toEqual([
      'panel-recoloured',
      'page-grew',
    ])

    for (const id of ['panel-recoloured', 'page-grew']) {
      expect(decide(wiring('budgeted'), change(id))).toBe('out-of-frame')
    }
  })

  it('costs `over-tolerant` three regressions and quietens nothing', () => {
    // The move a team makes when the suite is noisy: raise the friendly-sounding
    // knob. It buys *no* noise cell — the wiring it came from was already clean
    // on four of the five — and pays three regressions for it.
    const moved = disagreements(wiring('whole-page'), wiring('over-tolerant'))
    expect(moved).toEqual(['brand-shade', 'brand-hairline', 'panel-recoloured'])

    for (const id of moved) {
      expect(change(id).kind).toBe('regression')
    }
  })

  it('leaves `page-grew` to `over-tolerant` anyway, because size is not graded', () => {
    expect(decide(wiring('over-tolerant'), change('page-grew'))).toBe('size-mismatch')
    expect(flags(wiring('over-tolerant'), change('page-grew'))).toBe(true)
  })
})

describe('the review layer', () => {
  it('changes no cell of the comparison, only what the cell is worth', () => {
    // `auto-updated` and `reviewed` are `whole-page` with one field moved, and
    // the field is not one the comparator reads. Every difference between the
    // three rows is a difference in `outcome`, never in `flags`.
    for (const name of ['auto-updated', 'reviewed']) {
      expect(disagreements(wiring('whole-page'), wiring(name)), name).toEqual([])
    }
  })

  it('turns every regression `auto-updated` finds into one nothing can find again', () => {
    for (const target of REGRESSIONS) {
      const result = outcome(wiring('auto-updated'), target)
      expect(result === 'absorbed' || result === 'missed', target.id).toBe(true)
    }

    expect(REGRESSIONS.filter((target) => outcome(wiring('auto-updated'), target) === 'caught'))
      .toHaveLength(0)
  })

  it('leaves `auto-updated` scoring no better than Playwright’s own defaults', () => {
    // Two rows that look nothing alike: one is the configuration you get for
    // free, the other is a job that rewrites its own reference on every run.
    // They are worth the same.
    expect(scoreOf(wiring('auto-updated'))).toBe(scoreOf(wiring('playwright-default')))
  })

  it('buys `reviewed` exactly the noise cells `whole-page` still flags', () => {
    const triaged = CHANGES.filter((target) => outcome(wiring('reviewed'), target) === 'triaged')
    const falseAlarms = CHANGES.filter(
      (target) => outcome(wiring('whole-page'), target) === 'false-alarm',
    )

    expect(triaged.map((target) => target.id)).toEqual(falseAlarms.map((target) => target.id))
    expect(triaged.length).toBeGreaterThan(0)
  })

  it('tops the table with `reviewed`, and it still misses one', () => {
    const best = [...WIRINGS].sort((left, right) => scoreOf(right) - scoreOf(left))[0] as Wiring
    expect(best.name).toBe('reviewed')

    // Not a rounding error: the one it misses is the defect masking created,
    // and no wiring in this table fixes it. See README.md, "The ceiling".
    const missed = CHANGES.filter((target) => outcome(best, target) === 'missed')
    expect(missed.map((target) => target.id)).toEqual(['stamp-recoloured'])
    expect(decide(best, change('stamp-recoloured'))).toBe('masked-out')
  })

  it('documents a policy for every review setting and no others', () => {
    expect(Object.keys(REVIEW_POLICIES).sort()).toEqual([...REVIEWS].sort())
    expect(new Set(WIRINGS.map((subject) => subject.review))).toEqual(new Set(REVIEWS))
  })
})

describe('the vocabularies are closed', () => {
  it('reaches every decision at least once', () => {
    const reached = new Set(CHANGES.flatMap((target) => WIRINGS.map((s) => decide(s, target))))
    expect([...reached].sort()).toEqual([...DECISIONS].sort())
  })

  it('reaches every outcome at least once', () => {
    const reached = new Set(CHANGES.flatMap((target) => WIRINGS.map((s) => outcome(s, target))))
    expect([...reached].sort()).toEqual([...OUTCOMES].sort())
  })

  it('scores a wiring as the count of its good outcomes', () => {
    for (const subject of WIRINGS) {
      const good = CHANGES.filter((target) => GOOD_OUTCOMES.includes(outcome(subject, target)))
      expect(scoreOf(subject), subject.name).toBe(good.length)
      expect(scoreOf(subject)).toBeLessThanOrEqual(CHANGES.length)
    }
  })

  it('reads a regression’s outcome from `flags` and the review, and nothing else', () => {
    for (const target of REGRESSIONS) {
      for (const subject of WIRINGS) {
        const flagged = flags(subject, target)
        const result = outcome(subject, target)

        if (!flagged) {
          expect(result, `${subject.name}/${target.id}`).toBe('missed')
        } else {
          expect(result, `${subject.name}/${target.id}`).toBe(
            subject.review === 'auto-update' ? 'absorbed' : 'caught',
          )
        }
      }
    }
  })

  it('never calls a noise cell `caught` or a regression `clean`', () => {
    for (const subject of WIRINGS) {
      for (const target of NOISE) {
        expect(['clean', 'triaged', 'false-alarm']).toContain(outcome(subject, target))
      }

      for (const target of REGRESSIONS) {
        expect(['caught', 'missed', 'absorbed']).toContain(outcome(subject, target))
      }
    }
  })
})

describe('consultsBudget', () => {
  it('is false wherever the budget is zero, whatever the decision', () => {
    for (const subject of WIRINGS.filter((entry) => entry.compare.maxDiffPixels === 0)) {
      for (const target of CHANGES) {
        expect(consultsBudget(subject, target), `${subject.name}/${target.id}`).toBe(false)
      }
    }
  })

  it('is false wherever an earlier mechanism already decided the cell', () => {
    const earlier = ['size-mismatch', 'out-of-frame', 'masked-out', 'animation-settled', 'below-threshold']

    for (const subject of WIRINGS) {
      for (const target of CHANGES) {
        if (earlier.includes(decide(subject, target))) {
          expect(consultsBudget(subject, target), `${subject.name}/${target.id}`).toBe(false)
        }
      }
    }
  })

  it('reaches at least one cell of each area band, so both bands are measured', () => {
    const banded = new Set(
      CHANGES.filter((target) => WIRINGS.some((subject) => consultsBudget(subject, target))).map(
        (target) => target.area,
      ),
    )

    expect([...banded].sort()).toEqual(['over-budget', 'under-budget'])
  })
})

describe('rendering', () => {
  it('prints one matrix row per change and one column per wiring', () => {
    const rows = renderMatrix().split('\n')

    expect(rows).toHaveLength(CHANGES.length + 2)

    for (const subject of WIRINGS) {
      expect(rows[0]).toContain(`\`${subject.name}\``)
    }
  })

  it('states the budget the tuned wirings spend', () => {
    expect(PIXEL_BUDGET).toBe(4_000)

    for (const name of ['budgeted', 'whole-page', 'over-tolerant', 'auto-updated', 'reviewed']) {
      expect(wiring(name).compare.maxDiffPixels, name).toBe(PIXEL_BUDGET)
    }
  })
})
