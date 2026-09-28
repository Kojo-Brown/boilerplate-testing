/**
 * Three tests: one that passes, one that always fails, one that fails its first
 * attempt and passes its second.
 *
 * `check.ts` runs this file once per `trace` mode with `retries: 1` and then
 * looks on disk for what survived. Nothing here asserts anything about tracing —
 * the suite's job is to produce the three outcomes a CI run actually contains,
 * as cheaply as possible, so that the question "will the artefact be there when
 * I go looking" can be answered by `readdir` rather than by reading Playwright's
 * changelog.
 *
 * The flake is deterministic: `testInfo.retry` is 0 on the first attempt and 1 on
 * the second, so `flaky` fails once and passes once, every run, on every machine.
 * A real flake would be a race, and a fixture built on one would make the
 * retention table a coin toss.
 *
 * Every test navigates, because a mode can only retain what it recorded and a
 * test that never touched the page would leave a trace that is empty either way.
 */

import { expect, test } from '@playwright/test'

import { subjectUrl } from '../server.ts'
import { SUMMARY, TOTAL_ID } from '../subject.ts'

const TOTAL = String(SUMMARY.total)

test('passing', async ({ page }) => {
  await page.goto(subjectUrl('none'))
  await expect(page.locator(`#${TOTAL_ID}`)).toHaveText(TOTAL, { timeout: 5_000 })
})

test('failing', async ({ page }) => {
  await page.goto(subjectUrl('renamed-element'))
  await expect(page.locator(`#${TOTAL_ID}`)).toHaveText(TOTAL, { timeout: 2_000 })
})

test('flaky', async ({ page }, testInfo) => {
  await page.goto(subjectUrl(testInfo.retry === 0 ? 'renamed-element' : 'none'))
  await expect(page.locator(`#${TOTAL_ID}`)).toHaveText(TOTAL, { timeout: 2_000 })
})
