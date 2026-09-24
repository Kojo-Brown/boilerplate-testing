# Accessibility assertions inside E2E journeys

`axe per page` is the phrase, and the implementation it produces is two lines in
a loop over the application's URLs:

```ts
for (const path of PATHS) {
  test(`${path} is accessible`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
}
```

Against a journey with twelve real accessibility defects in it, that suite
**finds one**, and passes.

This directory is the measurement behind that sentence. [`page.ts`](./page.ts)
is a small two-view application with twelve defects planted in it, each one the
careless spelling of something real and each one placed in a specific state of
the journey. [`journey.spec.ts`](./journey.spec.ts) runs five ways of scanning it
against Chromium and records what each finds. Nothing below was written from
documentation: the verdict column is re-derived on every run, and two of its four
values were not what the first draft of this directory predicted.

## The journey and what is wrong with it

Six states, in the order the journey reaches them. Only the first is a state a
navigation produces — everything else needs a click, a failed submit or a route
change.

| hazard | state | WCAG | axe rule | verdict |
| --- | --- | --- | --- | --- |
| `muted-contrast` | `landing-load` | 1.4.3 Contrast (Minimum) | `color-contrast` | `violation` |
| `icon-target-size` | `landing-load` | 2.5.8 Target Size (Minimum) | `target-size` | `disabled` |
| `list-img-alt` | `landing-settled` | 1.1.1 Non-text Content | `image-alt` | `violation` |
| `dialog-unnamed` | `dialog-open` | 4.1.2 Name, Role, Value | `aria-dialog-name` | `violation` |
| `background-hidden-focusable` | `dialog-open` | 4.1.2 Name, Role, Value | `aria-hidden-focus` | `incomplete` |
| `dialog-focus-not-moved` | `dialog-open` | 2.4.3 Focus Order | — | `none` |
| `name-describedby-dangling` | `validation-error` | 1.3.1 Info and Relationships | `aria-valid-attr-value` | `incomplete` |
| `email-error-unassociated` | `validation-error` | 3.3.1 Error Identification | — | `none` |
| `error-not-announced` | `validation-error` | 3.3.1 Error Identification | — | `none` |
| `toast-inserted-with-content` | `toast` | 4.1.3 Status Messages | — | `none` |
| `route-focus-not-moved` | `route-changed` | 2.4.3 Focus Order | — | `none` |
| `fake-button-keyboard` | `route-changed` | 2.1.1 Keyboard | — | `none` |

The `verdict` column is the interesting one, because "axe finds it or it does
not" turns out to be four distinct things rather than two:

- **`violation`** — axe reports it where everybody looks. Three of twelve.
- **`incomplete`** — axe noticed, and declined to decide. Two of twelve.
- **`disabled`** — a rule exists and does not run. One of twelve.
- **`none`** — axe has no rule and cannot have one. **Six of twelve.**

## What each way of scanning finds

| strategy | what it does | score |
| --- | --- | --- |
| `per-page-on-load` | goto each URL, analyze() at once, assert violations is empty | **1 / 12** |
| `per-page-settled` | the same, after waiting for the page’s data to arrive | **2 / 12** |
| `per-state` | drive the journey, analyze() in every state it passes through | **3 / 12** |
| `per-state-full-axe` | per-state, plus the disabled rules turned on and incomplete treated as failure | **6 / 12** |
| `per-state-and-journey` | everything above, plus assertions about focus, announcement and the keyboard | **12 / 12** |

Each rung undoes exactly one mechanism, so the column reads as a cost rather
than a menu. The full grid:

| hazard | `per-page-on-load` | `per-page-settled` | `per-state` | `per-state-full-axe` | `per-state-and-journey` |
| --- | --- | --- | --- | --- | --- |
| `muted-contrast` | found | found | found | found | found |
| `icon-target-size` | · | · | · | found | found |
| `list-img-alt` | · | found | found | found | found |
| `dialog-unnamed` | · | · | found | found | found |
| `background-hidden-focusable` | · | · | · | found | found |
| `dialog-focus-not-moved` | · | · | · | · | found |
| `name-describedby-dangling` | · | · | · | found | found |
| `email-error-unassociated` | · | · | · | · | found |
| `error-not-announced` | · | · | · | · | found |
| `toast-inserted-with-content` | · | · | · | · | found |
| `route-focus-not-moved` | · | · | · | · | found |
| `fake-button-keyboard` | · | · | · | · | found |

### What the tables say

**The canonical implementation scores 1 of 12, and the reason is arithmetic
rather than bad luck.** Ten of the twelve defects are in states no navigation
produces, and of the two that are in the served document, one needs a rule that
is switched off. What is left is a single contrast failure in a header. A suite
built this way is not weak at finding accessibility defects in a journey; it is
structurally unable to look at a journey at all, because `goto` is the only verb
it has.

**`incomplete` is not a synonym for "no problem", and the assertion everybody
writes throws it away.** `expect(results.violations).toEqual([])` reads one of
the two buckets axe fills. Two of the defects here land in the other one, and
both are ordinary: a background marked `aria-hidden="true"` and left focusable,
and an `aria-describedby` with a typo in it. The second is worth dwelling on —
axe's message is *"ARIA attribute element ID does not exist on the page"*, which
is not a hedge, and it is still filed as a review item because the target might
be added later. The first is worse: axe's `focusable-modal-open` check sees that
a modal is open and declines to judge the background, so **the one state in
which the defect can exist is precisely the state axe refuses to decide**.

