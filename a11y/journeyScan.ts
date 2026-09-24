/**
 * The thin part: `AxeBuilder`, driven once per journey state.
 *
 * Split from `scan.ts` so that the decisions — which bucket counts, which
 * rules are off, what makes two findings the same defect — stay testable
 * without a browser, and so this file stays small enough to read as the
 * example it is meant to be.
 *
 * One gotcha is worth recording here because it costs an afternoon: AxeBuilder
 * refuses a page created by `browser.newPage()` with "Please use
 * browser.newContext()". Playwright's own `page` fixture already gives each
 * test its own context, so a Playwright test never meets this — but a script
 * that drives a browser by hand does, immediately.
 */

import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { enableAll, findingsFrom, type Finding } from './scan.ts'
import type { JourneyState } from './states.ts'

export interface ScanOptions {
  /** Turn on the rules axe-core ships `enabled: false`. */
  readonly enableDisabledRules?: boolean
  /** Count `results.incomplete` as findings. */
  readonly includeIncomplete?: boolean
  /** Restrict the scan to a selector — the dialog rather than the document. */
  readonly within?: string
}

/**
 * Run axe in one journey state and return flattened findings.
 *
 * `state` is carried through into every finding rather than inferred, because
 * the whole value of scanning a journey is being able to say *where* a defect
 * was found, and a scanner cannot work that out for itself.
 */
export async function scanState(
  page: Page,
  state: JourneyState,
  options: ScanOptions = {},
): Promise<readonly Finding[]> {
  let builder = new AxeBuilder({ page })

  if (options.enableDisabledRules === true) {
    builder = builder.options({ rules: enableAll() })
  }

  if (options.within !== undefined) {
    builder = builder.include(options.within)
  }

  return findingsFrom(await builder.analyze(), state, {
    includeIncomplete: options.includeIncomplete ?? false,
  })
}
