// @vitest-environment node
//
// The catalogue's five declared fields are the model's only inputs, so each
// one is a claim about the fixture rather than a description of it. This file
// audits them against the generated HTML, without a browser — which is the
// half of the work a renderer could not check anyway: whether the *baseline*
// render and the *variant* render differ in the one place the entry names.

import { describe, expect, it } from 'vitest'

import { CHANGES, NOISE, REGRESSIONS } from './changes.ts'
import {
  BASELINE_NONCE,
  DYNAMIC_ATTRIBUTE,
  GROWTH_PX,
  MASK_SELECTOR,
  VARIANT_NONCE,
  VIEWPORT,
  render,
  revisions,
} from './subject.ts'
import { startSubject, subjectUrl } from './server.ts'

const baseline = (nonce = BASELINE_NONCE): string => render({ change: null, nonce })
const variant = (id: string, nonce = VARIANT_NONCE): string => render({ change: id, nonce })

describe('the fixture', () => {
  it('renders something different for every change in the catalogue', () => {
    for (const entry of CHANGES) {
      expect(variant(entry.id), entry.id).not.toBe(baseline())
    }
  })

  it('refuses a revision it does not have', () => {
    // A typo in a spec has to be a failure. Falling back to the baseline would
    // report `same` for every cell that used it, and a wiring whose whole row
    // reads `clean` looks like a wiring that works.
    expect(() => render({ change: 'brand-drift', nonce: 0 })).toThrow(/no change named/)
    expect(revisions()).toHaveLength(CHANGES.length + 1)
    expect(revisions()[0]).toBeNull()
  })

  it('holds every region still except the one under test', () => {
    // The controlled-experiment claim, and the reason a flagged cell is
    // attributable. A regression must render identically at either nonce: if
    // it did not, its row would be measuring the varying region as well.
    for (const entry of REGRESSIONS) {
      expect(variant(entry.id, BASELINE_NONCE), entry.id).toBe(variant(entry.id, VARIANT_NONCE))
    }

    // …and every noise entry must render *differently* at the two nonces,
    // because that difference is the whole of what it is.
    for (const entry of NOISE) {
      expect(variant(entry.id, BASELINE_NONCE), entry.id).not.toBe(variant(entry.id, VARIANT_NONCE))
    }
  })

  it('leaves the baseline itself unmoved by the nonce', () => {
    // If it did not, every cell would be comparing two different pages before
    // the mutation was applied.
    expect(baseline(BASELINE_NONCE)).toBe(baseline(VARIANT_NONCE))
  })

  it('carries exactly two dynamic regions for a mask to select', () => {
    const matches = baseline().match(new RegExp(DYNAMIC_ATTRIBUTE, 'g')) ?? []

    // Two elements, plus the two occurrences inside the selector constant
    // are not in the HTML — so this counts elements.
    expect(matches).toHaveLength(2)
    expect(MASK_SELECTOR).toBe(`[${DYNAMIC_ATTRIBUTE}]`)
  })
})

describe('the declared properties', () => {
  it('puts every `inside` and `resizes` change on a dynamic region', () => {
    for (const entry of CHANGES.filter((candidate) => candidate.mask !== 'outside')) {
      // The stamp and the avatar are the two masked elements; every entry
      // claiming a mask relation has to name one of them.
      expect(entry.id, entry.id).toMatch(/^(stamp|avatar)/)
    }
  })

  it('puts every `outside` change somewhere a mask does not reach', () => {
    for (const entry of CHANGES.filter((candidate) => candidate.mask === 'outside')) {
      expect(entry.id, entry.id).not.toMatch(/^(stamp|avatar)/)
    }
  })

  it('changes only the document’s height for `page-height`, by the declared amount', () => {
    const grown = CHANGES.filter((entry) => entry.region === 'page-height')
    expect(grown.map((entry) => entry.id)).toEqual(['page-grew'])

    expect(variant('page-grew')).toContain(`height:${GROWTH_PX}px`)
    expect(baseline()).not.toContain(`height:${GROWTH_PX}px`)
  })

  it('touches an animation delay for every `css` motion change and no other', () => {
    for (const entry of CHANGES) {
      const movesDelay = variant(entry.id).includes('animation-delay: -1500ms')
      expect(movesDelay, entry.id).toBe(entry.motion === 'css')
    }

    expect(baseline()).toContain('animation-delay: -0ms')
  })

  it('touches the scripted width for every `script` motion change and no other', () => {
    for (const entry of CHANGES) {
      const movesWidth = variant(entry.id).includes('data-width="240"')
      expect(movesWidth, entry.id).toBe(entry.motion === 'script')
    }

    expect(baseline()).toContain('data-width="40"')
  })

  it('drives the scripted width from a rAF callback, not from the engine', () => {
    // The `script-animation-phase` finding rests on this and nothing else: if
    // the width were an inline style or a CSS animation, `animations:
    // 'disabled'` would reach it and the row would be about the fixture.
    expect(baseline()).toContain('requestAnimationFrame')
    expect(baseline()).toMatch(/style\.width\s*=/)
  })

  it('positions the stamp absolutely, so enlarging it reflows nothing', () => {
    // Without this, `stamp-enlarged` would push the whole page down and every
    // wiring would flag it — and the table would report that masking catches a
    // resize when what it caught was a reflow.
    expect(baseline()).toMatch(/\.stamp\s*\{[^}]*position:\s*absolute/)
    expect(baseline()).toMatch(/\.head\s*\{[^}]*height:\s*56px/)
  })
})

describe('the server', () => {
  it('builds a URL per revision, with the baseline carrying no change', () => {
    expect(subjectUrl(null)).toMatch(/\?nonce=0$/)
    expect(subjectUrl('brand-shade', 1)).toContain('change=brand-shade')
    expect(subjectUrl('brand-shade', 1)).toContain('nonce=1')
  })

  it('serves the document, and refuses a revision it does not have', async () => {
    // A port, because a 400 for an unknown revision is the binding's
    // behaviour rather than `render`'s, and answering it with the baseline is
    // exactly the failure `render` throwing is there to prevent.
    const port = 3_213
    const server = await startSubject(port)

    try {
      const ok = await fetch(`http://127.0.0.1:${port}/?change=brand-shade&nonce=1`)
      expect(ok.status).toBe(200)
      expect(ok.headers.get('cache-control')).toBe('no-store')
      expect(await ok.text()).toContain(`width: ${VIEWPORT.width}px`)

      const bad = await fetch(`http://127.0.0.1:${port}/?change=nope`)
      expect(bad.status).toBe(400)
      expect(await bad.text()).toMatch(/no change named nope/)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
