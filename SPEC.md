# Spec: boilerplate-testing

> Patterns and utilities for testing TypeScript full-stack apps. Spec-driven.

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
- [ ] Auth fixture: `test.extend` with pre-authenticated `page`
- [ ] Page Object Model: `LoginPage`, `DashboardPage`, `FormPage`
- [ ] Visual regression: `expect(page).toHaveScreenshot()`

## Phase 4 — API Testing
- [ ] Supertest helpers for Express/NestJS: `createTestApp`, typed request builder
- [ ] Prisma test isolation: `beforeEach` truncate via `$transaction`
- [ ] Seed factories with `@faker-js/faker` + `prisma-factory`
- [ ] Contract testing example with Pact

## Phase 5 — Performance & Load
- [ ] k6 load test script template (ramp-up, steady, ramp-down)
- [ ] Lighthouse CI integration with budget assertions
- [ ] Bundle size regression check (bundlesize)

## Phase 6 — CI Patterns
- [ ] GitHub Actions: parallel matrix for unit / e2e / coverage
- [ ] Flaky test retry config + quarantine strategy
- [ ] Codecov integration + coverage badge
