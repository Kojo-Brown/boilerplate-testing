# Lighthouse budgets, wired to a pull-request comment

A `budgets.json`, the one wiring that makes it fail a build, and a sticky PR
comment that says how much headroom is left.

Every number below was measured against **Lighthouse 12.1.0** and
**Lighthouse CI 0.14.0**, not read off a changelog.
`pnpm lighthouse:check` re-measures all of it, so a claim that stops being true
fails CI.

## The budgets

| budget                   | limit      | asserted as |
|--------------------------|------------|-------------|
| first-contentful-paint   | 2000 ms    | `first-contentful-paint` |
| largest-contentful-paint | 2500 ms    | `largest-contentful-paint` |
| speed-index              | 3000 ms    | `speed-index` |
| interactive              | 3500 ms    | `interactive` |
| total-blocking-time      | 300 ms     | `total-blocking-time` |
| script count             | 10         | `resource-summary:script:count` |
| image count              | 20         | `resource-summary:image:count` |
| total count              | 50         | `resource-summary:total:count` |
| script size              | 300.0 KiB  | `resource-summary:script:size` |
| stylesheet size          | 100.0 KiB  | `resource-summary:stylesheet:size` |
| image size               | 500.0 KiB  | `resource-summary:image:size` |
| font size                | 100.0 KiB  | `resource-summary:font:size` |
| document size            | 15.0 KiB   | `resource-summary:document:size` |
| total size               | 1000.0 KiB | `resource-summary:total:size` |

Sizes are KiB. Timings are milliseconds, asserted on the audit of the same name.

## The four wirings

| wiring                                       | gates  | why |
|----------------------------------------------|--------|-----|
| `ci.collect.settings.budgets`                | **no** | Lighthouse 12 has no `budgets` setting and no budget audits; the setting is ignored without a warning |
| `ci.assert.assertions['performance-budget']` | **no** | LHCI reads the removed performance-budget audit, finds nothing, and returns zero assertion results |
| `ci.assert.budgetsFile`                      | yes    | LHCI converts the file into resource-summary and timing assertions, which Lighthouse 12 still computes |
| `ci.assert.assertions ← budgetAssertions()`  | yes    | the same conversion, done here, so it can be merged with quality assertions and keep includePassedAssertions |

The first two are the ones a Lighthouse CI guide will show you, and **both
report green while every budget in the file is blown by 4x**. That is what this
directory is about.

## Running it

```sh
pnpm lighthouse:ci       # audit the fixture through the published config
pnpm lighthouse:check    # the gate: re-measure every wiring
```

Both need a Chrome. `CHROME_PATH` is honoured; otherwise Playwright's Chromium
is used when it is installed (`pnpm exec playwright install chromium`), and
failing that `chrome-launcher` looks for a system one. See `chrome.ts`.

With nothing to point it at, this directory ships a target:

```sh
node lighthouse/server.ts &
LH_URLS=http://localhost:8802/lean pnpm lighthouse:ci
```

`/lean` is inside every budget; `/heavy` breaks the ones a payload can break, by
4x. The second is what the gate compares the wirings on: a wiring that reports
green on `/heavy` is reporting green on 1.2 MiB of comment.

For a real project, replace `url` and `startServerCommand` in `lighthouserc.cjs`.

## The gate

One collection of `/heavy`, then the same reports asserted under each wiring —
not one collection per wiring. LCP and TBT move by tens of percent between runs
on a shared runner, so separate collections would leave every difference between
two wirings ambiguous between the wiring and the noise. Asserting repeatedly
over one set of reports removes the variable: if two wirings disagree, it is the
wiring.

Then a second collection of `/lean` through the published config, because a gate
that has only been seen to fail has not been seen to work — the config that
fails everything on `/heavy` must pass everything on `/lean`.

## What was measured

### Two of the four wirings enforce nothing

Lighthouse 12 removed W3C performance budgets. There is no `budgets` setting in
`defaultSettings`, none in the settings type, and `core/audits/` contains
neither `performance-budget.js` nor `timing-budget.js`. Lighthouse does not
reject the unknown setting — the report does not even echo it back in
`configSettings` — so a budget file handed to `collect.settings.budgets` is
parsed, passed in, and dropped.

### The dangerous one is the one that looks explicit

The two removed audits behave in opposite ways, and the difference is the whole
finding:

| assertion            | rows | exit | why                                     |
|----------------------|------|------|-----------------------------------------|
| `performance-budget` |    0 |    0 | LHCI special-cases it and returns `[]`  |
| `timing-budget`      |    1 |    1 | no special case, so it reports `auditRan` |

`timing-budget` fails *loudly*: LHCI has no handler for it, so it falls through
to the standard path, cannot read the audit, and reports a failure.
`performance-budget` passes *silently* precisely because LHCI does have a
handler — `getBudgetAssertionResults` reads the audit out of each report, finds
`undefined`, `continue`s, and returns an empty array. **Zero assertion results
is indistinguishable from zero failures.** The code written to support budgets
is the only reason they are swallowed.

### `budgetsFile` works, and costs the passing rows

