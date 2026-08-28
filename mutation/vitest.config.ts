/**
 * The Vitest project a mutation run executes.
 *
 * Stryker runs the tests once per mutant, so this config exists to make that
 * loop as small as it can honestly be: the suites that reach a scoped module,
 * and nothing else. `include` is derived rather than written down — see
 * `reach.ts` for why a hand-maintained list is the one way a scoped mutation
 * run silently reports the wrong number.
 *
 * ---------------------------------------------------------------------------
 * `environment: 'node'`
 * ---------------------------------------------------------------------------
 * The root config runs everything under jsdom because some suites render
 * React. None of the suites reachable from the current scope do, and building
 * a DOM per worker is pure overhead on a run that pays for it once per mutant.
 * `scope.test.ts` asserts the scope stays inside that claim: a scoped module
 * whose covering suites reach `@testing-library/react` fails, rather than
 * being run in the wrong environment and blamed on the tests.
 *
 * ---------------------------------------------------------------------------
 * Why `vitest` has to be aliased to itself
 * ---------------------------------------------------------------------------
 * This is not decoration and removing it does not fail quietly.
 *
 * Stryker copies the repository into a sandbox directory and runs Vitest with
 * that copy as the Vite root. This repository has a top-level directory called
 * `vitest/` — the setup file, the flaky-test helpers, the quarantine config —
 * so the sandbox does too. Resolving the bare specifier `vitest` from inside
 * that root then finds the *directory* before it finds the package, and every
 * worker dies during the dry run with
 *
 *     Failed to load url <sandbox>/vitest (resolved id: <sandbox>/vitest).
 *     Does the file exist?
 *
 * which names neither Stryker, nor the directory, nor the collision. The
 * import that trips it is inside Stryker's own injected setup file, so no
 * amount of reading this repository's sources explains it.
 *
 * Pinning the specifier to the package's resolved entry point removes the
 * ambiguity without excluding `vitest/` from the sandbox — which was the other
 * fix, and a worse one: it would have made every future suite under `vitest/`,
 * and every module importing `@/vitest/flaky`, silently unavailable to a
 * mutation run.
 */

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

import { coveringSuites } from './reach.ts'
import { scopedModules } from './scope.ts'

// Stated here rather than left to `shape/classify.ts`'s own default. Vite
// bundles a config file before loading it and rewrites `import.meta.url` to
// the config's path throughout the bundle, so a default computed inside an
// imported module would be resolved relative to *this* file. It happens to
// land on the right directory — both files sit one level down — and that is
// precisely the kind of accident worth not depending on, in a config Stryker
// re-loads from a sandbox copy of the repository.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^vitest$/,
        replacement: fileURLToPath(import.meta.resolve('vitest')),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: [...coveringSuites(scopedModules(), repoRoot)],
  },
})
