/**
 * The 117 cells, re-derived against Chromium every run.
 *
 * One test per change, asserting that change's whole row rather than one cell,
 * because the interesting failures are differences *between* wirings and a row
 * asserted a cell at a time reports the first one and stops.
 *
 * Each test takes four screenshots of the unmutated page and four of the
 * mutated one — the four distinct capture configurations among the nine
 * wirings, not nine — writes the first four as this run's baselines, and grades
 * the second four nine times. The sharing is the capture/comparison split made
 * operational: `budgeted` and `masked` differ only in `maxDiffPixels`, so
 * asking the browser twice would measure the renderer's repeatability rather
 * than the comparator's behaviour.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { test, expect, type Page } from '@playwright/test'

import { captureWith, compareWith, waitForPainted } from './capture.ts'
import { CHANGES, type Change } from './changes.ts'
import { BASELINE_NONCE, VARIANT_NONCE } from './subject.ts'
import { subjectUrl } from './server.ts'
import {
  WIRINGS,
  captureConfigurations,
  captureSignature,
  consultsBudget,
  flags,
  type CaptureControls,
} from './wirings.ts'

/** A snapshot name that is a filename: the signature's slashes are not. */
function snapshotName(change: Change, controls: CaptureControls): string {
  return `${change.id}--${captureSignature(controls).replaceAll('/', '-')}.png`
}

async function show(page: Page, change: string | null, nonce: number): Promise<void> {
  await page.goto(subjectUrl(change, nonce))
  await waitForPainted(page)
}

for (const change of CHANGES) {
  test(`${change.id} (${change.kind})`, async ({ page }, testInfo) => {
    const configurations = captureConfigurations()

    // 1. The baselines: the unmutated page, once per capture configuration,
    //    written to the path `toMatchSnapshot` will read them back from.
    await show(page, null, BASELINE_NONCE)

    for (const controls of configurations) {
      const path = testInfo.snapshotPath(snapshotName(change, controls))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, await captureWith(page, controls))
    }

    // 2. The mutated page, once per capture configuration.
    await show(page, change.id, VARIANT_NONCE)

    const captured = new Map<string, Buffer>()

    for (const controls of configurations) {
      captured.set(captureSignature(controls), await captureWith(page, controls))
    }

    // 3. Nine gradings over those four images.
    const measured: Record<string, boolean> = {}
    const predicted: Record<string, boolean> = {}
    const reasons: Record<string, string> = {}

    for (const subject of WIRINGS) {
      const actual = captured.get(captureSignature(subject.capture))
      expect(actual, `no capture for ${subject.name}`).toBeDefined()

      const comparison = compareWith(
        actual as Buffer,
        snapshotName(change, subject.capture),
        subject.compare,
      )

      measured[subject.name] = comparison.flagged
      predicted[subject.name] = flags(subject, change)
      reasons[subject.name] = comparison.reason
    }

    // The published row is the claim; this is the check. A wrong cell fails
    // here rather than being quietly re-derived into agreement.
    expect(measured, `row for ${change.id}; reasons: ${JSON.stringify(reasons)}`).toEqual(predicted)
  })
}

test.describe('the reasons a comparison can fail', () => {
  test('a document that grew is rejected on size, before either tolerance', async ({
    page,
  }, testInfo) => {
    const controls: CaptureControls = { scope: 'full-page', mask: true, animations: 'disabled' }
    const name = 'size-mismatch.png'

    await show(page, null, BASELINE_NONCE)
    const path = testInfo.snapshotPath(name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, await captureWith(page, controls))

    await show(page, 'page-grew', VARIANT_NONCE)
    const grown = await captureWith(page, controls)

    // The most permissive comparison this API can express. It still fails, and
    // it fails for a reason no tolerance is consulted for — which is why
    // `over-tolerant` catches `page-grew` and misses two colour regressions it
    // is far better placed to see.
    const permissive = compareWith(grown, name, { threshold: 1, maxDiffPixels: 10_000_000 })

    expect(permissive.flagged).toBe(true)
    expect(permissive.reason).toBe('size')
  })

  test('masking a region makes a resize of it louder, not quieter', async ({ page }, testInfo) => {
    const bare: CaptureControls = { scope: 'viewport', mask: false, animations: 'disabled' }
    const masked: CaptureControls = { scope: 'viewport', mask: true, animations: 'disabled' }

    await show(page, null, BASELINE_NONCE)
    for (const [name, controls] of [
      ['resize-bare.png', bare],
      ['resize-masked.png', masked],
    ] as const) {
      const path = testInfo.snapshotPath(name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, await captureWith(page, controls))
    }

    await show(page, 'stamp-enlarged', VARIANT_NONCE)

    // Both flag it, which is the surprise: the usual reading of `mask` is
    // "these pixels stop mattering", and the mask's own rectangle is a pixel
    // like any other. `stamp-recoloured` is the same element changing without
    // moving, and there the mask does exactly what the reading predicts.
    expect(compareWith(await captureWith(page, bare), 'resize-bare.png', {
      threshold: 0,
      maxDiffPixels: 0,
    }).flagged).toBe(true)

    expect(
      compareWith(await captureWith(page, masked), 'resize-masked.png', {
        threshold: 0,
        maxDiffPixels: 4_000,
      }).flagged,
    ).toBe(true)
  })
})

test('the pixel bands in the catalogue have room to be wrong in', async ({ page }, testInfo) => {
  // A band that a font-hinting difference between two Chromium builds could
  // cross would make the whole matrix a property of the machine that ran it,
  // so the bands are checked for *margin* rather than for correctness: an
  // `under-budget` change must move well under the 4,000-pixel budget and an
  // `over-budget` one well over it. The two limits below straddle the budget
  // with room on each side, and this is where that headroom is stated —
  // `README.md` quotes these numbers rather than owning them.
  const UNDER = 2_500
  const OVER = 6_000

  // Only the cells the budget actually decides. A band measured under a
  // capture that masks the change away, or settles it, or never framed it, is
  // a measurement of nothing — and `consultsBudget` is the model saying which
  // those are rather than this file guessing.
  const wanted = new Map<string, CaptureControls>()

  for (const change of CHANGES) {
    for (const subject of WIRINGS) {
      if (consultsBudget(subject, change)) {
        wanted.set(`${change.id}|${captureSignature(subject.capture)}`, subject.capture)
      }
    }
  }

  expect(wanted.size, 'no cell consults a pixel band').toBeGreaterThan(0)

  for (const [key, controls] of wanted) {
    const id = key.split('|')[0] as string
    const target = CHANGES.find((entry) => entry.id === id) as Change
    const name = `band-${key.replaceAll('|', '--').replaceAll('/', '-')}.png`
    const path = testInfo.snapshotPath(name)
    mkdirSync(dirname(path), { recursive: true })

    await show(page, null, BASELINE_NONCE)
    writeFileSync(path, await captureWith(page, controls))

    await show(page, target.id, VARIANT_NONCE)
    const comparison = compareWith(await captureWith(page, controls), name, {
      threshold: 0,
      maxDiffPixels: 0,
    })

    expect(comparison.pixels, `${key} moved no countable pixels`).not.toBeNull()
    const counted = comparison.pixels as number

    if (target.area === 'under-budget') {
      expect(counted, `${key} is banded under-budget`).toBeLessThan(UNDER)
    } else {
      expect(counted, `${key} is banded over-budget`).toBeGreaterThan(OVER)
    }
  }
})
