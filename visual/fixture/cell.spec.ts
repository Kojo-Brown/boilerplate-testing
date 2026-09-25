/**
 * The subject of the lifecycle measurement: one image assertion, and nothing
 * else.
 *
 * It is a Playwright spec that never takes a `page`, so no browser is
 * launched — which is the whole reason `lifecycle.test.ts` can ride `pnpm test`
 * on every Node major. `matrix/fixture/specs/` makes the same move for the
 * same reason.
 *
 * This file is never run by `pnpm test:visual`: `playwright-visual.config.ts`
 * matches `matrix.spec.ts` and `calibration.spec.ts` only, and
 * `vitest.config.ts` excludes `visual/**\/*.spec.ts`. It is run by
 * `lifecycle.ts`, which spawns the CLI against the config beside it.
 */

import { expect, test } from '@playwright/test'

import { flatPng } from './pixel.ts'

const COLOUR = process.env['FIXTURE_COLOUR'] ?? '#2563eb'

test('the render matches its baseline', () => {
  expect(flatPng(COLOUR)).toMatchSnapshot('cell.png', { threshold: 0, maxDiffPixels: 0 })
})
