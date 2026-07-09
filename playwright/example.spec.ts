import { test, expect } from '@playwright/test'

/**
 * Demonstrates the Playwright config: multi-browser, CI mode, and trace on failure.
 *
 * These tests run against all browsers defined in playwright.config.ts.
 * Traces are captured on failure; in CI, retries are enabled automatically.
 *
 * Run a single project:
 *   pnpm test:e2e --project=chromium
 *
 * Run with traces always on:
 *   pnpm test:e2e --trace on
 */

test.describe('Playwright config smoke tests', () => {
  test('page loads and has a valid title', async ({ page }) => {
    await page.goto('/')
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
  })

  test('navigation to a non-existent route returns a page', async ({ page }) => {
    const response = await page.goto('/non-existent-path')
    // The app handles 404 client-side; the HTTP response is always 200 for SPAs
    expect(response?.status()).toBeLessThan(500)
  })

  test('viewport is set correctly for the device', async ({ page, viewport }) => {
    if (viewport) {
      expect(viewport.width).toBeGreaterThan(0)
      expect(viewport.height).toBeGreaterThan(0)
    }
    await page.goto('/')
    // Confirm the page body renders at the expected width
    const bodyWidth = await page.evaluate(() => document.body.clientWidth)
    expect(bodyWidth).toBeGreaterThan(0)
  })

  test('trace artifact is produced on failure (intentionally fails in dev)', async ({ page }) => {
    // This test is skipped by default. Un-skip to verify that a trace zip
    // appears under playwright-results/ after a failure.
    test.skip(true, 'Un-skip to confirm trace capture works')
    await page.goto('/')
    await expect(page.locator('[data-testid="does-not-exist"]')).toBeVisible()
  })
})
