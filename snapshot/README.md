# Snapshot testing: what deserves one, and how to stop rubber-stamping them

A snapshot test asserts on everything at once. That is the whole of its appeal
and the whole of its problem, and both halves are measured here rather than
argued.

One subject — `render.ts`, an order summary rendered to HTML — is held to
account three ways, and sixteen single changes are applied to the real source
and run through all three. Ten of the changes are bugs. **Six broke nothing**,
and those six are the point: a technique's failure rate on changes that are
fine is what decides whether anybody reads its output six months later.

## The measurement

Sixteen variants, four orders, three probes.

| Probe | Bugs caught | Also failed on refactors | Signal rate |
|-------|-------------|--------------------------|-------------|
| `full` — snapshot of the whole markup | 10 / 10 | 6 / 6 | **62.5%** |
| `projected` — snapshot of the published fields | 8 / 10 | 0 / 6 | **100%** |
| `assertions` — 14 hand-written expectations | 8 / 10 | 0 / 6 | **100%** |
| `projected` + `assertions` | 10 / 10 | 0 / 6 | **100%** |

*Signal rate* is the fraction of the times a probe goes red that there is
actually a bug. It is the number a reviewer's habit forms around, and it is
deliberately the headline instead of the detection rate. Reported as a
detection rate, the full-markup snapshot wins outright — it is the only single
technique here that catches all ten. Reported honestly, it is wrong more than a
third of the times it speaks.

That is not a reason to ban it. It is the reason `-u` becomes reflex, and the
reason the policy below is about *keeping snapshots readable* rather than about
avoiding them.

### The two narrow probes miss different things

Neither contains the other, which is why the recommendation is a pair.

- The projection misses `BADGE_MODIFIER_DROPPED` and `ARIA_LABEL_DROPPED`.
  Both are markup that carries meaning without carrying a value: the class that
  colours a cancelled badge red, and the name a screen reader announces. No
  projection over `data-field` can reach either. They are named in
  `project.ts#BLIND_SPOTS` and covered by cases in `assertions.test.ts`.
- The assertions miss `DISCOUNT_INCLUDES_DELIVERY` and `TAX_TRUNCATED`. Both
  are arithmetic, and both are only visible on one order in the corpus — the
  discounted total, and a tax of £0.998 where rounding decides the penny.
  Nobody wrote an assertion for either. That is what an assertion suite's
  coverage *is*: wherever somebody's attention happened to land.

A snapshot's real advantage is exactly this second column. It asserts on the
values nobody thought to name, for free, which is why the answer is not "write
assertions instead".

### What the diff-size measurement actually said

This started with the usual claim — a projected snapshot gives you a smaller
failing diff — and the measurement in `yield.test.ts` says that is false.

Over the **eight bugs both snapshot probes catch, the two mark exactly the same
number of lines, every time.** In hindsight it is obvious: the fault changes a
value, both documents contain that value once, and a diff of either marks one
line per changed value.

What the projection changes is two other things:

|  | full markup | projection |
|---|---|---|
| Corpus size, all four orders | 138 lines | 54 lines |
| Lines marked across the six refactors | 64 | 0 |

And diff size does not separate the two populations — it inverts them.
Re-indenting the item rows changes nothing at all and marks 24 lines. Seven of
the ten genuine bugs mark six lines or fewer; only one marks more than the
re-indent does. A reviewer who has learned to skim the big diffs has learned
precisely the wrong lesson, and learned it from the tool.

## The policy

**A snapshot is worth its cost when all three hold:**

1. **The output is wide** — enough facts that assertions covering the same
   ground would be dozens of `expect` calls, and would still miss the ones
   nobody named.
2. **The output is stable** — it changes when behaviour changes and not
   otherwise. Raw markup fails this. So does anything containing a clock, a
   uuid, an absolute path or a port.
3. **Somebody will read the diff** — which is a claim about size and about
   where the diff appears, not about the technique.

**Where 2 fails, project first.** Extract the values through handles the
renderer publishes on purpose (`data-field` here), snapshot that, and cover the
structural facts the projection cannot see with explicit assertions. Where 3
fails, the snapshot is a rubber stamp with a filename, whatever it catches.

**Prefer inline over file snapshots** for anything small enough. An inline
snapshot changes *in the test*, next to the name of the behaviour it belongs
to; a `.snap` file changes somewhere the reviewer has to go and open.

## The enforcement

