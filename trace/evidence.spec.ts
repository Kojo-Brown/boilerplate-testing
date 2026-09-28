/**
 * Nine tests, all of which fail, on purpose, once each.
 *
 * This is the only suite in the repository whose green state is red. It is not
 * run by `pnpm test:e2e` and it is not a project of any config that CI treats as
 * a gate: `check.ts` spawns it, requires it to fail all nine, and then reads the
 * traces it left behind. A passing test here means a fault stopped reproducing
 * and the row of `README.md`'s table that depends on it is now describing
 * nothing — which `check.ts` reports as a failure of the gate.
 *
 * Each test is written the way the test that would really have this bug is
 * written: the assertion is reasonable, the locator is the one a person would
 * reach for, and nothing in the test hints at the defect. A test that
 * anticipated its own fault would put the answer in the error message and every
 * cell of the evidence table would read `cause`.
 *
 * The timeouts are short and set per assertion rather than inherited, because
 * nine failures at the config's 10s `actionTimeout` is ninety seconds of CI for
 * no extra information. They are long enough that the fault is what fails:
 * `late-content` waits five seconds for a total the assertion gives up on in
 * two, and `subject.test.ts` asserts that ordering holds so this file cannot
 * quietly start measuring a race.
 */

import { expect, test } from '@playwright/test'

import { FIXTURE_TOKEN_VAR } from './faults.ts'
import { subjectUrl } from './server.ts'
import { SAVE_LABEL, SUMMARY, TOTAL_ID } from './subject.ts'

/** Long enough for a healthy page, short enough that nine of these are quick. */
const ASSERTION_TIMEOUT = 2_000

const TOTAL = String(SUMMARY.total)

test('renamed-element', async ({ page }) => {
  await page.goto(subjectUrl('renamed-element'))
  await expect(page.locator(`#${TOTAL_ID}`)).toHaveText(TOTAL, { timeout: ASSERTION_TIMEOUT })
})

test('duplicate-label', async ({ page }) => {
  await page.goto(subjectUrl('duplicate-label'))
  await page.getByRole('button', { name: SAVE_LABEL }).click({ timeout: ASSERTION_TIMEOUT })
})

test('covered-button', async ({ page }) => {
  await page.goto(subjectUrl('covered-button'))
  await page.locator('#save').click({ timeout: ASSERTION_TIMEOUT })
})

test('late-content', async ({ page }) => {
  await page.goto(subjectUrl('late-content'))
  await expect(page.locator(`#${TOTAL_ID}`)).toHaveText(TOTAL, { timeout: ASSERTION_TIMEOUT })
})

test('failing-api', async ({ page }) => {
  await page.goto(subjectUrl('failing-api'))
  await expect(page.locator('#rows li')).toHaveCount(SUMMARY.rows.length, {
    timeout: ASSERTION_TIMEOUT,
  })
})

test('hanging-api', async ({ page }) => {
  await page.goto(subjectUrl('hanging-api'))
  await expect(page.locator('#rows li')).toHaveCount(SUMMARY.rows.length, {
    timeout: ASSERTION_TIMEOUT,
  })
})

test('throwing-script', async ({ page }) => {
  await page.goto(subjectUrl('throwing-script'))
  await expect(page.locator(`#${TOTAL_ID}`)).toHaveText(TOTAL, { timeout: ASSERTION_TIMEOUT })
})

test('missing-env', async ({ page }) => {
  // Before the page, on purpose: the fault is that the run had no token, and a
  // navigation first would put a document request in the network channel and
  // make this row look like the others. `page` is destructured so the fixture
  // still runs and the trace is still written — the row is about a trace that
  // exists and says nothing, not about a missing trace.
  const token = process.env[FIXTURE_TOKEN_VAR]

  if (token === undefined || token === '') {
    throw new Error(`${FIXTURE_TOKEN_VAR} is not set`)
  }

  await page.goto(subjectUrl('none'))
})
