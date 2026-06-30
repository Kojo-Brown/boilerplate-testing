# boilerplate-testing

> Jest · Vitest · Playwright · MSW · Testing Library · k6

Copy-paste testing patterns for TypeScript full-stack apps.

## What's here

| Pattern | Where |
|---------|-------|
| Vitest config (frontend) | `vitest/vitest.config.ts` |
| Jest config (backend) | `jest/jest.config.ts` |
| MSW handler library | `msw/handlers/` |
| Playwright config + POM | `playwright/` |
| Testing Library utilities | `react/renderWithProviders.tsx` |
| k6 load test template | `k6/load-test.js` |
| Custom matchers | `matchers/` |
| Seed factories | `factories/` |

## Quick Start

```bash
git clone https://github.com/Kojo-Brown/boilerplate-testing.git
cd boilerplate-testing
pnpm install
pnpm test          # run all unit tests
pnpm test:e2e      # run Playwright
```

## Spec Progress
See [SPEC.md](./SPEC.md).
