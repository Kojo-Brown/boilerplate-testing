/**
 * Finding a Chrome for Lighthouse to drive.
 *
 * Three candidates, in order, because the three environments this gate runs in
 * disagree about where Chrome is:
 *
 *   1. `CHROME_PATH` — what `chrome-launcher` itself reads, and the escape
 *      hatch for a machine with a browser in neither of the other places.
 *   2. Playwright's Chromium. Every other browser job in this repository gets
 *      its browser with `pnpm exec playwright install chromium`, so in CI this
 *      is the one that exists and the gate needs no extra setup step.
 *   3. Nothing — hand off to `chrome-launcher`'s own search, which finds a
 *      system Chrome or Chromium.
 *
 * The existence check on the first two matters. `chromium.executablePath()`
 * reports the path for the Playwright *revision this version pins*, whether or
 * not it has been downloaded, so on a machine whose `PLAYWRIGHT_BROWSERS_PATH`
 * holds a different revision it returns a path that is not there. Passing that
 * to Lighthouse fails with `ENOENT` from a spawn deep inside `chrome-launcher`,
 * which is a confusing way to be told to run `playwright install`.
 */

import { existsSync } from 'node:fs'

/** Where the Chrome came from, for the gate's log. */
export interface ChromeChoice {
  readonly path: string | null
  readonly source: 'CHROME_PATH' | 'playwright' | 'chrome-launcher'
}

export function resolveChrome(
  env: Readonly<Record<string, string | undefined>> = process.env,
  playwrightPath: () => string = () => {
    throw new Error('not resolved')
  },
): ChromeChoice {
  const fromEnv = env['CHROME_PATH']
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) {
    return { path: fromEnv, source: 'CHROME_PATH' }
  }

  try {
    const candidate = playwrightPath()
    if (candidate !== '' && existsSync(candidate)) {
      return { path: candidate, source: 'playwright' }
    }
  } catch {
    // Playwright not installed, or no browser pinned. Fall through.
  }

  return { path: null, source: 'chrome-launcher' }
}

/** Resolve Chrome using Playwright's own answer when it is importable. */
export async function resolveChromeWithPlaywright(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ChromeChoice> {
  let fromPlaywright = (): string => {
    throw new Error('playwright unavailable')
  }

  try {
    const { chromium } = await import('@playwright/test')
    fromPlaywright = () => chromium.executablePath()
  } catch {
    // Leave the throwing default; resolveChrome treats it as "not available".
  }

  return resolveChrome(env, fromPlaywright)
}
