# Cross-browser matrix, mobile emulation, and sharding

Two questions a Playwright config answers badly, both measured here rather than
asserted.

**What is in the matrix?** Five projects — `chromium`, `firefox`, `webkit`,
`mobile-chrome`, `mobile-safari` — look like three engines crossed with two form
factors. They are not, and the missing cell cannot be added.

**What does sharding split?** Not your tests. The unit is decided by a setting
three lines away that has nothing to do with sharding in its name, and getting
it wrong buys four machines the wall clock of two.

Nothing below is quoted from documentation. The emulation table is 45 cells
measured in a real Chromium on every run; the sharding tables are checked
against a model of Playwright's algorithm, which is itself checked against
`playwright test --list --shard` over a purpose-built fixture.

---

## Part 1 — the matrix

### The five projects

| project | descriptor | engine | form factor |
| --- | --- | --- | --- |
| `chromium` | `Desktop Chrome` | chromium | desktop |
| `firefox` | `Desktop Firefox` | firefox | desktop |
| `webkit` | `Desktop Safari` | webkit | desktop |
| `mobile-chrome` | `Pixel 5` | chromium | mobile |
| `mobile-safari` | `iPhone 13` | webkit | mobile |

Three engines on the desktop row and two on the mobile row. The reason is not
the config:

| engine | desktop descriptors | mobile descriptors |
| --- | --- | --- |
| chromium | 4 | 96 |
| firefox | 2 | 0 |
| webkit | 1 | 104 |

Playwright ships 207 device descriptors, 200 of them mobile, and not one of the
200 is Firefox. `emulation.test.ts` checks every number in that table against
the live registry, so a dependency bump that changes it is a red build and a
re-read rather than a stale paragraph.

### What emulation does that a resize does not

Three conditions, all of them the same Chromium, differing only in context
options. `desktop` is the control. `narrow` is what a team does when somebody
says the app is broken on a phone — set the viewport narrow and call the test a
mobile test. `emulated` is the `Pixel 5` descriptor.

Each probe is filed in advance as `viewport` — something a window resize should
be able to move — or `device`. That the measured table partitions exactly along
that line is the finding, not the arrangement.

| probe | kind | desktop | narrow | emulated |
| --- | --- | --- | --- | --- |
| `viewport-width` | viewport | `wide` | `narrow` | `narrow` |
| `css-breakpoint` | viewport | `wide` | `stacked` | `stacked` |
| `touch-target-size` | device | `small` | `small` | `large` |
| `pointer-coarse` | device | `fine` | `fine` | `coarse` |
| `any-pointer-coarse` | device | `fine` | `fine` | `coarse` |
| `hover-capable` | device | `hover` | `hover` | `none` |
| `hover-affordance` | device | `hidden` | `hidden` | `reachable` |
| `max-touch-points` | device | `zero` | `zero` | `positive` |
| `touch-events` | device | `absent` | `absent` | `present` |
| `device-pixel-ratio` | device | `one` | `one` | `above-one` |
| `ua-mobile-token` | device | `desktop` | `desktop` | `mobile` |
| `ua-data-mobile` | device | `desktop` | `desktop` | `mobile` |
| `screen-width` | viewport | `desktop` | `phone` | `phone` |
| `tap()` | device | `rejected` | `rejected` | `tapped` |
| `pointerType` | device | `none` | `none` | `touch` |

### What the tables say

**The matrix is five cells, not six.** Every mobile project rides Chromium or
WebKit. A suite that believes it covers three engines on phones covers two, and
nothing in the config says so: every project in it runs, and passes.

**The missing cell cannot be written.** It is not that nobody added
`mobile-firefox` — Playwright ships no Firefox descriptor with `isMobile` set,
so there is nothing to spread. Gecko's mobile browser is outside what Playwright
emulates.

**Emulation is overwhelmingly what the registry is for.** 200 of 207 descriptors
are phones and tablets. The seven desktop entries are the whole of the
"cross-browser" half; everything else in the list is the form-factor half.

**A resize moves exactly the viewport probes.** All three of them, and only
those three. `screen-width` is in that group for a reason worth knowing: a
descriptor carries a `screen` distinct from its viewport — `Desktop Chrome` is
1280×720 inside 1920×1080 — and none of it reaches the page through a project's
`use`. `window.screen` mirrored the viewport under all three conditions, so a
suite reading `screen` to decide it is on a phone is reading the window twice.

