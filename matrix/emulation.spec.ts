/**
 * The forty-five cells of `emulation.ts`, checked against a real Chromium.
 *
 * One test per cell rather than one per condition: a run that disagrees with
 * the table should name the probe in its title, because the probe is the
 * finding. The project name selects the row — the config gives each condition
 * a project of the same name — so this file never constructs a context of its
 * own and what it measures is exactly what a reader's own `use` block would do.
 */

import { expect, test, type Page } from '@playwright/test'

import { CONDITION_NAMES, type ConditionName } from './conditions.ts'
import { EMULATION } from './emulation.ts'
import { PROBES } from './probes.ts'

function conditionOf(name: string): ConditionName {
  const condition = CONDITION_NAMES.find((candidate) => candidate === name)

  if (!condition) {
    throw new Error(`project ${name} is not one of the measured conditions`)
  }

  return condition
}

async function open(page: Page): Promise<void> {
  await page.goto('/')
}

for (const probe of PROBES) {
  test(`${probe.name} — ${probe.asks}`, async ({ page }, testInfo) => {
    await open(page)

    const expected = EMULATION[conditionOf(testInfo.project.name)].probes[probe.name]

    expect(await page.evaluate(probe.run)).toBe(expected)
  })
}

test('tap — whether Playwright will dispatch a touch at all', async ({ page }, testInfo) => {
  await open(page)

  const row = EMULATION[conditionOf(testInfo.project.name)]

  if (row.tap === 'tapped') {
    await page.tap('#target')
    await expect(page.locator('#taps')).toHaveText('1')

    return
  }

  // Not a soft assertion: `tap()` on a context without `hasTouch` is a
  // Playwright error rather than a failed interaction, and the message is the
  // measurement — a resize-only project cannot express a tap, so a suite that
  // wants one has to opt into emulation somewhere.
  await expect(page.tap('#target')).rejects.toThrow(/hasTouch/)
  await expect(page.locator('#taps')).toHaveText('0')
})

test('pointerType — what the page sees when the tap target is activated', async ({
  page,
}, testInfo) => {
  await open(page)

  const row = EMULATION[conditionOf(testInfo.project.name)]

  if (row.pointerType === 'none') {
    // Nothing has been activated yet, and on a condition with no touch the
    // only way to activate it is a mouse — which is the answer the desktop
    // and narrow rows already record.
    await expect(page.locator('#taps')).toHaveText('0')

    return
  }

  await page.tap('#target')

  await expect(page.locator('#taps')).toHaveAttribute('data-pointer-type', row.pointerType)
})
