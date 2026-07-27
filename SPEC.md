# Spec: boilerplate-testing

> Patterns and utilities for testing TypeScript full-stack apps. Spec-driven.

## Phase 0 — Green Baseline (blocks all feature work)
- [ ] Verify every dependency version actually exists on the registry and fix the ones that do not, then commit a lockfile
- [ ] Get `install`, `typecheck`, `lint`, `test`, and `build` all passing locally from a clean clone
- [ ] Promote `workflow-templates/ci.yml` to `.github/workflows/ci.yml` and confirm it runs green on a PR
- [ ] Add a CI job matrix covering the supported Node version and fail the build on any warning

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