`assert.budgetsFile` is the wiring that does gate, because it does not touch the
removed audits: LHCI converts the file into assertions on `resource-summary` and
the timing audits, which Lighthouse 12 still computes.

It is not what this directory publishes, for two reasons that are both in
LHCI's `assert.js`. It throws `Cannot use both budgets AND assertions`, so the
category and accessibility assertions would have to go. And the conversion
*replaces the whole options object* — `options = await
convertBudgetsToAssertions(...)` — which silently drops
`includePassedAssertions` with it.

Measured, asserting the same reports: `budgetsFile` writes 6 rows,
`budgetAssertions()` writes 14. The 6 are the breaches. The other 8 are the
budgets that passed, and they are the whole content of a useful comment.

So `budgets.ts` re-implements LHCI's conversion, and `budgets.test.ts` asserts
the two agree — on the real budget file and on one naming every resource type —
so drifting from LHCI's semantics fails `pnpm test` rather than quietly changing
what the gate means.

### Budget sizes are KiB

A `resourceSizes` budget of `300` is 307,200 bytes, not 300,000.
`bundlesize/config.ts` in this repository uses decimal kB for the same kind of
number, which is how a team ends up with two "300 kB" limits 7,200 bytes apart.
`wiring.test.ts` fails if the published config ever asserts the decimal value.

### An empty results file is not a clean run

Under LHCI's defaults `assertion-results.json` holds failures only, so a run
where every budget was met and a run where no budget was evaluated both produce
`[]`. Rendered straight, the comment says "every budget met" for a config whose
budgets are wired the dead way — the comment becomes the most convincing
possible evidence for the thing that is not happening.

`includePassedAssertions: true` fixes most of it. What it cannot fix is a line
that produced no row, so `report.ts` joins the rows *against the budget file*
rather than reading them off it, and scores a line with no result
`not-measured` — a warning in the comment, a failure in the gate. A budget
nobody measured is not a budget that passed.

Measured, so the list is shorter than it looks: a budget line against a real
audit always produces a row. An unused `resourceType` comes back `actual: 0` and
passes, which is correct. An audit Lighthouse has stopped computing comes back
`actual: null` and fails; an id it never had fails as `auditRan`. What produces
no row at all is a collection that yielded no report, and a special-cased id.

### Lighthouse CI posts a status check, not a comment

`LHCI_GITHUB_APP_TOKEN` cannot satisfy this item. LHCI's only GitHub write is
`POST /repos/{slug}/statuses/{sha}` in `upload.js` — a commit status, which is a
row in the checks list with a 140-character description. The budget table does
not fit in it, and `upload.js` contains no issue-comments call at all.
`findings.ts` reads that off the installed package, so the day LHCI grows a
comment integration this claim fails instead of describing a version nobody has.

So the comment is `comment.ts` plus `post.ts`, and the interesting part is not
the POST. It is that **a budget comment must never be the reason a build
fails**. Three things routinely stop it being posted, none of which says
anything about the code under review: a pull request from a fork, where
`GITHUB_TOKEN` is read-only whatever the `permissions:` block says and the POST
returns 403; a `push` build, where there is no issue to comment on; and a
missing token, which is what copying the workflow without its `permissions:`
block gets you. All three return an outcome rather than throwing, and the job
prints the body to the log when it could not post it, so the information is not
lost with the comment.

The comment is sticky: keyed by an HTML comment and updated in place. Keying on
"the first comment by the bot" is the usual implementation, and it collides with
every other bot sharing the `github-actions` identity.

### `first-meaningful-paint` is accepted and never measured

LHCI carries a copy of Lighthouse's old budget validation, and that copy still
allows `first-meaningful-paint`. Lighthouse 12 still ships the audit *and* still
lists it in the default config — so a check against the audit list waves it
through — but reports it `scoreDisplayMode: "notApplicable"` with no
`numericValue`. A budget on it is accepted, converted, and then fails with
`actual: null`: survivable, but not diagnosable.

It is therefore excluded from `TIMING_METRICS`, and `check.ts` asserts against a
real report that every metric on that list comes back `numeric` while
`first-meaningful-paint` comes back `notApplicable` — the only place the
difference is visible.

## Files

| file | what it holds |
|------|---------------|
| `budgets.json` | the budgets, in the W3C shape LHCI reads |
| `budgets.ts` | the budget model, its validation, and the conversion to assertions |
| `load.ts` | reading and validating `budgets.json` |
| `wiring.ts` | the four wirings, and the audit that keeps the config off the dead two |
| `lighthouserc.cjs` | the published config |
| `report.ts` | joining `assertion-results.json` back against the budget file |
| `comment.ts` | the comment body |
| `post.ts` | creating or updating it, and the three ways that is skipped |
| `comment-pr.ts` | the CI entry point: read the last run, render, post |
| `fixture.ts` / `server.ts` | the `/heavy` and `/lean` pages |
| `chrome.ts` | finding a Chrome |
| `check.ts` | the gate |
| `findings.ts` | the findings above, as the data this README is rendered from |
