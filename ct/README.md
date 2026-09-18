# Component testing in a real browser, alongside end-to-end

> `@playwright/experimental-ct-react` — mounting one component in Chromium,
> next to the same component under Testing Library in jsdom.

```bash
pnpm test:ct                       # the component suite, in a browser
pnpm test:ct --ui                  # the same suite, with Playwright's UI
pnpm test ct/                      # the jsdom half of the comparison
pnpm test:e2e                      # the application suite (needs an app)
```

## The question this answers

A component suite has three places to run, and the usual reason to pick one is
habit. They differ on exactly one thing — how much of a browser is present —
and that decides which assertions are *possible*, not merely which are
convenient:

| | Renders in | Layout | Can assert | Cost per test |
|---|---|---|---|---|
| Testing Library (`react/`) | jsdom, in-process | none | markup, roles, state, events | ~1ms |
| **Playwright CT (this directory)** | **Chromium, no application** | **real** | **the above, plus anything the engine decides** | **~300ms** |
| Playwright e2e (`playwright/`) | Chromium, real application | real | the above, plus routing, data and the server | seconds |

The middle row is not "a slower jsdom". It is the only row that can answer a
question about *rendering*, and this directory exists to make that concrete
rather than to assert it. Both components here are paired with a
`*.jsdom.test.tsx` that asks jsdom the same question and records the answer it
gives.

## The two components, and what jsdom answers

**[`OverflowTooltip`](./components/OverflowTooltip.tsx)** offers a `title` only
when its text is actually clipped — `scrollWidth > clientWidth`, re-measured
through a `ResizeObserver`. Both numbers come from layout.

| Asked | Chromium says | jsdom 26.1 says |
|---|---|---|
| Width of 59 characters at `16px monospace` | 568px | 0 |
| Width of its 120px box | 120px | 0 |
| Is it clipped? | yes, by 448px | no |
| `ResizeObserver` | fires on every box change | not defined at all |

**[`ConfirmButton`](./components/ConfirmButton.tsx)** puts a destructive action
behind a native `<dialog>` opened with `showModal()`.

| Asked | Chromium says | jsdom 26.1 says |
|---|---|---|
| `dialog.showModal` | opens it in the top layer | `undefined` |
| Focus when it opens | moves to Cancel | nothing opened |
| Escape | fires `cancel`, closes, restores focus to the trigger | — |
| The trigger behind it | unreachable; the backdrop takes the click | — |
| Tab past the last control | stays inside the dialog | — |

Every "jsdom says" cell above is measured by a test in this directory, not
quoted from a changelog. That is deliberate: if a future jsdom implements
layout or `showModal`, those tests fail and the table gets corrected instead of
quietly becoming false. The direction of the failures is what matters —
**jsdom's answers are wrong in the direction that looks fine**. A tooltip that
never appears and a dialog that never opens both pass a suite that asserts
their absence.

## When *not* to reach for a component test

Most of the time. A component test costs ~300× a jsdom one and needs a browser
on the machine; the point of the table above is that a small number of
behaviours are undecidable without one, not that rendering in a browser is
better. Use Testing Library until an assertion is about something the engine
decides — layout, the top layer, focus order, scroll, media queries, real CSS
— and use an end-to-end test when the assertion is about the application:
routing, data, or what the server said.

The census in [`shape/`](../shape/README.md) classifies these specs as `e2e`
for that reason: the boundary crossed is a browser process, at the same cost
and the same rank as the application suite. It is the one classification in
that table where the resource and the layer name disagree — there is no
application — and `shape/README.md` records why a fourth layer was not
introduced for it.

## How it is wired

- **`playwright-ct.config.ts`** — a second Playwright config, separate from the
  repository root's. Component testing installs a Vite server, a `mount`
  fixture and a component registry; the application suite should not pay for
  them, and `pnpm test:e2e` should not try to bundle anything.
- **`index.html` + `index.tsx`** — the page components are mounted into, and
  the `beforeMount` hook, which is where an application's providers go. This is
  the component-test counterpart of
  [`react/renderWithProviders`](../react/renderWithProviders.tsx).
- **`testMatch: '**/*.spec.tsx'`** — so `*.jsdom.test.tsx` beside it stays with
  `pnpm test`. `vitest.config.ts` excludes the mirror image. Both halves of the
  comparison live in this directory and neither runner claims the other's.
- **CI** — the `component` job in `.github/workflows/ci.yml`, on one Node
  major, with `playwright install --with-deps chromium`. Required, not
  advisory.

## Four things that cost an afternoon

**A component defined in the spec file cannot be mounted.** Playwright's plugin
statically collects imported components and replaces them with registry
lookups, so a function declared next to the test is not a component it knows
about. Everything mounted here is imported from `./components/`.

**`beforeMount` must return the component as the root element.** Wrapping
`<App />` in a layout `<div>` changes what `mount()` resolves to: the locator
every spec then holds is the wrapper, and `component.evaluate(el => el.scrollWidth)`
silently measures a div nobody wrote. Page-level styling belongs in
`index.html`, which is where the typography these specs measure against is set
— a `system-ui` default resolves to a different face per platform, and the
overflow assertions would then be a font test.

**Function props are remote handles.** `onConfirm={() => log.push('confirm')}`
does not run in the browser: the component calls a proxy, Playwright ships the
call back, and the closure runs in the test process. It is a round trip, so the
recording is read through `expect.poll` rather than asserted on the next line.
Serializable props cross the same way, which is why a prop carrying a class
instance or a DOM node does not work.

**Vite 8 is not optional.** `@playwright/experimental-ct-core@1.62.1` depends on
`vite@^8`, and its React plugin imports `vite/internal`, which Vite 7 does not
export. With `vite@^7` in this package's `devDependencies`, pnpm resolved the
plugin's peer to that one and `pnpm test:ct` failed before running a test:
`Package subpath './internal' is not defined by "exports"`. The repository is on
`vite@^8.3.0` for that reason; Storybook 10 and Vitest 3 both support it.
