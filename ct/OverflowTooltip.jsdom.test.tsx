/**
 * The same component, in jsdom, for the sake of the comparison.
 *
 * This file is not here to test `OverflowTooltip` — it cannot. It is here to
 * *measure* what jsdom answers when asked, so that `ct/README.md`'s claim
 * ("some behaviour is undecidable without a layout engine") is a recorded
 * result rather than an opinion, and so that it fails if a future jsdom
 * implements layout and the claim stops being true.
 *
 * Two answers, both wrong in the same direction — the component looks fine:
 *
 *   1. `ResizeObserver` is not defined at all, so the component throws on
 *      mount. Supplying a stub is the usual response, and the stub is then
 *      part of what the test measures.
 *   2. With the stub in place, every box is 0 wide, so `scrollWidth >
 *      clientWidth` is false for every input and the tooltip never appears.
 *      A jsdom suite asserting "no tooltip for short text" therefore passes
 *      for a component that has no logic in it at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OverflowTooltip } from './components/OverflowTooltip'

const LONG = 'a project name long enough to be cut off in a narrow column'

/** The stub a jsdom suite has to supply. It observes nothing and reports nothing. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const withResizeObserver = (): void => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OverflowTooltip under jsdom', () => {
  it('throws on mount, because jsdom defines no ResizeObserver', () => {
    // Not a criticism of jsdom: it implements the DOM, and `ResizeObserver`
    // reports box sizes, which is layout. The point is that the omission is
    // load-bearing — this component cannot even be rendered here.
    expect(() => render(<OverflowTooltip text={LONG} width={120} />)).toThrow(
      /ResizeObserver is not defined/,
    )
  })

  it('reports every box as zero wide, whatever the CSS says', () => {
    withResizeObserver()

    render(<OverflowTooltip text={LONG} width={120} />)

    const cell = screen.getByText(LONG)

    // The style is on the element, and the element has no size: jsdom parses
    // CSS and stores it, and stops there.
    expect(cell).toHaveStyle({ width: '120px' })
    expect(cell.scrollWidth).toBe(0)
    expect(cell.clientWidth).toBe(0)
  })

  it('offers no tooltip for text that a browser clips by 448 pixels', () => {
    withResizeObserver()

    render(<OverflowTooltip text={LONG} width={120} />)

    // The browser's answer to this exact case is in `OverflowTooltip.spec.tsx`:
    // 568px of text in a 120px box, and a `title` carrying the whole string.
    // Here the condition is `0 > 0`, and the assertion below is the reason a
    // green jsdom suite is not evidence about this component.
    expect(screen.getByText(LONG)).not.toHaveAttribute('title')
  })

  it('answers identically for text that obviously fits, so the two cases are indistinguishable', () => {
    withResizeObserver()

    render(<OverflowTooltip text="invoices" width={900} />)

    expect(screen.getByText('invoices')).not.toHaveAttribute('title')
  })
})
