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
| TDD katas (worked step by step) | `tdd/` |
| Outside-in vs classicist TDD | `tdd/schools/` |
| Test doubles: dummy, stub, spy, mock, fake | `tdd/doubles/` |
| Suite shape: pyramid vs honeycomb, with a CI-enforced ratio | `shape/` |
| Snapshot policy: what deserves one, with a registry gate | `snapshot/` |
| Fuzzing parsers and validators: oracles, generators, and a replayable corpus | `fuzz/` |

## Quick Start

```bash
git clone https://github.com/Kojo-Brown/boilerplate-testing.git
cd boilerplate-testing
pnpm install
pnpm test          # run all unit tests
pnpm test:e2e      # run Playwright
```

## Patched dependencies

`pnpm install` applies `patches/storybook@10.5.5.patch`. Storybook registers its
TypeScript config loader with `module.register()`, which Node 26 deprecates
(DEP0205), so `pnpm build` throws under the `--throw-deprecation` flag every CI
gate runs with. The patch forward-ports the upstream fix
([storybookjs/storybook#35337](https://github.com/storybookjs/storybook/pull/35337))
and should be deleted once that ships. `workflow-templates/patchedDeps.ts`
audits the pin as a unit test, so the patch cannot go missing or drift off its
version unnoticed.

## Spec Progress
See [SPEC.md](./SPEC.md).
