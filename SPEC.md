# Spec: boilerplate-testing

> Patterns and utilities for testing TypeScript full-stack apps. Spec-driven.

## Phase 0 — Green Baseline (blocks all feature work)
- [x] Verify every dependency version actually exists on the registry and fix the ones that do not, then commit a lockfile — 31 of 34 ranges resolved; `@storybook/addon-essentials`, `@storybook/addon-interactions` and `@storybook/test` were all removed in Storybook 9 and had no stable 9.x, so `pnpm install` failed outright (PR #22)
- [x] Get `install`, `typecheck`, `lint`, `test`, and `build` all passing locally from a clean clone — typecheck had 15 errors behind a `baseUrl` abort, 23 of 276 tests failed, `eslint` was neither installed nor configured, and no `build` script existed (PR #22)
- [x] Promote `workflow-templates/ci.yml` to `.github/workflows/ci.yml` and confirm it runs green on a PR — green on run #1 (PR #22)
- [ ] Add a CI job matrix covering the supported Node version and fail the build on any warning
- [ ] Support Node 26: `supertest/createTestApp.test.ts` "builder chaining preserves immutability across multiple calls" fails with `read ECONNRESET` on Node 26.5.1 and passes on 22 and 24
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

Node 26 is the reason item 5 exists rather than being folded into the item 4
matrix. The failure reproduces in five lines with no code from this repo — two
concurrent requests through one `supertest.agent(server)` against a
non-listening `http.Server` — so it is upstream server-lifecycle behaviour that
changed between 24 and 26, not a flaky assertion. The likely fix is for
`createTestApp` to bind its own listening server (`server.listen(0)`) so
supertest stops managing an ephemeral one per request and closing it out from
under an in-flight sibling. That changes `createTestApp`'s documented contract
("the server does **not** need to be listening"), which is a deliberate design
decision and not something to smuggle into a CI change.

Item 6 exists because `--throw-deprecation` is enforced on typecheck, lint and
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
