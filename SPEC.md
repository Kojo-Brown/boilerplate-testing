# Spec: boilerplate-testing

> Patterns and utilities for testing TypeScript full-stack apps. Spec-driven.

## Phase 0 — Green Baseline (blocks all feature work)
- [x] Verify every dependency version actually exists on the registry and fix the ones that do not, then commit a lockfile — 31 of 34 ranges resolved; `@storybook/addon-essentials`, `@storybook/addon-interactions` and `@storybook/test` were all removed in Storybook 9 and had no stable 9.x, so `pnpm install` failed outright (PR #22)
- [x] Get `install`, `typecheck`, `lint`, `test`, and `build` all passing locally from a clean clone — typecheck had 15 errors behind a `baseUrl` abort, 23 of 276 tests failed, `eslint` was neither installed nor configured, and no `build` script existed (PR #22)
- [x] Promote `workflow-templates/ci.yml` to `.github/workflows/ci.yml` and confirm it runs green on a PR — green on run #1 (PR #22)
- [x] Add a CI job matrix covering the supported Node version and fail the build on any warning — `engines.node` is `^22.13.0 || ^24.0.0` (eslint 10's floor, stricter than vite's `>=22.12.0`) and the matrix mirrors it; `engine-strict`, `strict-dep-builds`, `--strict-peer-dependencies`, `--frozen-lockfile`, `--max-warnings 0` and per-step `--throw-deprecation` all make warnings fatal; green on run #1 on both legs (PR #23)
- [x] Bump the pinned Actions to their Node 24 majors — the runner emits `##[warning] Node.js 20 is deprecated` for `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` and `pnpm/action-setup@v4`, the one warning the item-4 gates cannot reach — checkout/setup-node/upload-artifact → v7, download-artifact → v8, `pnpm/action-setup` → v6, `gitleaks/gitleaks-action` → v3, each target picked by reading `runs.using` in that action's own `action.yml` at the tagged major; `codecov/codecov-action` stays at v5 (composite, no Node runtime). `workflow-templates/actionPins.{ts,test.ts}` now audits every `uses:` line in `.github/workflows/` and `workflow-templates/` against a floor table, so the drift fails `pnpm test` instead of only showing up in a runner log. Zero `##[warning]` lines in the merged run (PR #24)
- [x] Support Node 26: `supertest/createTestApp.test.ts` "builder chaining preserves immutability across multiple calls" fails with `read ECONNRESET` on Node 26.5.1 and passes on 22 and 24 — the race was supertest's, not Node's: it binds the server itself on the first request that finds it unbound and closes it again when *that* request ends, resetting siblings still in flight. `createTestApp` (and `createNestTestApp`) now bind up front so supertest never takes ownership. `engines.node` is `^22.13.0 || ^24.0.0 || ^26.0.0` and the matrix mirrors it (PR #25)
- [x] Run the `Build` CI step under `NODE_OPTIONS=--throw-deprecation` like the other gates — two deprecations were in the way. DEP0190 (Storybook 9.1.20 shelling out through execa with `shell: true` plus an argument array in `extractStorybookMetadata`) is gone with the upgrade to Storybook 10.5.5; DEP0205 (`importModule` registering the TypeScript config loader through `module.register()`), which only surfaced underneath it on Node 26, is cleared by `patches/storybook@10.5.5.patch` forward-porting the unmerged upstream fix storybookjs/storybook#35337. Dropping Node 26 from the matrix would also have made this green and was rejected. `workflow-templates/gateSteps.ts` audits that every gate keeps its `NODE_OPTIONS` block and `workflow-templates/patchedDeps.ts` audits the patch pin, so neither can go missing quietly. Green on all three legs (PR #26)

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

The upgrade option is now available and DEP0190 is gone: Storybook 10.5.5 calls
`execCommandCountLines('git', ['grep', …])` with no `shell` option at all, and
the build satisfies `--throw-deprecation` on Node 22 and 24 — verified locally
on both, with `node_modules/.cache/storybook` cleared first so the 24h
`runTelemetryOperation` cache could not mask the call (the cache is written
with `{"key":"portableStories"}`, so its presence afterwards proves the path
ran).

Clearing DEP0190 exposed a second, unrelated deprecation on the Node 26 leg,
which the flag then correctly surfaced: DEP0205, `module.register()` is
deprecated, use `module.registerHooks()`. Storybook
raises it in `importModule` (`src/shared/utils/module.ts`), which registers a
TypeScript loader hook unconditionally on the first config import — before any
config is read, so it is not avoidable by writing `.storybook/main` as
JavaScript, and it is not first-party. It is still present in `storybook@next`
(10.6.0-alpha.3), so there is no released or prereleased version to move to.
DEP0205 does not exist on Node 22 or 24, which is why the upgrade looks clean
on two of the three legs.

Dropping Node 26 from the matrix would have closed item 7 and was rejected:
`engines.node` declares 26 as supported, so excluding the leg would weaken the
gate rather than satisfy it. The upstream fix exists but is unmerged —
storybookjs/storybook#35337, open since 2026-07-01 against `next` — so item 7
is closed by forward-porting it as `patches/storybook@10.5.5.patch`: prefer
`module.registerHooks()` with a synchronous esbuild loader (`loadSync`) where
that API exists, fall back to `module.register()` on runtimes without it
(Node 22.13–22.14, still inside `engines.node`). Every leg of the matrix takes
the `registerHooks` path, so a break in it fails all three rather than only the
newest.

The patch is pinned to an exact version in `pnpm.patchedDependencies`, which
makes a Storybook bump fail the install instead of resolving a version the
patch was never written against, and `workflow-templates/patchedDeps.ts` audits
the pin as a unit test — a patch that is undocumented, unpinned, missing from
disk, or drifted off the installed version fails `pnpm test` in a second rather
than failing one CI leg three minutes later inside `node_modules`. Delete the
patch, its pin, its `PATCH_REASONS` entry and the README note together when the
upstream fix ships; the audit fails on any of them left behind.

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
- [x] TDD kata series: FizzBuzz, Bowling, Gilded Rose — one commit per red/green/refactor step — 29 step commits, each verified to be the colour it claims by running the suite before committing. A fourth phase, `pin`, was needed: the Gilded Rose starts from inherited code, and a characterisation test cannot be red without lying, so `pin` steps are allowed only before the first `red`. Because the repo squash-merges, the history is also stored as data in `tdd/katas.ts` and audited by `tdd/steps.ts` + `tdd/katas.test.ts` — every claimed test must exist on disk, every test on disk must be claimed by one step, and the phase sequence must be a legal cycle, so the record fails `pnpm test` rather than rotting (PR #27)
- [x] Outside-in (London school) vs classicist TDD compared on the same feature — one order-placing feature built twice under `tdd/schools/`, both held to a shared contract (`orderContract.ts`, 14 behaviours per school) so the comparison is falsifiable rather than two different programs. The London design ends where driving purely from the outside actually ends: six ports, no implementation of any of them, and a suite that asserts call order and counts. The classicist design is Money/Catalogue/Promotions/Inventory/pricing tested directly, assembled last, with one fake at the payment boundary. Each suite turns out to be silent exactly where its design has no code — only the mockist tests can state "reserve before charge" (a state snapshot cannot tell it from the reverse), only the classicist tests can state "never oversell, never half-reserve" and the instant a promo dies. `design.test.ts` derives the README's structural claims from the wiring the contract actually runs, so a seventh port fails `pnpm test` instead of leaving a wrong sentence in a README. 92 new tests; green on Node 22, 24 and 26 on run #1 (PR #28)
- [x] Test-double taxonomy: dummy, stub, spy, mock, fake — with a when-to-use guide — one feature (`tdd/doubles/registerUser.ts`, four collaborators) with all five kinds demonstrated against it, so every "use a stub here" is a decision somebody could have made differently. The guide's central claim — each kind sees a different class of defect — is measured, not asserted: `faults.ts` injects five bugs one at a time and `detection.test.ts` runs all five probes against all five broken systems, so the README's matrix is derived by running the code. Four of the five faults are caught by exactly one kind; the fifth by two, and the mock's detection set turns out to be a strict superset of the spy's — asserted as the matrix's only domination rather than buried, with the README arguing the half no test can settle (the same strictness breaks on changes that broke nothing). The probes live in `probes.ts` so the test a reader sees per kind is the code the matrix is measured from, and each is first shown green against the correct system. The fake is held to `userStoreContract.ts`, run against a store with one rule dropped to prove the contract has teeth; the audit log is a dummy on the self-service path and a spy on the admin path, because the kind is a property of the test, not the object. `taxonomy.test.ts` checks the README's headings, guidance sentences, module links and every matrix cell against `taxonomy.ts`. 42 new tests; green on Node 22, 24 and 26 on run #1 (PR #29)
- [x] Arrange-Act-Assert and Given-When-Then conventions with a lint-enforced naming scheme — one feature (`refundPolicy.ts`) tested twice, eight behaviours each, with `behaviours.ts` holding the exact title both sides must use so the comparison cannot quietly stop being one. The deliverable is the enforcement: a local flat-config plugin at `tdd/conventions/eslint-plugin/`. `title-scheme` runs over every test file in the repository — its default `behaviour` mode bans openers (modals, the runner's own name, meta-verbs) rather than prescribing a grammar, deliberately allowing a capitalised first word, since titles here legitimately open with `POST`, `Sulfuras` and `TypedTest.json()`; turning it on cost zero renames, because all 580 existing titles already stated what the system does and nothing was holding that. Under `scheme: 'given-when-then'` the same rule checks the sentence structure instead. `aaa-structure` requires the Act/Assert markers, in order, each occupied, and rejects any `expect(…)` before the `Assert` marker — the check that catches act-assert-act-assert bodies — and is enabled for `tdd/conventions/` only, since retrofitting markers onto the other 40 test files would rewrite every body in the repo to make a point about comments. `conventions.test.ts` runs the repository's *real* ESLint config over deliberately bad snippets, so a rule wired to nothing fails `pnpm test` rather than passing silently; emptying the config block and renaming a case were both verified to turn it red. The README's counts are parsed out of `gwt.test.ts` and became the honest argument against the shape it documents: 5 `Given` and 8 `When` blocks wrap 8 cases, and every `When` block holds exactly one. `engines.node` 22 floor moves to `^22.18.0` (Node resolves the plugin's TypeScript import itself) and `tsconfig.json` gains `noEmit` + `allowImportingTsExtensions`. 77 new tests; green on Node 22, 24 and 26 on run #1 (PR #30)
- [x] Characterisation tests for legacy code before refactoring — the Gilded Rose pins by hand, ten examples chosen by eye; `tdd/characterisation/` is the same move at a size where that stops working. One inherited invoicing function (`legacy/renewal.ts`: a mutable module-level tax table, `new Date()` and `Math.random()` inline, a write-back onto its own argument) whose documentation is wrong in five places, all five of them somebody's bill. The deliverable is the measurement rather than the tidier code: ten single behaviour changes are applied to the *real* source — string edits asserted to match exactly once, compiled and loaded through Node's own type stripping, so the mutants cannot rot away from the file they mutate — and three suites are run against all ten. A specification suite of 18 behaviours read carefully out of the docs stops 1; the golden master watching the returned invoice stops 8; the golden master watching every visible effect stops 10. Six of the ten changes are the code being brought into line with its own documentation, which is the point: every one would pass review. The specification suite's single catch is an accident — the docs say nothing about rounding, but asserting on a worked example means writing a number down, and 7.25% of 90 is 6.525. Corpus adequacy is a closed loop rather than a claim: 21 branch labels declared in the source, read back out of it by regex, and every one reached by a case. The recording carries a fingerprint over every input, so trimming the cases a change happens to break fails instead of passing. `seams.test.ts` substitutes the globals themselves to prove the one edit made before any test existed is a no-op when omitted, and `detection.test.ts` compiles the source unedited as a control first, because a pipeline that changed behaviour by itself would make every column look perfect. Four ways of cheating were each verified to turn the suite red. JSON cannot write down `-0` and the corpus produces one, so `observe.ts` normalises it and states the cost rather than hiding it. 101 new tests; green on Node 22, 24 and 26 on run #1 (PR #31)
- [x] The test pyramid vs the honeycomb: a documented ratio policy with CI enforcement — a ratio is only as honest as the thing it counts, and "unit test" is the vaguest word in testing, so `shape/` derives both halves instead of declaring either. A test's layer is the widest boundary it can *reach*, transitively: `boundaries.ts` is a closed table of every external module reachable from a test file, and an unclassified one fails rather than passing, because the alternative is silent and one-directional — add a dependency that opens a socket and every test reaching it keeps counting as a unit test, so the ratio improves on paper exactly when the suite gets slower. The gate caught that on itself; adding `@typescript-eslint/parser` failed `pnpm test` until it was classified. Keys are `module#Binding` where a package disagrees with itself: `eslint#ESLint` reads real config and paths, `eslint#RuleTester` lints strings in memory, and bare `eslint` is deliberately absent so a namespace import has to pick a side. Transitivity is load-bearing rather than decorative — `playwright/auth.spec.ts` reaches the browser through a barrel and a fixture, and a direct-import scan calls it a unit test. Counts come from `vitest list` and `playwright test --list`, not from the source, because a static count lands 19% low and unevenly: `RuleTester` generates 18 tests from no `it(` at all, `orderContract.test.ts` yields 28 from a contract invoked once per school, `k6/config.test.ts` builds 53 in a loop. Every one of those under-counts a file that is *also* integration, so a static census would have reported a tidier pyramid than the one that exists. Measured 61.5% unit / 32.8% integration / 5.7% e2e over 899 tests: the ordering is a pyramid, but it sits **outside** the textbook 10–30% middle band, and that is recorded as the finding rather than sized around — a pattern library that demonstrates boundary-crossing and audits itself by reading its own files has a legitimately fatter middle. Bands 55–80 / 15–40 / 2–10, with the e2e ceiling held at the textbook 10% because 12% let a doubled Playwright suite pass, which makes a ceiling decorative. Both headroom figures the PR first claimed were wrong and the tests found them: the 12% ceiling did not refuse a doubling, and the integration figure was computed as if bands did not interact — adding integration tests dilutes unit's share, so the unit floor binds at 401 while the integration ceiling would not bind until 402. Enforcement is split by cost: the classification runs in `pnpm test` (cheap, and the half with the silent failure mode), the ratio is `pnpm shape:check` as its own CI step, added to `GATED_SCRIPTS` so it cannot lose its `--throw-deprecation` block quietly. Verified to fail as well as pass — a 25% ceiling exits 1 naming the 32.8%. 93 new tests; green on Node 22, 24 and 26 on run #1 (PR #32)

Known gaps carried into Phase 8: the ratio counts tests, not seconds, and the
two come apart badly here — those 51 e2e declarations are 274 browser
executions across the six-project Playwright matrix, so a suite can satisfy
every band and still spend most of its wall clock at the top. A time budget is
the harder gate and is not built. Nothing in `shape/` says the tests are any
good; a pyramid of vacuous unit tests passes every check.
`pact/provider/users.provider.pact.verify.test.ts` collects zero tests unless
`PROVIDER_BASE_URL` is set and is the single entry in `EXPECTED_EMPTY`.

## Phase 8 — Advanced Correctness
- [x] Property-based testing with fast-check: invariants, shrinking, and custom arbitraries — twenty properties over one system (`property/availability.ts`, sets of half-open ranges) in three families, and the finding is that the predicates are the part that barely matters. Four of the five probes run the *same twenty invariants* and differ in nothing but the generator; they catch 4, 6, 7 and 10 of ten faults. `sparse` — integers across a decade of minutes, the choice a person makes without thinking — collides in 2.6% of scenarios, so the merging logic the system mostly consists of is barely executed while two hundred runs pass, and nothing in the output distinguishes uninformative from correct. `wide` overlaps *more* than the bounded arbitrary, not less, because `fc.double` draws across the bit-pattern space and comes back crowded with denormals near zero — and never produces two equal endpoints, so it is the one probe blind to `TOUCHING_NOT_MERGED`. `clustered` draws one origin and one grid spacing for the whole scenario and distributes them by `map`, which is what makes exact touching possible over floats. The textbook advice "build values, never filter them" is measured (46.4% yield naive, 1 in 1,000 for a sorted disjoint set, `.filter` silently paying ~1,000 draws per value where `fc.pre` fails outright) and so is its unadvertised cost: a generator that cannot produce an invalid range cannot produce a degenerate one, so three of the four arbitraries never reach `normalise`'s empty-dropping branch at all. Shrinking is measured against a real bug with `endOnFailure` as the control: 734 → 8 in 62 steps, reduced to `[[0, 3), [1, 2)]`, the minimal statement of the bug; the same values behind `fc.constantFrom` shrink 826 → 826 in zero steps. The example-suite comparison is reported as circular rather than as a result — 24 examples and 10 faults from one person's list agree by construction — and the measurement without that loop is `coverage.ts`: eight structural situations, twenty-eight pairs, counted over each probe's real inputs. The examples reach more *situations* than the bounded arbitrary and **one pair** in the whole corpus, which is what writing examples by hand is. Faults are flags on one shared implementation, not copies, and `faults.test.ts` pins the all-correct variant to `availability.ts` over 2,000 scenarios so the corpus cannot drift. `NUM_RUNS` 200 is measured at the edge (8/9/9/10 at 25/50/100/200) and `fast-check` is pinned exactly, because a seed only reproduces against the generator that produced it and every figure above is a property of that seed. 224 new tests; green on Node 22, 24 and 26 on run #1 (PR #33)
- [x] Mutation testing with Stryker across unit suites + a score gate in CI — coverage says a line ran and cannot say whether anything asserted on the result; `mutation/` measures the second thing over four modules (257 mutants, 87.55%, 2m54s) and gates on it. The scope is a closed table with a floor per module because mutation testing is minutes where every other gate here is seconds, and a gate nobody waits for acquires `continue-on-error: true`; `stryker.config.ts` derives `mutate` from that table and `policy.ts` fails a run for a module with no row *and* a row with no floor. Which **suites** run is derived instead, by `reach.ts` over the same import walk `shape/classify.ts` does — a scoped run's one way to report a badly wrong number is to load too few, since every mutant only the missing suite would have caught then reads as a survivor: the three suites a person would list for `property/availability.ts` score it 81.05%, the nine the graph finds score it 83.66%. What the floors actually catch was measured rather than assumed and is narrower than the folklore — deleting an assertion, a whole test, a whole behaviour from *both* suites testing it, or one of two redundant suites entirely each moved the score by **zero**, while eight lines of untested code took `factories/defineFactory.ts` from 100.00% to 58.33%, through its floor, with its *covered* score still reading 100.00% (which is why the gate uses the total). Two findings the suites could not state about themselves: over the same 153 mutants the 20 fast-check invariants kill 99 and the 24 hand-written examples kill 101, agreeing on 92 — the non-circular version of the comparison `property/README.md` reports as circular — and the AAA and GWT suites cover exactly the same 46 mutants with none to either, each scoring 96.00% alone, so a mutant cannot tell the conventions apart. Attribution is built on `coveredBy`, not `killedBy`, which names whichever test was scheduled first under bail; the complete kill sets cost 7m54s for one module against 2m54s for the whole gate. Three things had to be fixed that fail illegibly: Stryker's plugin glob comes back empty under pnpm and blames the install, the sandbox copy made this repository's own `vitest/` directory shadow the `vitest` package so every worker died in the dry run naming neither, and a sandbox left behind by a crashed run doubles the shape census, double-checks every file in `tsc`, and makes ESLint refuse to lint anything at all. Its own CI job on one Node major, since a mutation score is a property of the tests rather than the runtime; `mutation:check` joins `GATED_SCRIPTS`. Green on run #1 (PR #34)
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
