# Visual regression: masking, tolerance, and a review workflow

Thirteen ways a rendered page differs from the last time it was rendered — 8 of
them regressions and 5 of them the ordinary churn of a live page — against nine
ways to wire a Playwright screenshot suite. All 117 cells are re-derived
against Chromium on every run and checked against the tables below, and the
tables below are *printed from* `wirings.ts` rather than compared to it.

The short version: **the configuration you get for free scores below the one you
would write by hand in five minutes, and ties with a job that rewrites its own
baselines on every run.**

---

## What is actually being measured

A visual-regression suite is graded on two errors, not one. It has to flag a
regression, and it has to not flag the clock in the header — and the second is
the one that kills it, because a suite whose diffs nobody reads gets its
tolerance raised until it stops talking. So the catalogue holds `regression`s,
which a wiring should flag, and `noise`, which it should not, and a wiring is
scored on getting both right. A table with only the first column would rank the
useless `naive` wiring top.

### The catalogue

| change | kind | what it is | region | mask | delta | area | motion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `brand-shade` | regression | the brand bar moves one step along its own ramp (#2563eb → #3b82f6) | `above-fold` | `outside` | `shade` | `over-budget` | `none` |
| `brand-hairline` | regression | the brand bar moves one unit in one channel (#2563eb → #2563ec) | `above-fold` | `outside` | `hairline` | `over-budget` | `none` |
| `status-inverted` | regression | the “Paid” pill renders in the error colour (#16a34a → #dc2626) | `above-fold` | `outside` | `loud` | `over-budget` | `none` |
| `control-removed` | regression | the Export button is gone, in a row that keeps its height | `above-fold` | `outside` | `loud` | `over-budget` | `none` |
| `stamp-recoloured` | regression | the header stamp renders in the error colour, in a box of unchanged size | `above-fold` | `inside` | `loud` | `under-budget` | `none` |
| `stamp-enlarged` | regression | the header stamp doubles in size, so its box grows | `above-fold` | `resizes` | `loud` | `over-budget` | `none` |
| `panel-recoloured` | regression | the support panel below the fold renders on an error background | `below-fold` | `outside` | `hairline` | `over-budget` | `none` |
| `page-grew` | regression | a duplicated row makes the document 96px taller | `page-height` | `outside` | `loud` | `over-budget` | `none` |
| `stamp-text` | noise | the header stamp reads a different time, as it does on every render | `above-fold` | `inside` | `loud` | `under-budget` | `none` |
| `avatar-tint` | noise | the generated avatar comes back a different colour | `above-fold` | `inside` | `loud` | `under-budget` | `none` |
| `subpixel-jitter` | noise | the body copy sits 0.4px to the right, re-hinting every glyph | `above-fold` | `outside` | `loud` | `under-budget` | `none` |
| `css-animation-phase` | noise | the spinner and the fade-in are caught at a different phase | `above-fold` | `outside` | `loud` | `over-budget` | `css` |
| `script-animation-phase` | noise | the progress bar, whose width a rAF callback writes, is further along | `above-fold` | `outside` | `loud` | `over-budget` | `script` |

`subject.ts` renders the same document for every entry but one region: the stamp
only varies for `stamp-text`, the avatar only for `avatar-tint`, the animations
only for the two phase entries. That is not a tidier version of a real page —
a real page varies in all of them at once — it is what makes a cell
attributable to the change under test rather than to whichever varying region
happened to be loudest.

It is also what makes this directory deterministic. Nothing here reads a clock,
a random source or a scheduler: the varying regions are driven by a `nonce`, and
the two CSS animations are `animation-play-state: paused` with a negative
`animation-delay`, which puts each at exactly the phase that delay names and
holds it there. `determinism/registry.ts` gains no rows. The nondeterminism is
the *subject*, so it is modelled explicitly rather than waited for.

### The wirings

| wiring | derived from | scope | mask | animations | threshold | maxDiffPixels | review | score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `naive` | — | viewport | off | allow | 0 | 0 | blocking | **6 / 13** |
| `frozen` | `naive` | viewport | off | disabled | 0 | 0 | blocking | **7 / 13** |
| `playwright-default` | `frozen` | viewport | off | disabled | 0.2 | 0 | blocking | **5 / 13** |
| `masked` | `frozen` | viewport | on | disabled | 0 | 0 | blocking | **8 / 13** |
| `budgeted` | `masked` | viewport | on | disabled | 0 | 4,000 | blocking | **9 / 13** |
| `whole-page` | `budgeted` | full-page | on | disabled | 0 | 4,000 | blocking | **11 / 13** |
| `over-tolerant` | `whole-page` | full-page | on | disabled | 0.2 | 4,000 | blocking | **8 / 13** |
| `auto-updated` | `whole-page` | full-page | on | disabled | 0 | 4,000 | auto-update | **5 / 13** |
| `reviewed` | `whole-page` | full-page | on | disabled | 0 | 4,000 | approve | **12 / 13** |

Every wiring but the first differs from the one it names in exactly one control,
and `wirings.test.ts` asserts that rather than trusting this sentence. A league
table of nine arbitrary configurations tells you which is best and nothing about
why; adjacent rows make each difference attributable to the control that caused
it.

### The matrix

| change | `naive` | `frozen` | `playwright-default` | `masked` | `budgeted` | `whole-page` | `over-tolerant` | `auto-updated` | `reviewed` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `brand-shade` | caught | caught | missed | caught | caught | caught | missed | absorbed | caught |
| `brand-hairline` | caught | caught | missed | caught | caught | caught | missed | absorbed | caught |
| `status-inverted` | caught | caught | caught | caught | caught | caught | caught | absorbed | caught |
| `control-removed` | caught | caught | caught | caught | caught | caught | caught | absorbed | caught |
| `stamp-recoloured` | caught | caught | caught | missed | missed | missed | missed | missed | missed |
| `stamp-enlarged` | caught | caught | caught | caught | caught | caught | caught | absorbed | caught |
| `panel-recoloured` | missed | missed | missed | missed | missed | caught | missed | absorbed | caught |
| `page-grew` | missed | missed | missed | missed | missed | caught | caught | absorbed | caught |
| `stamp-text` | false-alarm | false-alarm | false-alarm | clean | clean | clean | clean | clean | clean |
| `avatar-tint` | false-alarm | false-alarm | false-alarm | clean | clean | clean | clean | clean | clean |
| `subpixel-jitter` | false-alarm | false-alarm | false-alarm | false-alarm | clean | clean | clean | clean | clean |
| `css-animation-phase` | false-alarm | clean | clean | clean | clean | clean | clean | clean | clean |
| `script-animation-phase` | false-alarm | false-alarm | false-alarm | false-alarm | false-alarm | false-alarm | false-alarm | clean | triaged |

---

## Capture and comparison are two phases, and the API hides that

`toHaveScreenshot` takes one options bag holding `mask`, `animations`,
`fullPage`, `clip`, `threshold` and `maxDiffPixels`, which reads as six knobs of
one kind. They are not. The first four decide **what image is produced**; the
last two decide **how two images are graded**. Six of the nine wirings above
differ from another only in the second group, which is why `matrix.spec.ts`
takes four screenshots of each revision rather than nine, and why `capture.ts`
runs `page.screenshot(...)` and `toMatchSnapshot(...)` as two steps instead of
calling the fused matcher.

The distinction is not pedantry. It is why masking and tolerance do not
substitute for each other however hard you tune them, and why the two standard
answers to a noisy suite — *mask the dynamic bits*, *raise the tolerance* — are
answers to different questions.

## `threshold: 0.2` is not a little slack for anti-aliasing

It is a per-pixel colour distance in YIQ space, and a pixel under it is not
counted as different **at all**. `calibration.spec.ts` measures it on flat fills
of the fixture's own colours, and two of the results are the reason this
directory exists:

* `#2563eb` → `#3b82f6` — one step along a colour ramp, twenty thousand pixels
  of it — is reported as **no difference** at the default threshold.
* `#f3f4f6` → `#fee2e2` — a neutral panel turning error-pink — survives only
  `threshold: 0`. To the comparator it is in the same band as adding one to a
  blue channel. Light-on-light is where a threshold does its quietest damage.

The catalogue filed that second one as `loud` in its first draft and `shade` in
its second. Only the calibration could say otherwise: the matrix's wirings use
thresholds 0 and 0.2, and all three bands predict the same thing at both.

## The two knobs are in series, not in parallel

`threshold` decides **which pixels count**; `maxDiffPixels` decides **how many
counted pixels are allowed**. The order is what surprises people: a change whose
per-pixel delta is under the threshold contributes no counted pixels, so no
budget — however small — reaches it. Setting `maxDiffPixels: 0` to "be strict"
while leaving `threshold` at its default is strictness about a quantity that was
already zero.

Which makes the usual tuning advice backwards. The two real problems have
opposite shapes:

| problem | shape | the knob for it |
| --- | --- | --- |
| anti-aliasing churn | many pixels, tiny delta each | `maxDiffPixels` |
| a colour or token drift | many pixels, small delta, *all of them* | `threshold`, downwards |

`subpixel-jitter` moves about 1,500 pixels; raising `threshold` to 0.3 only
takes that to a few hundred, so it never stops failing. A budget of 4,000 makes
it clean and costs nothing, because it is a count and the colour regressions are
whole regions. `budgeted` is `masked` with that one change and scores a point
more; `over-tolerant` is `whole-page` with the *other* knob moved and scores
three fewer, buying no noise cell at all.

## A mask is a solid rectangle, not a filter

Masking is the one control here that trades. Three cells say so, and only the
first is the one people expect:

* `stamp-text` and `avatar-tint` — noise inside the mask — go `false-alarm` →
  `clean`. This is what masking is for.
* `stamp-recoloured` — the same stamp turning error-red, in a box of unchanged
  size — goes `caught` → `missed`. The mask cannot tell the clock in the header
  from the header breaking, and it does not try.
* `stamp-enlarged` — the same stamp doubling in size — stays `caught`, and is
  *louder* masked than bare: the mask is a filled rectangle, so a bigger box is
  a bigger rectangle, differing at every pixel between them. Measured at roughly
  8,000 pixels masked against a bare render that moves fewer.

So the rule is not "mask what changes" but "mask what changes *without moving*",
and everything inside a mask is a place a defect can hide.

## `animations: 'disabled'` is a control over the engine's animations

It settles what `document.getAnimations()` returns — finite animations
fast-forwarded, infinite ones cancelled to their first frame — to the same frame
in both captures. `css-animation-phase` is `false-alarm` under `naive` and
`clean` everywhere else, which is the option doing exactly its job.

`script-animation-phase` is a progress bar whose width a `requestAnimationFrame`
callback writes, and it is a `false-alarm` in **every blocking wiring in the
table**. Nothing in the options bag reaches it, because it is not an animation
as far as the engine is concerned — it is script writing a style. A page with
script-driven motion has to be stilled in the page; no capture option will do
it for you.

## A size mismatch is not graded

`page-grew` makes the document 96px taller, and a full-page capture of it is a
different-sized image. The comparator rejects that **before consulting either
tolerance**: `over-tolerant` catches it while missing three colour regressions
it was far better placed to see. `matrix.spec.ts` pins it with the most
permissive comparison the API can express — `threshold: 1, maxDiffPixels:
10_000_000` — which still fails.

The corollary is the `whole-page` row. A viewport capture has nothing to say
about the page below it, and two of the eight regressions live there.

---

## The review workflow

A comparison that found a difference has not yet done anything. What happens
next is decided by one command-line flag with five settings, and
`lifecycle.test.ts` measures what each does to a real baseline on a real disk,
against real `playwright test` runs — fifteen cells, no browser, so this half
rides `pnpm test` on every Node major.

| `--update-snapshots` | baseline `absent` | baseline `unchanged` | baseline `changed` |
| --- | --- | --- | --- |
| *(flag absent)* | `seeded-red` | `clean` | `blocked` |
| `=missing` | `seeded-red` | `clean` | `blocked` |
| `=changed` | `seeded-green` | `clean` | `absorbed` |
| `=all` | `seeded-green` | `clean` | `absorbed` |
| `=none` | `refused` | `clean` | `blocked` |

* `clean` — exit 0, baseline untouched.
* `blocked` — exit 1, baseline untouched. The gate working.
* `absorbed` — exit 0, baseline **rewritten**. The gate deleted.
* `seeded-red` — exit 1, baseline **created**. Playwright's "writing actual".
* `seeded-green` — exit 0, baseline created. A run that reports success having
  compared nothing.
* `refused` — exit 1, nothing written.

Three readings:

**`=changed` and `=all` are the same row.** In all three situations. The
distinction their names promise — update only what changed, versus update
everything — appears nowhere, because a missing baseline is a change as far as
the updater is concerned. Reaching for `=changed` because it sounds careful buys
exactly nothing.

**Both of them exit 0 on a baseline that was never there.** A visual test added
to a repository whose CI passes either flag is green on its first run against a
baseline no human has seen, and green ever after against that same invented
reference.

**The default is not safe either, and `=none` is.** With no flag, a missing
baseline is written and the run fails — which sounds fine until you notice that
the artifact of that red run is a baseline nobody reviewed, rendered by whichever
runner picked the job up, and that the obvious next move is to commit it.
`=none` is the only setting that refuses to invent one.

One piece of good news, and it is the reason the default is merely bad rather
than dangerous: **Playwright does not retry a missing-snapshot failure.** With
`retries: 2` the run makes exactly one attempt and stays red, so a first run
cannot go flaky-but-green against a baseline it wrote itself. An ordinary
mismatch, by contrast, does take all three attempts — so this is a fact about
snapshots, not about retries being off.

`workflow-templates/visual-regression.yml` is the top row of the matrix as a
copyable workflow: `--update-snapshots=none`, diffs uploaded on `always()`, and
no step that writes baselines back to the branch. `workflow.test.ts` derives
those three controls back out of the file and compares them against whichever
row actually tops the table — no constant names the winner, so if the
measurement moves, the template fails the build rather than becoming last year's
advice.

---

## The ceiling

`reviewed` tops the table at 12 of 13, and the one it misses is
`stamp-recoloured` — the defect masking created. No wiring here fixes it,
because every wiring that is quiet enough to live with masks that region, and
the mask is what hides it. The honest answers are outside this table: freeze the
value at the seam instead of masking the pixels, or assert the stamp's colour
somewhere a screenshot is not involved.

A suite that scores 12 of 13 and knows which one it is beating is worth more
than one that scores 13 by construction.

## What is not measured here

**Whether a baseline stored between runs still matches.** Every baseline the
browser half compares against is captured by the same Chromium a few
milliseconds earlier, and `snapshotPathTemplate` points into `playwright-results/`,
which is `.gitignore`d. That is deliberate: a committed PNG is a photograph of
one Chromium build's font hinting on one operating system, and a repository of
copyable patterns that shipped one would be shipping a suite that is red on
arrival for most readers. The half that genuinely needs baselines on disk —
what the update flag does to them — is measured in `lifecycle.test.ts`, with
real files and no renderer.

**Cross-browser pixel differences.** Chromium only, and for the reason `matrix/`
gives: the subject is Playwright's comparator, which runs on buffers and does
not know which engine produced them. A second engine would re-grade the same
images and add no rows.

**`toHaveScreenshot`'s retry loop.** `capture.ts` uses `page.screenshot` plus
`toMatchSnapshot`, which is the same comparator with the capture and the
comparison prised apart. What is lost is the polling that makes a screenshot of
a settling page stable in a real suite — genuinely useful there, and wrong here,
because it would make every honest "different" cost the expect timeout and read
as *different for as long as we were willing to wait*.

**Perceptual comparison.** `threshold` is YIQ distance; a comparator using a
perceptual metric would band these colours differently. Every number above is
about the algorithm Playwright ships.

## Running it

```bash
pnpm test:visual   # the 117 cells and the calibration, in Chromium
pnpm test          # the model, the fixture audit, and the baseline lifecycle
```

The browser half needs Chromium and a free port on 3113; `playwright-visual.config.ts`
starts `visual/server.ts` as its `webServer`. The rest needs neither, which is
why `vitest.config.ts` excludes only `visual/**/*.spec.ts`.
