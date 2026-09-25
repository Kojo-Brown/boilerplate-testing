/**
 * The two phases, as two functions.
 *
 * ---------------------------------------------------------------------------
 * Why this is not `toHaveScreenshot`
 * ---------------------------------------------------------------------------
 * `toHaveScreenshot` is capture and comparison fused, plus a retry loop: it
 * screenshots the page, compares, and if the comparison fails it screenshots
 * again until it passes or the expect timeout runs out. All three are right
 * for a real suite — the retry is what makes a screenshot of a settling page
 * stable — and all three are wrong for a measurement.
 *
 * Fusing them means nine wirings would take nine screenshots of each revision
 * where four distinct capture configurations exist, and it would make a cell
 * that differs only in `threshold` depend on a second trip through the
 * renderer. The retry means every cell whose honest answer is "different"
 * costs the expect timeout, and — worse — that the answer is "different for
 * as long as we were willing to wait" rather than "different".
 *
 * So `captureWith` runs the capture phase through `page.screenshot`, which
 * takes exactly the capture half of `toHaveScreenshot`'s options bag and
 * nothing else, and `compareWith` runs the comparison phase through
 * `toMatchSnapshot`, which is the same image comparator reading the same
 * `threshold` and `maxDiffPixels`. What is lost is the retry, and the fixture
 * is built so that nothing needs one: the page has no network, no timer and no
 * unpaused animation, and `waitForPainted` below waits for the one frame the
 * scripted progress bar needs rather than for a duration.
 */

import { expect, type Locator, type Page } from '@playwright/test'

import { MASK_SELECTOR } from './subject.ts'
import type { CaptureControls, CompareControls } from './wirings.ts'

/** What one comparison answered. */
export interface Comparison {
  /** Whether the comparator reported a difference at all. */
  readonly flagged: boolean
  /**
   * Why, when it did.
   *
   *   - `pixels` — counted pixels exceeded the budget.
   *   - `size`   — the two images are different sizes, which the comparator
   *                rejects before consulting either tolerance.
   */
  readonly reason: 'none' | 'pixels' | 'size'
  /**
   * How many pixels the comparator counted, when it said.
   *
   * `null` for a comparison that passed (the comparator does not report a
   * count it was happy with) and for a size mismatch (there is nothing to
   * count). Read out of the failure message rather than computed here, for
   * the reason `compareWith` gives: the number that matters is the one
   * Playwright arrived at.
   *
   * Nothing in the matrix asserts on this. `matrix.spec.ts` uses it for one
   * thing only — checking that the bands in `changes.ts` have room — because
   * a count is a property of the machine and a band is supposed not to be.
   */
  readonly pixels: number | null
}

/**
 * Wait for the fixture to be finished painting.
 *
 * One attribute, set by the same `requestAnimationFrame` callback that writes
 * the progress bar's width — so this waits for the state the assertion is
 * about, not for a number of milliseconds. `a11y/page.ts` makes the same move
 * for the same reason: a fixture gated on a timer turns `retries: 0` into a
 * lie.
 */
export async function waitForPainted(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset['painted'] === '1')
}

function maskLocators(page: Page, controls: CaptureControls): Locator[] {
  return controls.mask ? [page.locator(MASK_SELECTOR)] : []
}

/**
 * Take the screenshot one capture configuration asks for.
 *
 * `fullPage` is spread conditionally rather than passed as `fullPage: false`
 * for readability, not for types — but `maskColor` is deliberately *not* set:
 * the default is `#FF00FF`, and leaving it alone is what makes
 * `stamp-enlarged` measurable. A mask painted in the page's own background
 * colour would hide a resize as well as a recolour, and the table would lose
 * its sharpest row. See visual/README.md.
 */
export async function captureWith(page: Page, controls: CaptureControls): Promise<Buffer> {
  return page.screenshot({
    animations: controls.animations,
    mask: maskLocators(page, controls),
    ...(controls.scope === 'full-page' ? { fullPage: true } : {}),
  })
}

/**
 * Grade a capture against a baseline written to `snapshotName`.
 *
 * A failing comparison is data rather than a failure — the whole point is
 * which wirings report a difference — so the assertion is caught. It is a
 * real `expect`, not a hand-rolled diff: everything this directory claims
 * about `threshold` and `maxDiffPixels` is a claim about Playwright's
 * comparator, and reimplementing it would turn the measurement into a
 * restatement of what I believed it did.
 */
export function compareWith(
  actual: Buffer,
  snapshotName: string,
  controls: CompareControls,
): Comparison {
  try {
    expect(actual).toMatchSnapshot(snapshotName, {
      threshold: controls.threshold,
      maxDiffPixels: controls.maxDiffPixels,
    })

    return { flagged: false, reason: 'none', pixels: null }
  } catch (error) {
    const message = (error as Error).message

    if (message.includes('Expected an image')) {
      return { flagged: true, reason: 'size', pixels: null }
    }

    const counted = /(\d+) pixels \(ratio/.exec(message)

    return {
      flagged: true,
      reason: 'pixels',
      pixels: counted === null ? null : Number(counted[1]),
    }
  }
}
