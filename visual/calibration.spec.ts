/**
 * What `threshold` actually is, measured on flat colour.
 *
 * ---------------------------------------------------------------------------
 * Why this suite exists separately from the matrix
 * ---------------------------------------------------------------------------
 * `changes.ts` bands three of its entries by the lowest threshold at which
 * they survive, and `wirings.ts` predicts eleven cells from those bands. A
 * band is only worth anything if it was measured, and it cannot be measured on
 * the fixture itself: every region there has edges, and an edge means
 * anti-aliased pixels whose delta is a function of the hinting rather than of
 * the colour. So the calibration runs on 200×100 rectangles of flat colour,
 * where the delta per pixel is exactly the delta between two hex values and
 * the count is exactly the area.
 *
 * ---------------------------------------------------------------------------
 * The one number a reader should take away
 * ---------------------------------------------------------------------------
 * `threshold: 0.2` is Playwright's default and it is not, as it reads, a
 * little slack for anti-aliasing. It is a YIQ colour distance, and on a flat
 * fill it swallows an entire step along a colour ramp — twenty thousand pixels
 * of `#2563eb` repainted as `#3b82f6`, which is Tailwind's blue-600 and
 * blue-500, reported as no difference at all. Two knobs named `threshold` and
 * `maxDiffPixels` read as "how different" and "how much", and a team that
 * believes that will set `maxDiffPixels: 0` to be strict and never find out
 * that nothing was being counted.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { test, expect, type Page } from '@playwright/test'

import { compareWith } from './capture.ts'
import { CHANGES, type DeltaBand } from './changes.ts'

/** The thresholds the wirings in `wirings.ts` actually use, plus the ends. */
const THRESHOLDS = [0, 0.1, 0.2, 0.3] as const

/** The flat fill every pair is compared over, at 200×100 = 20,000 pixels. */
const SWATCH_AREA = 200 * 100

/**
 * The colour pairs the fixture itself uses, and the band each one lands in.
 *
 * Not representative colours: these are the exact `from` → `to` of every
 * change in `changes.ts` whose region is a flat fill, so a band in the
 * catalogue is a number this file measured rather than a guess about a colour
 * like it. The two entries that are not from the fixture are the ends of the
 * scale — one unit of one channel, and a different colour — and they are here
 * to show what the band boundaries mean.
 *
 * `#f3f4f6` → `#fee2e2` is the one that matters. It is `panel-recoloured`: a
 * neutral panel turning error-pink, which no reviewer would fail to notice,
 * and it lands in the *same band as one unit of one channel*. The catalogue
 * filed it as `loud` first and `shade` second; only this file could say so,
 * because the matrix's wirings use thresholds 0 and 0.2 and all three bands
 * agree at those two values.
 */
const SAMPLES: readonly {
  readonly from: string
  readonly to: string
  readonly band: DeltaBand
  readonly source: string
}[] = [
  { from: '#2563eb', to: '#2563ec', band: 'hairline', source: 'brand-hairline' },
  { from: '#2563eb', to: '#3b82f6', band: 'shade', source: 'brand-shade' },
  { from: '#f3f4f6', to: '#fee2e2', band: 'hairline', source: 'panel-recoloured' },
  { from: '#16a34a', to: '#dc2626', band: 'loud', source: 'status-inverted' },
  { from: '#7c3aed', to: '#0891b2', band: 'loud', source: 'avatar-tint' },
]

/**
 * The band's definition, as a predicate over thresholds.
 *
 * This is the same reading `wirings.ts` applies in `flags`, written once more
 * here in the terms the measurement produces, so that the two have to agree.
 */
function bandSurvives(band: DeltaBand, threshold: number): boolean {
  switch (band) {
    case 'hairline':
      return threshold === 0
    case 'shade':
      return threshold < 0.2
    case 'loud':
      return true
  }
}

async function swatch(page: Page, colour: string): Promise<Buffer> {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#ffffff">` +
      `<div style="width:200px;height:100px;background:${colour}"></div></body></html>`,
  )

  return page.screenshot({ clip: { x: 0, y: 0, width: 200, height: 100 }, animations: 'disabled' })
}

test('threshold is a per-pixel colour distance, and 0.2 is a long way', async ({
  page,
}, testInfo) => {
  const observed: Record<string, Record<string, boolean>> = {}
  const expected: Record<string, Record<string, boolean>> = {}

  for (const sample of SAMPLES) {
    const name = `calibration-${sample.source}.png`
    const path = testInfo.snapshotPath(name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, await swatch(page, sample.from))

    const captured = await swatch(page, sample.to)
    const key = `${sample.source} ${sample.from}→${sample.to}`
    const row: Record<string, boolean> = {}
    const claim: Record<string, boolean> = {}

    for (const threshold of THRESHOLDS) {
      row[String(threshold)] = compareWith(captured, name, { threshold, maxDiffPixels: 0 }).flagged
      claim[String(threshold)] = bandSurvives(sample.band, threshold)
    }

    observed[key] = row
    expected[key] = claim
  }

  expect(observed).toEqual(expected)
})

test('a flat fill is all-or-nothing, so no pixel budget reaches it', async ({ page }, testInfo) => {
  const name = 'calibration-budget.png'
  const path = testInfo.snapshotPath(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, await swatch(page, '#2563eb'))

  const hairline = await swatch(page, '#2563ec')

  // Every pixel in the fill is counted or none is, so `maxDiffPixels` is a
  // step function with its step at the area of the region. This is what makes
  // `area: 'over-budget'` a property of the fixture's declared CSS sizes
  // rather than of how the runner rendered them.
  expect(compareWith(hairline, name, { threshold: 0, maxDiffPixels: SWATCH_AREA - 1 }).flagged).toBe(
    true,
  )
  expect(compareWith(hairline, name, { threshold: 0, maxDiffPixels: SWATCH_AREA }).flagged).toBe(
    false,
  )

  // …and with the threshold above the delta, the budget is never consulted:
  // a budget of zero passes, because zero pixels were counted.
  expect(compareWith(hairline, name, { threshold: 0.1, maxDiffPixels: 0 }).flagged).toBe(false)
})

test('every band in the catalogue is one the calibration measured', () => {
  const bandsInUse = new Set(
    CHANGES.filter((entry) => entry.region !== 'page-height').map((entry) => entry.delta),
  )
  const bandsMeasured = new Set(SAMPLES.map((entry) => entry.band))

  // Closed in both directions, like `determinism/registry.ts`: a band the
  // catalogue uses and this file never measured is an unbacked claim, and a
  // sample for a band nothing uses is a row that silts up.
  expect([...bandsInUse].sort()).toEqual([...bandsMeasured].sort())
})
