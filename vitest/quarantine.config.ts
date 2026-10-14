/**
 * Vitest config for the quarantine suite.
 *
 *   pnpm test:quarantine
 *
 * What it does differently from the main config: `QUARANTINE=1`, so the tests
 * listed in `flake/quarantine.json` run instead of being skipped, and two
 * extra reporters, so the run leaves a record behind. Everything else is the
 * main config, merged rather than restated — see below.
 *
 * ---------------------------------------------------------------------------
 * What the first version of this file did
 * ---------------------------------------------------------------------------
 * It had never been run. Four things were wrong with it, and each is a
 * measurement in `flake/README.md` now:
 *
 *   - Its `include`/`exclude` pair collected 224 files where the main config
 *     collects 190. The extra 34 were every Playwright spec and every
 *     container suite in the repository, `trace/evidence.spec.ts` among them —
 *     a file whose eight tests fail on purpose. `pnpm test:quarantine` exited
 *     1 with 37 failed files, and could not have done anything else. The globs
 *     are gone: this file now merges the main config, so one exclusion list
 *     serves both and the two cannot drift apart again.
 *   - Its alias was `{ '@': '.' }`. A bare `'.'` is not resolved relative to a
 *     config file, so every `@/…` import failed at import-analysis time —
 *     including `vitest/flaky.test.ts`, which is to say the quarantine suite
 *     could not load the file that defines quarantine. The main config carries
 *     the same comment, from the same mistake.
 *   - It set `outputFile: { json: 'quarantine-results/results.json' }` with
 *     `reporters: ['verbose']`. `outputFile` applies to reporters that write
 *     files, and `verbose` is not one, so no file was ever written and
 *     `quarantine-results/` was never created. The workflow that uploads it
 *     passes `if-no-files-found: ignore`, so the artifact was silently empty
 *     every night.
 *   - Its comment said "verbose output so individual retry attempts are
 *     visible in CI logs". Measured: `verbose` is the one Vitest reporter that
 *     does *not* print the `(retry xN)` marker. `default` prints it — and only
 *     inside a file it has expanded, which it does only when something in that
 *     file failed, so a suite whose only problem is a flake prints nothing
 *     about it either way. See the `vitest-default-retry` and
 *     `vitest-verbose-retry` rows of `flake/matrix.ts`.
 *
 * There is also no global `retry` here any more. The old one applied to every
 * test in the suite, not just the quarantined ones, which would hide a flake
 * in a test nobody had quarantined — in the one run whose purpose is to find
 * flakes. Quarantined tests get their retries from `createQuarantine`, which
 * gives them to exactly the tests the registry names.
 */

import { defineConfig } from 'vitest/config'

// Both relative, with the extension: a config file is loaded before its own
// `resolve.alias` exists, so `@/flake/reporter` does not resolve here.
import AttemptReporter from '../flake/reporter.ts'
import { REPO_ALIAS, UNIT_TEST_CONFIG } from '../vitest.config.ts'

export default defineConfig({
  test: {
    // Spread rather than merged: `mergeConfig` concatenates arrays, so a
    // reporter list or an exclusion list would come out as both configs' lists
    // end to end. What this file wants is the unit run's options with four of
    // them replaced.
    ...UNIT_TEST_CONFIG,

    // Activate quarantine mode: `createQuarantine` registers the listed tests
    // as live tests with retries instead of skipping them.
    env: { QUARANTINE: '1' },

    reporters: [
      // `default` rather than `verbose`: see the note above.
      'default',
      // Writes `quarantine-results/results.json`, which — unlike the
      // `outputFile` this file used to carry — is a file that now exists.
      'json',
      // One line per attempt, which is the only artifact a flake rate can be
      // computed from. `flake/matrix.ts` measures why the other two cannot.
      new AttemptReporter({ file: '.flake/quarantine-attempts.jsonl' }),
    ],

    outputFile: {
      json: 'quarantine-results/results.json',
    },

    // Quarantine results are informational: the job that runs this is not a
    // required check, and a coverage threshold would make it one.
    coverage: { ...UNIT_TEST_CONFIG.coverage, enabled: false },
  },

  resolve: { alias: REPO_ALIAS },
})
