// @ts-check
//
// Lighthouse CI configuration.
//
// `.cjs` because package.json sets `"type": "module"` and LHCI loads this file
// with `require`.
//
// ---------------------------------------------------------------------------
// Read `wiring.ts` before editing the assert block
// ---------------------------------------------------------------------------
// The budget assertions below are *derived* from budgets.json rather than
// written out, and the two wirings a Lighthouse CI guide will show you instead
// — `collect.settings.budgets` and an `assert.assertions['performance-budget']`
// entry — both silently enforce nothing against Lighthouse 12, which removed
// W3C performance budgets along with the two audits that reported them.
// `wiring.ts` has the measurement and `lighthouse/check.ts` re-runs it.
//
// `assert.budgetsFile` is the other working wiring and is not used here: LHCI
// refuses to combine it with `assertions` ("Cannot use both budgets AND
// assertions"), so the quality assertions below would have to go, and it
// replaces the whole options object, which drops `includePassedAssertions` and
// leaves the results file holding only breaches. The PR comment needs the
// passing rows — see report.ts.
//
// The conversion is duplicated here in CommonJS because this file cannot import
// the TypeScript module that owns it. `wiring.test.ts` requires this file and
// audits `ci.assert.assertions` against `budgetAssertions()` line by line, so
// the duplication cannot drift: a budget added to budgets.json and not enforced
// here fails `pnpm test`.

const budgets = require('./budgets.json');

/** Sizes in a budget file are KiB, not kB. See budgets.ts. */
const KIB = 1024;

/** @type {Record<string, [string, Record<string, number>]>} */
const budgetAssertions = {};

for (const budget of budgets) {
  for (const { metric, budget: max } of budget.timings ?? []) {
    budgetAssertions[metric] = ['error', { maxNumericValue: max }];
  }
  for (const { resourceType, budget: max } of budget.resourceCounts ?? []) {
    budgetAssertions[`resource-summary:${resourceType}:count`] = [
      'error',
      { maxNumericValue: max },
    ];
  }
  for (const { resourceType, budget: max } of budget.resourceSizes ?? []) {
    budgetAssertions[`resource-summary:${resourceType}:size`] = [
      'error',
      { maxNumericValue: max * KIB },
    ];
  }
}

// Assertions that are not budgets. Kept separate from the derived block above
// so the merge order is visible: budgets win, because a quality assertion that
// named the same audit as a budget line would otherwise replace it.
/** @type {Record<string, [string, Record<string, number>]>} */
const qualityAssertions = {
  'categories:performance': ['warn', { minScore: 0.9 }],
  'categories:accessibility': ['error', { minScore: 0.9 }],
  'categories:best-practices': ['warn', { minScore: 0.9 }],
  'categories:seo': ['warn', { minScore: 0.8 }],

  // Accessibility audits worth failing on by name, so a regression in one of
  // them is legible in the log without opening the HTML report.
  'color-contrast': ['error', { minScore: 1 }],
  'image-alt': ['error', { minScore: 1 }],
  'document-title': ['error', { minScore: 1 }],
  'html-has-lang': ['error', { minScore: 1 }],
};

/**
 * URLs to audit. `LH_URLS` is a comma-separated override.
 *
 * The default is the fixture origin this directory ships, so `pnpm
 * lighthouse:ci` is a complete runnable command on a clean clone with no
 * application to point at. Replace both this and `startServerCommand` for a
 * real project:
 *
 *     Vite     pnpm preview      http://localhost:4173/
 *     Next.js  pnpm start        http://localhost:3000/
 */
const urls = (process.env.LH_URLS ?? 'http://localhost:8802/lean')
  .split(',')
  .map((url) => url.trim())
  .filter((url) => url !== '');

module.exports = {
  ci: {
    collect: {
      // Three runs, median reported. One run is not a measurement: LCP and TBT
      // move by tens of percent between runs on a shared CI runner, which is
      // enough to flip a budget on its own.
      numberOfRuns: 3,
      url: urls,
      startServerCommand: 'node lighthouse/server.ts',
      startServerReadyPattern: 'fixture origin ready',
      startServerReadyTimeout: 30_000,
      settings: {
        // NOT `budgets`. Lighthouse 12 has no such setting and ignores it
        // without a warning; see the header and wiring.ts. `wiring.test.ts`
        // fails if it reappears here.
        chromeFlags: '--no-sandbox --disable-dev-shm-usage --headless=new',
      },
    },

    assert: {
      // Budgets last: they win over a quality assertion naming the same audit.
      assertions: { ...qualityAssertions, ...budgetAssertions },
      // Without this the results file holds failures only, and a PR comment
      // built from it cannot tell "every budget met" from "no budget was
      // evaluated" — both are `[]`. See report.ts.
      includePassedAssertions: true,
    },

    upload: {
      // Writes the LHRs and assertion-results.json under .lighthouseci/, which
      // is what `lighthouse/check.ts` and the PR comment read, and what the CI
      // job uploads as an artifact. `temporary-public-storage` would publish
      // every audited page to a public URL, which is the wrong default for a
      // repository people copy into private projects.
      target: 'filesystem',
      outputDir: './.lighthouseci/reports',
      reportFilenamePattern: '%%PATHNAME%%-%%DATETIME%%.report.%%EXTENSION%%',
    },
  },
};