**One of axe-core's rules for the commonest defect on a phone does not run.**
`target-size` is WCAG 2.2 AA and ships `enabled: false`; `axe.getRules()` lists
it anyway, so it looks active to anyone auditing their own coverage that way.
Nine rules are off by default — the list is in [`scan.ts`](./scan.ts) and is
checked against the installed axe-core, so it fails here rather than rotting.
Enabled explicitly, the rule calls both 20x20 buttons a serious violation.

**Half the catalogue is invisible to axe however it is configured, and the half
is not arbitrary.** Every one of the six is a property of a *transition*: focus
that did not move when a dialog opened or a route changed, an error message that
is not associated with its field, a live region that was not in the tree before
its content arrived, a `role="button"` div that Enter does nothing to. A scan
takes a snapshot of a document, and none of these is visible in one. The
strongest case is `toast-inserted-with-content`: the finished DOM of the correct
and the incorrect version are **identical** — the defect is entirely in the order
of two operations — so no scanner, however good, can ever report it. These need
[`journey.ts`](./journey.ts), where each is four or five lines.

**A second URL buys the per-page strategies nothing, and that is measured rather
than argued.** The fixture serves the app shell everywhere and its script reads
`location.pathname`, so `goto('/details')` really does render the details view.
What it cannot render is the transition into it, and both defects filed under
`route-changed` are properties of the transition.

## The same rules in jsdom and in a browser

This repository already scans components with axe under Testing Library, so the
fair question about an end-to-end scan is what it adds. The answer is two rules,
measured on identical markup run through the same axe-core 4.12.1 in both
environments:

| axe rule | jsdom | Chromium | why |
| --- | --- | --- | --- |
| `color-contrast` | `incomplete` | `violation` | jsdom computes no rendered colour and says so — the honest degradation |
| `target-size` | `passes` | `violation` | jsdom reports every box as zero-sized, so the geometry check passes two 20x20 buttons |
| `image-alt` | `violation` | `violation` | a question about an attribute; no environment is needed to answer it |
| `aria-dialog-name` | `violation` | `violation` | likewise — the accessible-name computation needs no layout here |
| `aria-hidden-focus` | `incomplete` | `incomplete` | deferred in both: the environment is not what makes axe decline this one |
| `aria-valid-attr-value` | `incomplete` | `incomplete` | likewise — a dangling IDREF is a review item wherever it is found |

`color-contrast` degrades honestly — jsdom implements no `canvas`, axe cannot
compute a rendered colour, and it says so. `target-size` degrades dishonestly:
jsdom reports every box as zero-sized, the geometry check finds nothing to
complain about, and the rule returns a **pass** for two buttons a browser calls a
serious violation. A green meaning "there was nothing to measure" is the
expensive kind, and it is the same failure mode [`ct/`](../ct/README.md)
documents one directory over.

That both columns mean anything depends on one install: `@axe-core/playwright` is
pinned to 4.12.1 so that it depends on `axe-core@~4.12.1` and shares the single
copy in the lockfile, rather than quietly bringing a second version.

## Using it

The helpers are the part worth copying. [`scan.ts`](./scan.ts) reads both axe
buckets, names the rules that ship disabled, and fingerprints findings so that
one header defect seen in six states is one entry and not six — which matters,
because per-state scanning is how reports get long enough that people stop
reading them. [`journeyScan.ts`](./journeyScan.ts) is the `AxeBuilder` call.
[`journey.ts`](./journey.ts) holds the four assertions axe has no rule for.

```
pnpm test a11y/        # the model, the catalogue audit and the jsdom column
pnpm test:a11y         # the browser half, against the fixture
```

`vitest.config.ts` excludes `a11y/journey.spec.ts` so the first command needs no
browser at all; CI runs the second in the `a11y` job. One gotcha, recorded
because it costs an afternoon: `AxeBuilder` rejects a page from
`browser.newPage()` with *"Please use browser.newContext()"*. Playwright's own
`page` fixture gives every test its own context, so a test never meets this and a
hand-written script meets it immediately.

## What is not measured here

**Screen readers.** Every assertion in [`journey.ts`](./journey.ts) checks a
precondition for something being announced — the region exists, it was in the
tree first, it was empty — not that any screen reader said it. That is a real gap
and not a closable one in CI; what these assertions buy is that the preconditions
are checkable at all.

**Other engines.** The verdicts are axe-core's, and axe-core is a script running
in the page: what decides whether `color-contrast` resolves is whether there is a
layout, not which engine produced it. A second engine would re-run the same rules
against the same DOM and add no rows. The environment difference that does move
verdicts is jsdom versus a browser, and it is measured above.

**Whether twelve is the right number.** The catalogue is not a census of
accessibility defects; it is twelve defects chosen so that each names a distinct
reason a scan can miss one. A thirteenth would have to name a new reason to be
worth adding.
