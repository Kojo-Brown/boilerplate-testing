import { test as base, expect, type Page, type Locator } from '@playwright/test'

export interface VisualFixtures {
  /**
   * Takes a full-page screenshot and compares it to the stored snapshot.
   * Dynamic regions (timestamps, avatars, random IDs) are masked before capture.
   */
  takePageSnapshot: (name: string, options?: PageSnapshotOptions) => Promise<void>
  /**
   * Takes an element screenshot and compares it to the stored snapshot.
   */
  takeElementSnapshot: (locator: Locator, name: string, options?: ElementSnapshotOptions) => Promise<void>
  /**
   * Sets the page into a stable state by stopping animations and hiding
   * dynamic content that would cause spurious snapshot diffs.
   */
  freezePage: () => Promise<void>
}

export interface PageSnapshotOptions {
  /** Additional CSS selectors to mask (filled with a solid box before capture). */
  mask?: string[]
  /** Pixel-level diff threshold per pixel (0–1). Defaults to 0.2. */
  threshold?: number
  /** Maximum number of pixels that may differ. Defaults to 50. */
  maxDiffPixels?: number
  /** Clip to a specific region instead of the full page. */
  clip?: { x: number; y: number; width: number; height: number }
  /** Whether to capture the full scrollable page. Defaults to false. */
  fullPage?: boolean
  /** Animations behaviour: 'disabled' (default) | 'allow'. */
  animations?: 'disabled' | 'allow'
}

export interface ElementSnapshotOptions {
  /** Pixel-level diff threshold per pixel (0–1). Defaults to 0.2. */
  threshold?: number
  /** Maximum number of pixels that may differ. Defaults to 50. */
  maxDiffPixels?: number
  /** Animations behaviour: 'disabled' (default) | 'allow'. */
  animations?: 'disabled' | 'allow'
}

/**
 * Selectors that often contain dynamic or time-varying content.
 * Mask these by default so snapshots remain stable across runs.
 */
const DEFAULT_DYNAMIC_SELECTORS = [
  '[data-testid*="timestamp"]',
  '[data-testid*="date"]',
  '[data-testid*="time"]',
  '[data-testid*="avatar"]',
  '[aria-label*="ago"]',
  'time',
  '[data-dynamic]',
]

export const test = base.extend<VisualFixtures>({
  freezePage: async ({ page }, use) => {
    const freeze = async (): Promise<void> => {
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
            caret-color: transparent !important;
          }
        `,
      })
      // Freeze scrollbars so their width doesn't vary across environments.
      await page.evaluate(() => {
        document.documentElement.style.setProperty('overflow', 'hidden', 'important')
      })
    }
    await use(freeze)
  },

  takePageSnapshot: async ({ page, freezePage }, use) => {
    const snapshot = async (name: string, options: PageSnapshotOptions = {}): Promise<void> => {
      const {
        mask: extraMask = [],
        threshold = 0.2,
        maxDiffPixels = 50,
        clip,
        fullPage = false,
        animations = 'disabled',
      } = options

      await freezePage()

      const maskSelectors = [...DEFAULT_DYNAMIC_SELECTORS, ...extraMask]
      const maskLocators = maskSelectors.map((sel) => page.locator(sel))

      await expect(page).toHaveScreenshot(`${name}.png`, {
        threshold,
        maxDiffPixels,
        fullPage,
        clip,
        animations,
        mask: maskLocators,
      })
    }
    await use(snapshot)
  },

  takeElementSnapshot: async ({ page, freezePage }, use) => {
    const snapshot = async (
      locator: Locator,
      name: string,
      options: ElementSnapshotOptions = {},
    ): Promise<void> => {
      const { threshold = 0.2, maxDiffPixels = 50, animations = 'disabled' } = options

      await freezePage()
      await expect(locator).toHaveScreenshot(`${name}.png`, {
        threshold,
        maxDiffPixels,
        animations,
      })
    }
    await use(snapshot)
  },
})

export { expect }

/**
 * Render a self-contained HTML page inside the Playwright browser.
 * Useful for component-level visual regression without a running dev server.
 */
export async function renderHtml(page: Page, html: string): Promise<void> {
  await page.setContent(html, { waitUntil: 'networkidle' })
}

/**
 * Apply a color-scheme to the page, emulating dark or light mode.
 */
export async function setColorScheme(
  page: Page,
  scheme: 'dark' | 'light',
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme })
}
