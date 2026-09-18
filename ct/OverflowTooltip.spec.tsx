/**
 * The component test the jsdom test next door cannot be.
 *
 * Every assertion here is about a number produced by layout — `scrollWidth`
 * against `clientWidth` — and layout is the thing jsdom does not have.
 * `OverflowTooltip.jsdom.test.tsx` measures what jsdom answers instead; this
 * file is the same component asked the same questions by a browser.
 *
 * The widths are deliberately far from the boundary. Measured under the
 * `16px/1.5 monospace` `index.html` fixes, the long string below lays out at
 * 568px and the short one at 77px — so the roomy box leaves 332px of slack and
 * the cramped one is overflowed by 448px. A spec that asserted the tooltip
 * appears at exactly the width where the text stops fitting would be measuring
 * a font, and would go red on the first machine whose monospace face is a
 * little narrower.
 */

import { expect, test } from '@playwright/experimental-ct-react'
import { OverflowTooltip } from './components/OverflowTooltip'

/** 568px wide at the size `index.html` fixes. 77px for the short one. */
const LONG = 'a project name long enough to be cut off in a narrow column'
const SHORT = 'invoices'

const ROOMY = 900
const CRAMPED = 120

test('leaves text that fits its box without a tooltip', async ({ mount }) => {
  const component = await mount(<OverflowTooltip text={SHORT} width={ROOMY} />)

  // The browser's own answer first, so the assertion below is known to be
  // "measured, not clipped" rather than "measured too early".
  const box = await component.evaluate((element: HTMLElement) => ({
    content: element.scrollWidth,
    visible: element.clientWidth,
  }))

  expect(box.content).toBeLessThanOrEqual(box.visible)
  await expect(component).not.toHaveAttribute('title')
})

test('offers the whole string as a tooltip once the box clips it', async ({ mount }) => {
  const component = await mount(<OverflowTooltip text={LONG} width={CRAMPED} />)

  await expect(component).toHaveAttribute('title', LONG)

  const box = await component.evaluate((element: HTMLElement) => ({
    content: element.scrollWidth,
    visible: element.clientWidth,
  }))

  expect(box.content).toBeGreaterThan(box.visible)
})

test('shows a tooltip when its column narrows around unchanged text', async ({ mount }) => {
  const component = await mount(<OverflowTooltip text={LONG} width={ROOMY} />)

  await expect(component).not.toHaveAttribute('title')

  // Only the width changes. Nothing re-runs the effect — `text` is its single
  // dependency — so the tooltip can only appear if the `ResizeObserver` fired,
  // which is the part of this component jsdom cannot execute at all.
  await component.update(<OverflowTooltip text={LONG} width={CRAMPED} />)

  await expect(component).toHaveAttribute('title', LONG)
})

test('drops the tooltip again when its column widens', async ({ mount }) => {
  const component = await mount(<OverflowTooltip text={LONG} width={CRAMPED} />)

  await expect(component).toHaveAttribute('title', LONG)

  await component.update(<OverflowTooltip text={LONG} width={ROOMY} />)

  await expect(component).not.toHaveAttribute('title')
})

test('renders the full string in the DOM and lets CSS do the clipping', async ({ mount }) => {
  const component = await mount(<OverflowTooltip text={LONG} width={CRAMPED} />)

  // The text is not truncated in the DOM — an ellipsis painted by
  // `text-overflow` is not a character, so the accessible name and a
  // copy-paste both still carry the whole string. A component that truncated
  // the string itself would pass every assertion above and break both.
  await expect(component).toHaveText(LONG)
})
