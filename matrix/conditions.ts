/**
 * The three ways a suite can be pointed at "a phone", and the difference
 * between them is the measurement.
 *
 * `desktop` is the control. `narrow` is what a team does when somebody says
 * the app is broken on mobile — set the viewport to a phone's width and call
 * the test a mobile test. `emulated` is the device descriptor Playwright
 * ships. All three are the same Chromium; nothing here is about engines.
 */

import { devices } from '@playwright/test'

export const CONDITION_NAMES = ['desktop', 'narrow', 'emulated'] as const

export type ConditionName = (typeof CONDITION_NAMES)[number]

/** The descriptor `narrow` and `emulated` are both derived from. */
export const PHONE = 'Pixel 5'

/** The desktop descriptor both other conditions are measured against. */
export const DESKTOP = 'Desktop Chrome'

export interface Condition {
  readonly name: ConditionName
  readonly describes: string
  /** Context options, spread over the project's `use`. */
  readonly use: Record<string, unknown>
}

function descriptor(name: string): Record<string, unknown> {
  const device = devices[name]

  if (!device) {
    throw new Error(`playwright ships no device named ${name}`)
  }

  return { ...device }
}

/** The phone's viewport, and nothing else about the phone. */
export function phoneViewport(): { width: number; height: number } {
  const viewport = (descriptor(PHONE) as { viewport?: { width: number; height: number } }).viewport

  if (!viewport) {
    throw new Error(`${PHONE} has no viewport`)
  }

  return viewport
}

export const CONDITIONS: readonly Condition[] = [
  {
    name: 'desktop',
    describes: 'Desktop Chrome, unmodified',
    use: descriptor(DESKTOP),
  },
  {
    name: 'narrow',
    describes: "Desktop Chrome with the phone's viewport and nothing else",
    use: { ...descriptor(DESKTOP), viewport: phoneViewport() },
  },
  {
    name: 'emulated',
    describes: `the ${PHONE} descriptor`,
    use: descriptor(PHONE),
  },
]
