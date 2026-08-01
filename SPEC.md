# Spec: boilerplate-testing

> Patterns and utilities for testing TypeScript full-stack apps. Spec-driven.

## Phase 0 — Green Baseline (blocks all feature work)
- [x] Verify every dependency version actually exists on the registry and fix the ones that do not, then commit a lockfile — 31 of 34 ranges resolved; `@storybook/addon-essentials`, `@storybook/addon-interactions` and `@storybook/test` were all removed in Storybook 9 and had no stable 9.x, so `pnpm install` failed outright (PR #22)
- [x] Get `install`, `typecheck`, `lint`, `test`, and `build` all passing locally from a clean clone — typecheck had 15 errors behind a `baseUrl` abort, 23 of 276 tests failed, `eslint` was neither installed nor configured, and no `build` script existed (PR #22)
- [x] Promote `workflow-templates/ci.yml` to `.github/workflows/ci.yml` and confirm it runs green on a PR — green on run #1 (PR #22)
- [x] Add a CI job matrix covering the supported Node version and fail the build on any warning — `engines.node` is `^22.13.0 || ^24.0.0` (eslint 10's floor, stricter than vite's `>=22.12.0`) and the matrix mirrors it; `engine-strict`, `strict-dep-builds`, `--strict-peer-dependencies`, `--frozen-lockfile`, `--max-warnings 0` and per-step `--throw-deprecation` all make warnings fatal; green on run #1 on both legs (PR #23)
- [x] Bump the pinned Actions to their Node 24 majors — the runner emits `##[warning] Node.js 20 is deprecated` for `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` and `pnpm/action-setup@v4`, the one warning the item-4 gates cannot reach — checkout/setup-node/upload-artifact → v7, download-artifact → v8, `pnpm/action-setup` → v6, `gitleaks/gitleaks-action` → v3, each target picked by reading `runs.using` in that action's own `action.yml` at the tagged major; `codecov/codecov-action` stays at v5 (composite, no Node runtime). `workflow-templates/actionPins.{ts,test.ts}` now audits every `uses:` line in `.github/workflows/` and `workflow-templates/` against a floor table, so the drift fails `pnpm test` instead of only showing up in a runner log. Zero `##[warning]` lines in the merged run (PR #24)
- [x] Support Node 26: `supertest/createTestApp.test.ts` "builder chaining preserves immutability across multiple calls" fails with `read ECONNRESET` on Node 26.5.1 and passes on 22 and 24 — the race was supertest's, not Node's: it binds the server itself on the first request that finds it unbound and closes it again when *that* request ends, resetting siblings still in flight. `createTestApp` (and `createNestTestApp`) now bind up front so supertest never takes ownership. `engines.node` is `^22.13.0 || ^24.0.0 || ^26.0.0` and the matrix mirrors it (PR #25)
- [ ] Run the `Build` CI step under `NODE_OPTIONS=--throw-deprecation` like the other gates — blocked on Storybook 9.1.20 throwing DEP0190 from `extractStorybookMetadata`

Phase 0 items 1-3 complete as of PR #22 (2026-07-31): install (frozen lockfile),
typecheck, lint (0 errors, 0 warnings), 292 unit tests across 11 files, and
build all green in CI on Node 22.

Items 1-3 landed as one PR because they are circularly dependent — CI cannot be
green before the gates pass, the gates cannot be observed before install works,
and nothing may merge before CI exists. Three earlier runs each did item 1 alone
and correctly stopped at the unmergeable draft stage (PRs #20, #21, #22).

The ignored-build-scripts warning flagged against item 4 (`@swc/core`,
`esbuild`, `msw`) is resolved: all three are triaged into
`pnpm.onlyBuiltDependencies`, and `.npmrc` sets `strict-dep-builds=true` so the
next dependency that ships a postinstall fails the install instead of adding a
line to the warning list.

Item 5 closed the last warning class the item-4 gates could not reach. The
`Node.js 20 is deprecated` notice is emitted by the *runner*, about the
workflow, before any step of ours executes, so no gate running inside the job
can observe it — which is why it survived item 4 despite that item making every
other warning fatal. The pins now sit on majors whose `action.yml` declares
`runs.using: node24`, and `workflow-templates/actionPins.ts` turns the audit
into a unit test: it parses every `uses:` line under `.github/workflows/` and
`workflow-templates/` and checks the pinned major against a recorded floor. An
action absent from that floor table fails rather than passes, so adding one
forces its runtime to be classified. The merged run emitted no `##[warning]`
lines at all.

Node 26 is the reason item 6 existed rather than being folded into the item 4
matrix. The failure reproduced in five lines with no code from this repo — two
concurrent requests through one `supertest.agent(server)` against a
non-listening `http.Server` — and the predicted fix was the right one, though
the diagnosis was not: it is not Node server-lifecycle behaviour that changed
between 24 and 26. `supertest@7.2.2` binds the server itself on the first
request that finds it unbound (`lib/test.js#serverAddress`) and closes that
same server when *that* request ends (`#end`), so the first response tears the
listener down under a sibling's open socket. Node 26 only changed the timing
that used to hide the reset.

`createTestApp` and `createNestTestApp` therefore bind to an ephemeral port up
front, so `address()` is never null and supertest never assigns `this._server`.
Lifetime moved to `TestApp.close()` — one listener per TestApp instead of one
per request. `listen()` takes no host argument on purpose: passing one routes
through `dns.lookup()`, which would make `createTestApp` async. As predicted,
this changes the documented contract ("the server does **not** need to be
listening"); a caller-bound server is reused as-is. Node 26 is now in
`engines.node` and in the CI matrix, so the regression is caught by the gates.

Item 7 exists because `--throw-deprecation` is enforced on typecheck, lint and
test but not on build. Storybook 9.1.20 counts portable-stories files by
shelling out through execa with `shell: true` plus an argument array, which is
DEP0190 on Node 24+; it runs during post-build metadata extraction, so
`storybook build` exits 7 with `storybook-static/` already complete. It is not
reachable from first-party code, `--disable-telemetry` does not skip it (the
metadata is computed for the build, not only for telemetry), and Storybook's
own cache hides it on a warm `node_modules` — which is why it shows up only on
a clean install, i.e. only in CI. Options are a Storybook upgrade once upstream
stops passing an args array with `shell: true`, or dropping the portable-stories
count. Both are larger than a CI change.

Known gaps still carried forward: Playwright E2E is not wired into CI — the
specs target a running app at `PLAYWRIGHT_BASE_URL` and this repo ships none, so
the template's e2e matrix was deliberately left out of the promoted workflow.
Prettier is not gated; there is no `format:check` script.

## Phase 1 — Unit Testing (Jest + Vitest)
- [x] Vitest config with coverage (v8), jsdom environment, path aliases
- [x] Jest config for Node.js backend testing (NestJS / Express)
- [x] Custom matchers: `toMatchResponse`, `toBeValidJwt`, `toBeISO8601`
- [x] Async test utilities: `waitForCondition`, `flushPromises`, `eventually`

## Phase 2 — Component Testing
- [x] Testing Library patterns: render helpers, custom `renderWithProviders`
- [x] MSW 2 handler library: auth, users, pagination
- [x] Storybook 9 interaction tests
- [x] Accessibility: `@axe-core/react` + automated WCAG checks

## Phase 3 — E2E Testing (Playwright)
- [x] Playwright config: multi-browser, CI mode, trace on failure
- [x] Auth fixture: `test.extend` with pre-authenticated `page`
- [x] Page Object Model: `LoginPage`, `DashboardPage`, `FormPage`
- [x] Visual regression: `expect(page).toHaveScreenshot()`

## Phase 4 — API Testing
- [x] Supertest helpers for Express/NestJS: `createTestApp`, typed request builder
- [x] Prisma test isolation: `beforeEach` truncate via `$transaction`
- [x] Seed factories with `@faker-js/faker` + `prisma-factory`
- [x] Contract testing example with Pact

## Phase 5 — Performance & Load
- [x] k6 load test script template (ramp-up, steady, ramp-down)
- [x] Lighthouse CI integration with budget assertions
- [x] Bundle size regression check (bundlesize)

## Phase 6 — CI Patterns
- [x] GitHub Actions: parallel matrix for unit / e2e / coverage
- [x] Flaky test retry config + quarantine strategy
- [x] Codecov integration + coverage badge

## Phase 7 — TDD Discipline
- [ ] TDD kata series: FizzBuzz, Bowling, Gilded Rose — one commit per red/green/refactor step
- [ ] Outside-in (London school) vs classicist TDD compared on the same feature
- [ ] Test-double taxonomy: dummy, stub, spy, mock, fake — with a when-to-use guide
- [ ] Arrange-Act-Assert and Given-When-Then conventions with a lint-enforced naming scheme
- [ ] Characterisation tests for legacy code before refactoring
- [ ] The test pyramid vs the honeycomb: a documented ratio policy with CI enforcement

## Phase 8 — Advanced Correctness
- [ ] Property-based testing with fast-check: invariants, shrinking, and custom arbitraries
- [ ] Mutation testing with Stryker across unit suites + a score gate in CI
- [ ] Snapshot testing policy: what deserves a snapshot and how to stop rubber-stamping them
- [ ] Fuzz testing for parsers and validators
- [ ] Deterministic time and randomness: fake timers, injected clocks, seeded RNG
- [ ] Concurrency testing: race detection and deterministic async scheduling

## Phase 9 — Integration & Contracts
- [ ] Testcontainers: Postgres, Redis, and Kafka spun up per suite with reuse
- [ ] Consumer-driven contract tests with Pact broker publish/verify in CI
- [ ] OpenAPI schema-conformance tests asserting responses match the spec
- [ ] Database test isolation strategies compared: truncate, transaction rollback, template DB
- [ ] Idempotency and retry-safety test harness for HTTP handlers
- [ ] Ephemeral per-PR environments with seeded data and automatic teardown

## Phase 10 — E2E Depth
- [ ] Playwright component testing alongside full E2E
- [ ] Network interception, HAR replay, and offline-mode simulation
- [ ] Cross-browser + mobile-emulation matrix with sharding
- [ ] Accessibility assertions inside E2E journeys (axe per page)
- [ ] Visual regression with masking, tolerance tuning, and a review workflow
- [ ] Trace-viewer-driven debugging guide for CI failures
- [ ] Auth state reuse via storage state with per-worker isolation

## Phase 11 — Performance & Reliability
- [ ] k6 scenarios: smoke, load, stress, soak, spike — with pass/fail thresholds
- [ ] Lighthouse CI budgets wired to a PR comment
- [ ] Flake detection: rerun analytics, quarantine automation, and a flakiness dashboard
- [ ] Test-impact analysis to run only suites affected by a diff
- [ ] Chaos testing: fault injection for latency, errors, and dependency outages
- [ ] CI test-time budget with a regression gate
