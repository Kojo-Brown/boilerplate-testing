/**
 * Pattern 1 — the full-markup file snapshot.
 *
 * This is the one the policy is strictest about, and it is deliberately here
 * rather than banned, because there is a case where it earns its place and
 * this is it: a module whose entire job is to produce markup, where the
 * arrangement *is* the behaviour, and where an assertion suite covering the
 * same ground would be forty `expect` calls that still miss the value nobody
 * thought of. `detection.test.ts` measures that advantage: this is the only
 * technique in the directory that catches all ten injected bugs.
 *
 * The cost is measured in the same place. It is also the only technique that
 * fails on all six refactors that broke nothing, which puts it at a 62.5%
 * signal rate — the number that eventually turns `-u` into a reflex.
 *
 * So the policy does not forbid it. It requires it to be *registered*:
 * `registry.ts` carries this snapshot with a line budget and a written reason,
 * and `pnpm snapshot:check` fails if the snapshot grows past the budget, if it
 * is not registered at all, or if it contains anything that changes on its
 * own. One order, not four — the corpus is exercised by the projection
 * instead, because four full documents is 138 lines of snapshot and nobody
 * reads the fourth.
 */

import { describe, expect, it } from 'vitest'

import { STANDARD } from './orders'
import { renderOrderSummary } from './render'

describe('the order summary markup', () => {
  it('renders a paid order in full', () => {
    // File snapshot rather than inline: 39 lines inline would bury the test.
    // That trade is exactly what `registry.ts` records — a file snapshot is
    // out of the reviewer's eye-line, so it gets a budget instead.
    expect(renderOrderSummary(STANDARD)).toMatchSnapshot()
  })
})