**On every device probe, a narrow window is a desktop.** Ten probes: pointer
type, hover capability, touch points, the touch API, the device pixel ratio, the
user-agent string, client hints, and the `(pointer: coarse)` branch of the
stylesheet. All ten answer exactly what the 1280-wide run answered.

**The resize reports the archetypal mobile bug backwards.** The fixture page
hides a control behind `:hover`, carefully, inside `@media (hover: hover)` so a
device without hover keeps it. A real phone therefore reports `reachable`; the
narrow window reports `hidden`. A mobile test built on a resize does not merely
miss that bug — it records the opposite value for it and goes green.

**A resize cannot tap.** `page.tap()` on a context without `hasTouch` is a
Playwright error, not a failed interaction, so the resize-only project cannot
express the gesture at all. Whatever else is true of the suite, its mobile
coverage stops at layout.

**Emulation changes what the page sees, not just what the test does.** Under the
device descriptor the page's own click handler reports `pointerType: 'touch'`.
Application code that branches on that — and plenty does — takes a different
path in the emulated run and the desktop path in the narrow one.

---

## Part 2 — sharding

### What Playwright will not split

Sharding is described as splitting tests across machines. It splits *groups*,
and a group is a file, a test, a `describe.serial` block, or a chunk sized by
the shard count, depending on how the file is written:

| file | tests | `fullyParallel: false` | `fullyParallel: true`, 3 shards | at 6 shards | unit |
| --- | --- | --- | --- | --- | --- |
| `plain.spec.ts` | 5 | `[5]` | `[1, 1, 1, 1, 1]` | `[1, 1, 1, 1, 1]` | `file` → `test` |
| `hooked.spec.ts` | 5 | `[5]` | `[2, 2, 1]` | `[1, 1, 1, 1, 1]` | `file` → `chunk` |
| `serial.spec.ts` | 5 | `[5]` | `[5]` | `[5]` | `file` → `block` |
| `parallel.spec.ts` | 4 | `[1, 1, 1, 1]` | `[1, 1, 1, 1]` | `[1, 1, 1, 1]` | `test` → `test` |

### What the shards then weigh

23 tests, one project, cut n ways. The "even cut" column is what Playwright
computes from the test count; the other two are what the groups allow.

| shards | even cut | `fullyParallel: false` | `fullyParallel: true` | setup runs |
| --- | --- | --- | --- | --- |
| 2 | `[12, 11]` | `[12, 11]` | `[12, 11]` | 2 |
| 3 | `[8, 8, 7]` | `[8, 9, 6]` | `[8, 8, 7]` | 3 |
| 4 | `[6, 6, 6, 5]` | `[8, 4, 10, 1]` | `[6, 6, 10, 1]` | 4 |
| 6 | `[4, 4, 4, 4, 4, 3]` | `[5, 3, 4, 5, 5, 1]` | `[4, 4, 4, 4, 6, 1]` | 6 |
| 8 | `[3, 3, 3, 3, 3, 3, 3, 2]` | `[5, 3, 1, 3, 5, 5, 0, 1]` | `[3, 3, 3, 3, 3, 7, 0, 1]` | 8 |

### What the tables say

**`fullyParallel` decides the shard unit.** It is documented as a setting about
workers, and it is also the difference between a file being indivisible and a
file being five independent groups. No part of its name suggests it changes what
`--shard` can cut.

**One `beforeAll` changes the unit again.** `plain.spec.ts` and `hooked.spec.ts`
hold the same five tests; the second declares a file-level hook. Under
`fullyParallel: true` the first becomes five groups and the second becomes
chunks, because the hook has to run once per group.

**And the chunk is sized by the shard count.** `hooked.spec.ts` groups as
`[2, 2, 1]` at three shards and `[1, 1, 1, 1, 1]` at six. The grouping is a
function of `--shard`, so asking for more machines changes what the groups are
before it changes where they are cut.

**A serial block never splits.** `test.describe.serial` pins its tests to one
worker in order, which means one shard, `fullyParallel` or not. It is the only
row of the shapes table that is the same under every configuration.

**The default config misses the even cut it just computed.** At every shard
count above two. At four it produces `[8, 4, 10, 1]` against a nominal
`[6, 6, 6, 5]`: one machine runs ten tests and another runs one, so four runners
deliver roughly the wall clock of two.