Writing a policy down is not enforcing it, and the enforcement here is
deliberately not a lint rule banning `toMatchSnapshot`. That would trade a real
defence — the only probe that catches all ten bugs — for a tidier rule.

Instead every snapshot in the repository must be **registered** in
`registry.ts`, with a line budget and one sentence saying why it is a snapshot
rather than assertions. The table is closed in both directions, the same rule
`mutation/scope.ts` and `shape/boundaries.ts` apply: a snapshot with no row
fails, and a row matching no snapshot fails.

Writing the row is the whole point. It costs thirty seconds, it happens while
somebody is deciding, and it is the only moment at which anybody will ever weigh
that decision. `-u` at 6pm on a Friday is not one.

`pnpm snapshot:check` enforces six rules:

| Rule | The failure it is for |
|------|----------------------|
| `unregistered` | A snapshot appeared and nobody decided it should. `toMatchSnapshot()` is one line and passes on the first run by construction. |
| `unused` | A registration matching nothing — the snapshot went, or the test was renamed. A registry that has silently stopped applying reads like coverage and is not. |
| `over-budget` | The snapshot grew past what somebody agreed to read. Nothing stops a 39-line snapshot becoming a 300-line one an update at a time, and no single update looks wrong. |
| `volatile` | A timestamp, uuid, absolute path, port, epoch or object id in the content. The fastest way to train `-u`: red for reasons nobody caused, fixed by the same keystroke every time. |
| `obsolete` | A `.snap` entry whose test no longer exists. Vitest reports these and exits zero, so they accumulate. |
| `empty` | `toMatchInlineSnapshot()` committed with no argument, or with an interpolated template. It passes, it asserts nothing, and it looks exactly like a test. |

Five of the six are decided from the filesystem and run inside `pnpm test`
(`check.test.ts`, `policy.test.ts`), so a snapshot added without a row fails in
seconds. `obsolete` needs the list of test names, so `pnpm snapshot:check`
spawns `vitest list` over the files that own a `.snap` — the same reason
`pnpm shape:check` is its own CI step.

Each rule was checked against the failure it names, on this repository, by
causing it: lowering the budget to 30 fails with *39 lines against a budget of
30*; deleting the row fails as `unregistered`; renaming the test fails as
`obsolete`; pasting an ISO timestamp into the `.snap` fails as `volatile`. A
gate that has only ever been seen green is a screenshot with a CI job attached.

## What is not enforced

- **Nothing checks that a snapshot is *right*.** A snapshot recorded from
  broken code is a perfectly valid snapshot of broken code, and no rule here
  can tell. That is the one failure mode of the technique with no mechanical
  answer — the first recording is the review.
- **Nothing counts how many snapshots a suite may have.** A budget per snapshot
  bounds what one reviewer reads at once; forty registered snapshots would pass
  every rule. The registry makes the total visible instead of bounding it.
- **`ITEM_ROWS_REINDENTED` is noise here and would not be everywhere.** If the
  markup were whitespace-sensitive — a `<pre>`, an email template — that edit
  is a bug and the full snapshot is the only probe that catches it. The
  classification in `edits.ts` is a judgement about *this* subject, checked
  against the assertion suite rather than against the projection, so the
  measurement is not circular.
- **The projection needs the renderer's cooperation.** `data-field` is a
  contract, and a value rendered without one is invisible to the projected
  snapshot. `project.test.ts` closes that table in both directions, which
  converts a silent blindness into a failing test — but only for fields, not
  for structure.

## The files

| File | What it is |
|------|-----------|
| `render.ts` | The subject. Import-free, so variants of it compile and load. |
| `orders.ts` | Four orders reaching every branch. Every value written down. |
| `project.ts` | The projection, its closed field table, and its named blind spots. |
| `edits.ts` | Ten bugs and six refactors, as exact edits to the real source. |
| `probes.ts` | The three techniques, including the fourteen assertions. |
| `matrix.ts` | The declared result, re-derived by `detection.test.ts`. |
| `diff.ts` | LCS line diff, for the size measurement. |
| `registry.ts` | Every snapshot the repository has agreed to keep. |
| `inventory.ts` | Finding snapshots: `.snap` files and inline calls. |
| `policy.ts` | The six rules, as a pure function. |
| `check.ts` | `pnpm snapshot:check`. |
| `full.test.ts`, `projected.test.ts`, `assertions.test.ts` | The three patterns, as a person would write them. |
