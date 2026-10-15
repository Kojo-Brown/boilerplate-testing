import { fileURLToPath } from 'node:url'
import { defineConfig, type ViteUserConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

/**
 * The `@` alias, exported so that a second config can have the same one.
 *
 * Must be absolute: a bare '.' is not resolved relative to a config file, so
 * `@/vitest/flaky` failed to resolve at import-analysis time. That mistake was
 * made twice — here and in `vitest/quarantine.config.ts`, which is why the
 * value now lives in one place.
 */
export const REPO_ALIAS = { '@': rootDir }

/**
 * The unit run's test options, exported for `vitest/quarantine.config.ts`.
 *
 * The exclusion list below is the reason: it is forty lines of argument about
 * which specs belong to which runner, and the quarantine config had its own
 * copy that said something different — it collected 224 files where this one
 * collects 190, including a file whose tests fail on purpose. One list, two
 * configs. See `flake/README.md`.
 */
export const UNIT_TEST_CONFIG = {
  environment: 'jsdom',
  globals: true,
  setupFiles: ['./vitest/setup.ts'],
  exclude: [
    'pact/**',
    'node_modules/**',
    // Playwright specs live under playwright/ and match Vitest's default
    // `*.spec.ts` include glob. They need a real browser and a running app,
    // so they belong to `pnpm test:e2e`, not the unit run.
    'playwright/**',
    // Playwright *component* specs, which bundle and mount a component in a
    // real browser. They match Vitest's default `*.spec.tsx` include glob
    // too, and belong to `pnpm test:ct`. Only the specs: `ct/` also holds
    // `*.jsdom.test.tsx`, which is the same component under Testing Library
    // and is the half of the comparison that runs here.
    'ct/**/*.spec.tsx',
    // Playwright specs that drive a browser against the fixture origin
    // `intercept/server.ts` starts. They match Vitest's default `*.spec.ts`
    // include glob and belong to `pnpm test:intercept` and its own CI job.
    // Only the specs: the rest of `intercept/` — the route table, the
    // wirings, the classifiers, the matrix and the recording audit — is
    // ordinary computation and stays here, so `pnpm test` keeps covering it
    // on a machine with no browser at all.
    'intercept/**/*.spec.ts',
    // Playwright specs belonging to the cross-browser matrix. `matrix/` has
    // two kinds: `emulation.spec.ts`, which needs a browser and belongs to
    // `pnpm test:matrix`, and `matrix/fixture/specs/*.spec.ts`, which are
    // the *subject* of the sharding measurement rather than tests of
    // anything — they are counted by `--list`, never run here. Everything
    // else in the directory, including the runs that spawn the Playwright
    // CLI, is ordinary Node and stays in this suite: the whole sharding half
    // is measurable on a machine with no browser at all.
    'matrix/**/*.spec.ts',
    // The browser half of `a11y/`. `journey.spec.ts` drives a real Chromium
    // against the fixture origin `a11y/server.ts` starts, and belongs to
    // `pnpm test:a11y` and its own CI job. Only the spec: the rest of the
    // directory — the hazard catalogue, the reachability model, the scan
    // helpers, the README audit and the jsdom column of the environment
    // comparison — is ordinary computation and stays here, so `pnpm test`
    // keeps covering it on a machine with no browser at all. That split is
    // the point of the directory rather than an accident of it: half the
    // findings are about what a scanner cannot see, and none of those needs
    // a scanner to check.
    'a11y/**/*.spec.ts',
    // The browser half of `visual/`. `matrix.spec.ts` and
    // `calibration.spec.ts` drive a real Chromium against the fixture origin
    // `visual/server.ts` starts, and belong to `pnpm test:visual` and its own
    // CI job. `fixture/cell.spec.ts` is neither: it is the *subject* of the
    // baseline-lifecycle measurement, spawned by `lifecycle.ts` through the
    // Playwright CLI and never run by this suite or by `test:visual`.
    //
    // Only the specs. The rest of the directory — the change catalogue, the
    // wiring model, the fixture audit, the workflow audit, the README audit
    // and the whole baseline lifecycle — is ordinary computation and stays
    // here, so `pnpm test` keeps covering it on a machine with no browser at
    // all. That split matters more here than anywhere: what
    // `--update-snapshots` does to a file on disk is the runner's behaviour,
    // not the renderer's, and paying for a browser to establish it would be
    // paying for the wrong instrument.
    'visual/**/*.spec.ts',
    // The browser half of `trace/`. `evidence.spec.ts` fails all eight of its
    // tests on purpose — it is the *subject* of the evidence measurement, not
    // a test of anything — and `attempts/attempts.spec.ts` is the subject of
    // the retention measurement, run six times by `pnpm trace:check` with a
    // different `trace` mode each time. Both are spawned by `trace/check.ts`
    // through the Playwright CLI and neither belongs to any suite: running
    // them here would make `pnpm test` red by design.
    //
    // Only the specs. The zip reader, the channel parser, the fault
    // catalogue, both tables, every finding and the README audit are ordinary
    // computation and stay here, so `pnpm test` keeps covering them on a
    // machine with no browser at all.
    'trace/**/*.spec.ts',
    // The two kinds of spec in `authstate/`. `capture.spec.ts` drives a real
    // Chromium against the fixture session server `authstate/server.ts`
    // starts, and belongs to `pnpm test:authstate` and its own CI job;
    // `fixture/specs/*.spec.ts` are the *subject* of the isolation
    // measurement, spawned ten times over by `runs.test.ts` through the
    // Playwright CLI with a different auth strategy each time, and one of
    // them fails on its first attempt on purpose — running them here would
    // make `pnpm test` red by design.
    //
    // Only the specs. The session server's routes, the wirings, the probes,
    // both tables, the ledger derivation, every finding, the README audit —
    // and the ten real runs, which need no browser because the fixture builds
    // `APIRequestContext`s — are ordinary Node and stay here. That is the
    // larger half: `restart-inheritance` is a fact about Playwright's worker
    // scheduler, and paying for a browser to establish it would be paying for
    // the wrong instrument.
    'authstate/**/*.spec.ts',
    // The flaky subject. `flake/fixture/subject.test.ts` and
    // `flake/fixture/subject.spec.ts` register the cases of a plan that tells
    // them which attempts to fail on, and `flake/runs.ts` spawns them — once
    // per wiring under Vitest, once per wiring under Playwright — with a plan
    // and a ledger directory in their environment. They are the *subject* of
    // the rerun measurement rather than tests of anything: running them here
    // would make `pnpm test` red by design, and without `FLAKE_PLAN` set they
    // refuse to load at all.
    //
    // Only the fixture. Everything else in `flake/` — the wirings, the
    // probes, the attempt model, both report parsers, the analytics, the
    // quarantine registry, the dashboard and the README audit — is ordinary
    // Node and stays here, including the real runs, which need no browser
    // because the Playwright half of the subject requests no fixture.
    'flake/fixture/**',
    // The test-impact subject and the faulted copies of it. The six suites
    // under `impact/fixture/` are the *subject* of the selection measurement
    // rather than tests of anything: they are collected by `impact/runs.ts`
    // through a config of their own, fourteen times over, and they depend on a
    // custom matcher that only that config loads — collected here they would
    // fail on the first assertion. `.runs/` is where a fault is applied, and
    // one of the faults adds a test file that fails on purpose.
    //
    // Only the fixture. Everything else in `impact/` — the diff parser, the
    // import graph, the trigger and edge rules, the selector, the scorer, the
    // real runs and the README audit — is ordinary Node and stays here.
    'impact/fixture/**',
    'impact/.runs/**',
    // Suites that need a container runtime are `*.container.test.ts`
    // wherever they live — `containers/` and `dbisolation/` today. They take
    // minutes and belong to `pnpm test:containers` and its own CI job.
    // Everything else in those directories — the image table, the fixture's
    // naming, the fault catalogue, the README audits — is ordinary
    // computation and stays here, so `pnpm test` keeps covering it on a
    // machine with no Docker at all.
    '**/*.container.test.ts',
  ],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'html'],
    exclude: [
      '**/*.config.*',
      '**/*.test.*',
      '**/node_modules/**',
      'pact/**',
      'playwright/**',
      // The component-test directory. Its components are exercised by
      // `pnpm test:ct`, which runs in a browser outside this process, so
      // whatever this run covered of them would be the jsdom half of a
      // comparison — a coverage figure that says the opposite of what it
      // looks like.
      'ct/**',
      // The same argument as `ct/`, one directory over: what `intercept/`
      // measures happens in a browser outside this process, so a coverage
      // figure taken here would be of the parts that do not need one.
      'intercept/**/*.spec.ts',
      'intercept/client.ts',
      'intercept/record.ts',
      'intercept/session.ts',
      // The same argument again for the matrix directory: `page.ts` is a
      // string of HTML evaluated by a browser in another process, `server.ts`
      // binds it there, and the fixture specs exist to be listed rather than
      // executed by this run.
      'matrix/**/*.spec.ts',
      'matrix/fixture/**',
      'matrix/page.ts',
      'matrix/server.ts',
      // The same argument once more for the accessibility journey: `page.ts`
      // is a string of HTML evaluated by a browser in another process,
      // `server.ts` binds it there, and `journeyScan.ts` is an `AxeBuilder`
      // call that only a browser can make. What is left — `scan.ts`,
      // `hazards.ts`, `strategies.ts`, `states.ts` — is covered by this run.
      'a11y/**/*.spec.ts',
      'a11y/page.ts',
      'a11y/server.ts',
      'a11y/journeyScan.ts',
      // The same argument once more for the visual comparator: `subject.ts`
      // is a string of HTML rendered by a browser in another process,
      // `server.ts` binds it there, and `capture.ts` is a `page.screenshot`
      // call only a browser can make. What is left — `changes.ts`,
      // `wirings.ts`, `lifecycle.ts` and `fixture/pixel.ts` — is covered by
      // this run.
      'visual/**/*.spec.ts',
      'visual/subject.ts',
      'visual/server.ts',
      'visual/capture.ts',
      // And once more for `trace/`: `check.ts` spawns Playwright twice and
      // reads the filesystem, so nothing in this run executes a line of it.
      // What is left — `zip.ts`, `channels.ts`, `faults.ts`, `evidence.ts`,
      // `retention.ts` and `subject.ts`'s renderer — is covered here.
      'trace/**/*.spec.ts',
      'trace/server.ts',
      'trace/check.ts',
      // And once more for `impact/`: the fixture is copied, faulted and run by
      // fourteen subprocesses, so nothing in this run executes a line of it,
      // and `check.ts` reads a git diff and the filesystem. What is left — the
      // diff parser, the graph, the triggers, the edges, the selector and the
      // scorer — is covered here.
      'impact/fixture/**',
      'impact/.runs/**',
      'impact/check.ts',
      'impact/run.ts',
    ],
  },
} satisfies ViteUserConfig['test']

export default defineConfig({
  test: UNIT_TEST_CONFIG,
  resolve: { alias: REPO_ALIAS },
})