**`fullyParallel: true` is not a fix, and is not even monotone.** Finer groups
move every later group's starting index, which lands the indivisible block
somewhere else. Over this fixture it improves the busiest shard at three shards
(9 → 8), ties at two and four, and makes it *worse* at six (5 → 6) and eight
(5 → 7).

**Past three shards neither config reaches the even cut.** Both columns'
busiest shard exceeds the nominal one from four shards on. The arithmetic is
computed over tests and applied to groups, and nothing reconciles the two.

**Over-sharding produces shards that run nothing.** At eight shards over nine
groups, one shard is empty — a runner booted, a repository cloned, a browser
downloaded, to run zero tests and exit 0. The useful shard count is bounded by
the group count, not the test count.

**The largest group is the floor on the critical path.** No shard count takes
the busiest shard below the size of the biggest indivisible group. Adding
machines past that point cannot help, and the only thing that can is changing
how the file is written.

**A dependency project is multiplied by the shard count, not divided by it.**
Playwright detaches every project named in another's `dependencies`, shards what
is left, and re-attaches the dependency in full to every shard that kept a
dependent test. The `setup runs` column is the shard count. An auth setup that
logs in against a real identity provider gets more expensive the more you
parallelise — the one line of a sharded config that does.

### And what a sharded run reports

`merge.test.ts` runs the fixture for real, three shards into three blob
directories, and puts them back together with `playwright merge-reports`. Two
results, both about the same hole:

- Merging two of the three reports yields `unexpected: 0` and a smaller suite.
  Nothing in a merged report knows how many tests there were supposed to be, so
  "all jobs green" is a statement about the jobs that ran.
- An empty shard exits 0. A lost runner and a passing one are the same colour.

The defence is a count the pipeline checks, which is why the merged total is
what this directory asserts on.

---

## Running it

```
pnpm test matrix/          # everything but the browser: model, tables, partition, merge
pnpm test:matrix           # the 45 emulation cells, in a real Chromium
```

The first needs no browser at all. `--list` resolves a config and loads spec
files without launching one, and the fixture specs never take a `page` fixture,
so the whole sharding half — including the real sharded runs in `merge.test.ts`
— runs on a machine with nothing installed. In CI they are split accordingly:
the sharding half rides the `gates` job with the rest of `pnpm test`, and the
emulation half is the `matrix` job, which downloads Chromium.

## What is not measured here

**Firefox and WebKit.** Every cell of the emulation table is a claim about
Chromium. Holding the engine still is what makes the table mean anything — a
comparison that changed engine *and* emulation at once could not say which half
moved a cell — but it does mean this directory measures what emulation does,
not what an engine does. The registry claims in Part 1 are about all three,
because the registry is data.

**Wall clock.** The balance tables count tests, not seconds. A shard's cost is
its tests times their durations, and durations belong to a suite rather than to
sharding; what is measured here is the partition, which is deterministic. The
critical-path claims are about the busiest shard's *weight* and should be read
that way.

**`PWTEST_SHARD_WEIGHTS`.** Playwright accepts per-shard weights, which change
the cut boundaries without changing the groups. `shard.ts` models the uniform
case only, which is what `--shard=k/n` does.

## Files

| file | what it is |
| --- | --- |
| [`shard.ts`](./shard.ts) | the model of Playwright's partition, grouping and cut |
| [`fixture/`](./fixture/) | 24 empty tests in seven shapes, the subject of the measurement |
| [`fixture.ts`](./fixture.ts) | what is in the fixture, audited against disk by `fixture.test.ts` |
| [`grouping.ts`](./grouping.ts) | the sharding tables and their findings |
| [`list.ts`](./list.ts) | `playwright test --list`, as a function |
| [`reports.ts`](./reports.ts) | real sharded runs and `merge-reports`, as functions |
| [`partition.test.ts`](./partition.test.ts) | the model against the real CLI |
| [`merge.test.ts`](./merge.test.ts) | what a sharded run reports, and what it loses |
| [`probes.ts`](./probes.ts) | the thirteen in-page probes and their kinds |
| [`conditions.ts`](./conditions.ts) | desktop, narrow, emulated |
| [`page.ts`](./page.ts) | the fixture page, one media query per probe |
| [`emulation.ts`](./emulation.ts) | the emulation tables and their findings |
| [`emulation.spec.ts`](./emulation.spec.ts) | the 45 cells, against a real browser |
| [`playwright-matrix.config.ts`](./playwright-matrix.config.ts) | one project per condition |
