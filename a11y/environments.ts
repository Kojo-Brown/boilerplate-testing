/**
 * The same rules, the same markup, two environments.
 *
 * This repository already runs axe-core: `check.ts` has scanned rendered
 * components under Testing Library since Phase 2, and the reasonable question
 * about the item this directory implements is what an end-to-end scan adds
 * that the component scan does not already cover. The answer is a short list
 * of rules, and it is short enough to be worth measuring exactly rather than
 * gesturing at.
 *
 * So: one fragment of markup, held identical, run through axe-core 4.12.1
 * twice — once in jsdom under `pnpm test` (`environment.test.ts`) and once in
 * Chromium under `pnpm test:a11y` (`journey.spec.ts`). The rule set is the
 * same, the version is the same, and nothing varies but the environment. That
 * `axe-core` resolves to a single copy in this repository's lockfile is what
 * makes the comparison mean anything: `@axe-core/playwright` is pinned to
 * 4.12.1 so that it depends on `axe-core@~4.12.1` and shares the one install,
 * rather than pulling a second version alongside it.
 *
 * Two of the six rows move, and they move in opposite and instructive ways.
 * `color-contrast` degrades honestly — jsdom cannot compute a rendered colour,
 * so axe says so and files the result under `incomplete`. `target-size`
 * degrades dishonestly: jsdom reports every box as zero-sized, the geometry
 * check finds nothing to complain about, and the rule reports a **pass** for
 * two buttons that a browser calls a serious violation. A green that means
 * "there was nothing to measure" is the expensive kind.
 */

import { HAZARDS } from './hazards.ts'

/**
 * The subject, as a body fragment.
 *
 * Deliberately not `page.ts`: that fixture's defects are built by script in
 * response to clicks, and a comparison of environments has to hold the DOM
 * still. Every node here is the static twin of a hazard in the journey, and
 * `environment.test.ts` checks that the rules it names are the rules the
 * journey catalogue names, so the two cannot drift apart.
 *
 * The inline styles are load-bearing. jsdom applies them and still computes no
 * layout, which is the whole point of the `target-size` row.
 */
export const ENVIRONMENT_FIXTURE = `
<main id="content">
  <h1>Orders</h1>
  <p id="count" style="color:#949494;background:#ffffff">12 results</p>
  <div style="display:flex;gap:0">
    <button id="refresh" style="width:20px;height:20px;padding:0" aria-label="Refresh">R</button>
    <button id="export" style="width:20px;height:20px;padding:0" aria-label="Export">E</button>
  </div>
  <ul><li><img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=" /></li></ul>
  <p><input id="name" type="text" aria-label="Name" aria-invalid="true" aria-describedby="name-error" /></p>
</main>
<div id="hidden-host" aria-hidden="true"><button id="behind">Behind the dialog</button></div>
<div id="dialog" role="dialog"><p>Preferences</p><button id="close">Close</button></div>
`

/** Where a rule's result lands. `absent` means the rule did not run at all. */
export const PLACEMENTS = ['violation', 'incomplete', 'passes', 'absent'] as const

export type Placement = (typeof PLACEMENTS)[number]

export interface EnvironmentRow {
  readonly rule: string
  /** With the rule explicitly enabled, so that `target-size` is comparable. */
  readonly jsdom: Placement
  readonly browser: Placement
  readonly note: string
}

/**
 * Measured, not quoted. `environment.test.ts` re-derives the `jsdom` column on
 * every `pnpm test`; `journey.spec.ts` re-derives the `browser` column against
 * Chromium on every `pnpm test:a11y`.
 */
export const ENVIRONMENT_ROWS: readonly EnvironmentRow[] = [
  {
    rule: 'color-contrast',
    jsdom: 'incomplete',
    browser: 'violation',
    note: 'jsdom computes no rendered colour and says so — the honest degradation',
  },
  {
    rule: 'target-size',
    jsdom: 'passes',
    browser: 'violation',
    note: 'jsdom reports every box as zero-sized, so the geometry check passes two 20x20 buttons',
  },
  {
    rule: 'image-alt',
    jsdom: 'violation',
    browser: 'violation',
    note: 'a question about an attribute; no environment is needed to answer it',
  },
  {
    rule: 'aria-dialog-name',
    jsdom: 'violation',
    browser: 'violation',
    note: 'likewise — the accessible-name computation needs no layout here',
  },
  {
    rule: 'aria-hidden-focus',
    jsdom: 'incomplete',
    browser: 'incomplete',
    note: 'deferred in both: the environment is not what makes axe decline this one',
  },
  {
    rule: 'aria-valid-attr-value',
    jsdom: 'incomplete',
    browser: 'incomplete',
    note: 'likewise — a dangling IDREF is a review item wherever it is found',
  },
]

/** The rows whose verdict depends on having a browser. */
export function movesWithEnvironment(): readonly EnvironmentRow[] {
  return ENVIRONMENT_ROWS.filter((row) => row.jsdom !== row.browser)
}

/**
 * The rules the journey catalogue makes a claim about.
 *
 * Exported so that `environment.test.ts` can assert the two tables cover the
 * same rules: a rule added to `hazards.ts` with no environment row, or the
 * reverse, is a table that has drifted.
 */
export function journeyRules(): readonly string[] {
  return [...new Set(HAZARDS.map((hazard) => hazard.rule).filter((rule) => rule !== null))].sort()
}

export function renderEnvironmentTable(): string {
  const header = ['axe rule', 'jsdom', 'Chromium', 'why']
  const rows = ENVIRONMENT_ROWS.map((row) => [
    `\`${row.rule}\``,
    `\`${row.jsdom}\``,
    `\`${row.browser}\``,
    row.note,
  ])

  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}
