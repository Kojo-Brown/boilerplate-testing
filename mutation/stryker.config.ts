/**
 * Stryker's configuration, derived from `scope.ts`.
 *
 * `mutate` is computed from the scope table rather than repeated as a glob,
 * which removes the drift this setup is otherwise guaranteed to develop: a
 * module added to the glob but not the table has no floor and is gated by
 * nothing, and a module in the table but not the glob is never measured while
 * its floor sits in the file looking enforced. Neither is possible when one
 * array produces both. `scope.test.ts` closes the loop from the other end, by
 * asserting the report contains a row for every scoped module and no rows
 * besides.
 *
 * It is a `.ts` file, which Stryker documents no support for and handles
 * anyway: `config-reader.ts` special-cases `.json` and hands every other
 * extension to a dynamic `import()`, and Node strips the types itself. That is
 * the same 22.18 floor `engines.node` already declares for `eslint.config.js`,
 * and it is why the import below carries its `.ts` extension —
 * `allowImportingTsExtensions` in `tsconfig.json` exists for exactly this.
 *
 * The alternative was `.mjs`, and it costs the type annotation: a JavaScript
 * config cannot be typechecked by `pnpm typecheck` without turning `allowJs`
 * on repository-wide, and `mutation/scope.test.ts` could not import it to
 * check that `mutate` really is the scope table without the same change.
 *
 * ---------------------------------------------------------------------------
 * `plugins` is spelled out on purpose
 * ---------------------------------------------------------------------------
 * Stryker's default is the glob `['@stryker-mutator/*']` resolved against
 * `node_modules`. Under pnpm the top level of `node_modules` holds symlinks
 * into the content-addressed store and the glob comes back empty, so the run
 * dies with `Cannot find TestRunner plugin "vitest". In fact, no TestRunner
 * plugins were loaded. Did you forget to install it?` — pointing at an install
 * that is in fact perfectly fine. Naming the plugin skips the glob entirely.
 *
 * ---------------------------------------------------------------------------
 * No type checker
 * ---------------------------------------------------------------------------
 * `@stryker-mutator/typescript-checker` compiles each mutant and discards the
 * ones that do not typecheck. It is not used here, for a reason worth stating
 * rather than leaving as an omission: it roughly doubles the run and the
 * mutants it removes are not free of information. Vitest transpiles rather
 * than typechecks, so a mutant that would be a type error still runs, and a
 * *surviving* one is a real finding — it says a distinction the type system
 * makes is one no test makes. Three of the current survivors are exactly that,
 * all three on one line of `tdd/doubles/registerUser.ts`, and `README.md`
 * reports what they turned out to say.
 */

import type { PartialStrykerOptions } from '@stryker-mutator/api/core'

import { SCOPE, OVERALL_FLOOR } from './scope.ts'

/**
 * Stryker's own options, plus the one field its types cannot see.
 *
 * A test runner contributes its options to `StrykerOptions` by declaration
 * merging, and `@stryker-mutator/vitest-runner` does that from a module its
 * package does not export — so `vitest` is typed as `{}` here and
 * `vitest.configFile` is an error rather than a string. Reaching into the
 * runner's `dist/` to import `VitestRunnerOptionsWithStrykerOptions` would fix
 * the type by depending on a path that is not part of its API. Stating the one
 * field this config sets is the smaller commitment, and `scope.test.ts` checks
 * its value rather than only its type.
 */
type MutationConfig = PartialStrykerOptions & {
  readonly vitest: { readonly configFile: string }
}

const config: MutationConfig = {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: {
    configFile: 'mutation/vitest.config.ts',
  },
  mutate: SCOPE.map((entry) => entry.module),
  coverageAnalysis: 'perTest',
  // `clear-text` prints every survivor with its diff, which is the only part
  // of the output anybody acts on; `json` is what `check.ts` reads back. The
  // `html` reporter is deliberately absent — it writes a report nothing in CI
  // serves, and `progress` degrades to one line per mutant on a non-TTY.
  reporters: ['clear-text', 'json'],
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  clearTextReporter: {
    // Survivors are the output. All of them, with enough context to judge
    // whether each is a missing assertion or an equivalent mutant.
    allowColor: false,
    maxTestsToLog: 0,
  },
  // Thresholds are informational here: `break` stays null so that `stryker
  // run` reports and `pnpm mutation:check` decides. One gate, one exit code,
  // one explanation — see `check.ts`.
  thresholds: {
    high: 90,
    low: OVERALL_FLOOR,
    break: null,
  },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
}

export default config
