# Property-based testing with fast-check

Twenty properties over one small system, four different generators feeding
them, and a measurement of what each combination is actually worth.

The system is `availability.ts`: sets of half-open time ranges, with
`normalise`, `union`, `intersect`, `subtract`, `covers` and `duration`. It was
chosen because interval arithmetic is genuinely everywhere — calendars, rate
limits, feature-flag schedules, retention windows — its invariants are easy to
state and hard to satisfy, and its bugs live at boundaries a person writing
examples by hand tends not to type.

Run it:

```
pnpm test property/
```

---

## When a property is worth writing

Not "always". A property costs more than an example to write, is harder to read
six months later, and can be silently vacuous in a way an example cannot. Reach
for one when:

- **The output has a shape you can state.** Sorted, deduplicated, canonical,
  balanced, within bounds. These are the cheapest properties and they catch the
  bugs that produce a *plausible-looking wrong answer*.
- **Two ways of computing the same thing exist**, and one of them is too slow or
  too memory-hungry to ship. That is the model in `model.ts`, and it is the
  strongest thing in this directory.
- **The input space is combinatorial.** Not "large" — combinatorial. Nobody
  writes an example where a zero-length range sits exactly where two other
  ranges touch, because nobody thinks of it. The measurement for that claim is
  below and it is a factor of twenty-eight.

Do not reach for one when the behaviour *is* the specification — a tax band, a
rounding rule, a copy string. A property over "returns 20% for incomes between
£12,571 and £50,270" is the implementation, written twice.

---

## The three families of property

| Family | What it relates | What it cannot see |
| --- | --- | --- |
| **structural** | an output to itself | whether the answer is right |
| **metamorphic** | one run to another run | a system that is consistently wrong |
| **model** | the system to a reference implementation | anything outside the model's domain |

Structural properties are the ones people skip as too weak, and they catch a
class of bug nothing else can. `[0, 5)` and `[5, 9)` left unmerged cover exactly
the same points as `[0, 9)` — no comparison of *what is covered* will ever
notice, and only `normalise/canonical-form` does.

Model properties are the strongest and the most constrained. The model here
expands ranges into the set of integer points they cover, which is trivially
correct and O(covered length), so it can only be run over small integers — and
that single constraint makes two of the ten faults below invisible to the only
probe that runs it.

A system can satisfy every structural and metamorphic property here and still be
wrong: returning `[]` for everything is idempotent, commutative, impeccably
sorted and useless. That is the argument for having a model. A system can also
satisfy every model property and still be wrong, which is the argument for not
stopping there.

### The catalogue

Every property is declared once in `invariants.ts` and used three ways —
asserted against the real system, checked against each broken one, and printed
here under a test that compares the two.

- `normalise/canonical-form` (structural, any) — the output is sorted by start, contains no empty range, and no two consecutive ranges overlap or touch
- `normalise/uses-input-endpoints` (structural, any) — every start in the output is a start the caller supplied, and every end is an end the caller supplied — merging chooses among coordinates, it never invents one
- `normalise/does-not-mutate-input` (structural, any) — the caller’s array and ranges come back untouched
- `subtract/output-already-normalised` (structural, any) — subtract returns a canonical set directly, so normalising it again changes nothing
- `normalise/idempotent` (metamorphic, any) — normalising an already-normalised set returns it unchanged
- `normalise/preserves-covered-points` (metamorphic, any) — a point is covered by the normalised set exactly when it was covered before
- `union/commutative` (metamorphic, any) — union gives the same answer whichever way round its operands are
- `union/covers-either-operand` (metamorphic, any) — the union covers a point exactly when at least one operand does
- `intersect/commutative` (metamorphic, any) — intersection gives the same answer whichever way round its operands are
- `intersect/covers-both-operands` (metamorphic, any) — the intersection covers a point exactly when both operands do
- `intersect/self-is-normalise` (metamorphic, any) — a set intersected with itself is that set, normalised
- `subtract/covers-difference` (metamorphic, any) — the difference covers a point exactly when the first operand covered it and the second did not
- `subtract/self-is-empty` (metamorphic, any) — a set with itself removed leaves nothing
- `subtract/empty-removal-is-normalise` (metamorphic, any) — removing nothing from a set is the same as normalising it
- `duration/inclusion-exclusion` (metamorphic, bounded) — the covered length of the union plus that of the intersection equals the two operands’ lengths added together
- `normalise/matches-point-model` (model, bounded) — normalising a set gives the canonical cover of exactly the points it covered
- `union/matches-point-model` (model, bounded) — the union covers the union of the two point sets
- `intersect/matches-point-model` (model, bounded) — the intersection covers the intersection of the two point sets
- `subtract/matches-point-model` (model, bounded) — the difference covers the difference of the two point sets
- `duration/is-point-count` (model, bounded) — the covered length equals the number of points covered

`any` runs under every arbitrary; `bounded` needs the small integer domain,
either because it compares against the model or because it adds coordinates
together and floating-point addition is not associative.

---

## Custom arbitraries

**This is the part that decides what your property suite is worth.** Four of the
five columns in the detection matrix below run the *same twenty properties*.
They differ in nothing but the generator, and they catch four, six, seven and
ten of ten faults respectively.

### Build values, do not filter them

The standard advice, with the arithmetic behind it. `fc.record({start, end})`
produces a valid half-open range **46.4%** of the time — the other half have
their coordinates the wrong way round or equal. Add one more constraint and ask
for a *sorted, disjoint set* of three or more, and the yield collapses to
**1 in 1,000**.

At that yield the two ways of expressing the constraint fail differently, and
the difference matters:

- `.filter(isSortedDisjoint)` keeps working. It draws about a thousand times per
  accepted value and says nothing about it. A property that took milliseconds
  now takes seconds, and the only symptom is a slow suite.
- `fc.pre(isSortedDisjoint(set))` refuses: *"Failed to run property, too many
  pre-condition failures encountered … Ran 10 time(s), Skipped 20001 time(s)."*
  This is the better failure, because the diagnosis is in the error.

`boundedInterval` takes the advice: draw a start and a positive length, map them
into a range, discard nothing.

### The cost of "always valid"

A generator that cannot produce an invalid value also cannot produce a
**degenerate** one. `normalise` is documented to drop empty ranges, and three of
the four arbitraries here are structurally incapable of producing one — so that
branch is never executed and `KEEPS_EMPTY_RANGES` is invisible to all three.
`clustered` allows a zero-length range on purpose, produces one in 45.6% of
scenarios, and is the only probe that catches the fault.

Nobody tells you this half. "Never filter" is good advice that quietly narrows
what you are testing, and the narrowing is invisible from the call site.

### What the four arbitraries actually generate

Measured over 1,000 draws at the seed in `config.ts`, counted by `profile.ts`:

| Arbitrary | overlap | touch | containment | degenerate | negative | fractional | faults caught |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bounded` | 79.0% | 32.8% | 67.8% | 0.0% | 0.0% | 0.0% | 7 / 10 |
| `sparse` | 2.6% | 0.4% | 1.1% | 0.0% | 0.0% | 0.0% | 4 / 10 |
| `wide` | 93.2% | 0.0% | 88.7% | 0.0% | 90.7% | 97.5% | 6 / 10 |
| `clustered` | 80.0% | 49.4% | 67.6% | 45.6% | 16.2% | 96.9% | 10 / 10 |

| Arbitrary | how it is built |
| --- | --- |
| `bounded` | integers in [0, 64), lengths 1–16 |
| `sparse` | integers in [0, 5,256,000), lengths 1–16 |
| `wide` | doubles in ±1,000,000, independently placed |
| `clustered` | doubles in ±1,000,000, on a shared 20-cell grid, degenerate ranges included |

Three things in that table are worth stopping on.

**`sparse` is the reasonable choice, and it is the worst one.** Minutes across a
decade is what a person reaches for without thinking, every value it produces is
legal, the shrinker works, and two hundred runs pass. Two ranges drawn from five
million minutes collide in 2.6% of scenarios, so the merging logic that
`availability.ts` mostly consists of is barely executed. The arbitrary was not
incorrect. It was uninformative, and **nothing in the test output distinguishes
the two**.

**`wide` overlaps more than `bounded`, not less.** This is a property of
`fc.double` rather than of this code, and it is worth knowing: fast-check draws
doubles across the *bit-pattern* space, so a "uniform" ±1,000,000 range comes
back crowded with denormals and tiny magnitudes near zero. It also never
produces two equal endpoints — 0.0% touch — because two independently drawn
doubles never are, which is why it is the one probe that misses
`TOUCHING_NOT_MERGED`.

**`clustered` fixes it with one draw.** The origin and the grid spacing are
drawn *once for the whole scenario* and distributed by `map`, so every range
sits on the same grid and `origin + k * unit` computed twice is the same double.
Touching becomes possible (49.4%) without giving up the wide coordinate space.
Shared context in one draw, distributed by `map`, is the technique worth
stealing from this directory.

---

## Shrinking

Measured against `MERGE_LOSES_FURTHEST_END` — merging a long range with a short
one inside it truncates the long one — with the point-set model as the property.
`endOnFailure: true` gives the raw first counterexample; the default run gives
the reduced one.

| Arbitrary | first counterexample | after shrinking | shrink steps |
| --- | --- | --- | --- |
| built with `tuple` + `map` | size 734, six ranges | size 8, `[[0, 3), [1, 2)]` | 62 |
| `fc.constantFrom(...pool)` | size 826, ten ranges | size 826, ten ranges | 0 |

The reduced counterexample is the minimal statement of the bug: a range, and a
range inside it. Nothing is left to delete. That is the difference between a
counterexample that is a diagnosis and one that is a data dump — a **98%**
reduction in what a reader has to hold in their head.

The second row is the trap, and it is worth understanding because the broken
version *works*. Both arbitraries generate from the same distribution — the pool
was sampled from the first one — and both find the bug. But `fc.constantFrom`
makes every value a leaf: fast-check can pick a different entry from the list
and nothing else, so what comes back is whichever pre-generated monster sat
nearest the front of the pool. That is a fact about the pool's order, not about
the bug. Any arbitrary assembled by `map`/`chain` over primitives keeps the
shrinker working, because the shrinking happens underneath and the mapping is
replayed.

**Replay.** fast-check prints a seed *and a path* on failure. The seed re-runs
the whole property; the seed plus the path jumps straight to the failing input
in a single run. Both are asserted in `shrinking.test.ts` — worth knowing while
you are actually fixing something.

---

## The detection matrix

Ten single-behaviour faults (`faults.ts`), five probes, every combination run.

| Fault | examples | bounded | sparse | wide | clustered |
| --- | --- | --- | --- | --- | --- |
| `TOUCHING_NOT_MERGED` | ✓ | ✓ | ✓ | — | ✓ |
| `KEEPS_EMPTY_RANGES` | ✓ | — | — | — | ✓ |
| `MERGE_LOSES_FURTHEST_END` | ✓ | ✓ | — | — | ✓ |
| `DROPS_LAST_RANGE` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `NEGATIVE_START_CLAMPED` | ✓ | — | — | ✓ | ✓ |
| `FRACTIONAL_ENDPOINTS_ROUNDED` | ✓ | — | — | ✓ | ✓ |
| `INTERSECT_ADVANCES_BOTH` | ✓ | ✓ | — | ✓ | ✓ |
| `SUBTRACT_APPLIES_FIRST_ONLY` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SUBTRACT_OVERSHOOTS_BY_ONE` | ✓ | ✓ | — | — | ✓ |
| `SUBTRACT_TRUSTS_INPUT_ORDER` | — | ✓ | ✓ | ✓ | ✓ |
| **caught** | **9 / 10** | **7 / 10** | **4 / 10** | **6 / 10** | **10 / 10** |

The faults:

- `TOUCHING_NOT_MERGED` — two ranges that meet exactly — 09:00–10:00 and 10:00–11:00 — are reported as two separate slots instead of one two-hour slot
- `KEEPS_EMPTY_RANGES` — a slot that starts and ends at the same instant survives into the output
- `MERGE_LOSES_FURTHEST_END` — merging an all-day slot with a short one inside it shortens the day to the short one’s end
- `DROPS_LAST_RANGE` — the last slot of the day is silently missing from every answer
- `NEGATIVE_START_CLAMPED` — a slot that starts before the origin — yesterday, in an offset-from-midnight calendar — is pulled forward to the origin
- `FRACTIONAL_ENDPOINTS_ROUNDED` — a slot that starts at 09:30 is rounded to the nearest whole unit
- `INTERSECT_ADVANCES_BOTH` — when one long slot overlaps two shorter ones, the second overlap is dropped from the intersection
- `SUBTRACT_APPLIES_FIRST_ONLY` — only the first booking is removed from the day; the rest stay bookable
- `SUBTRACT_OVERSHOOTS_BY_ONE` — a booking removes one unit more than it occupies, so the minute after every meeting is unbookable
- `SUBTRACT_TRUSTS_INPUT_ORDER` — bookings that arrive out of order are partly ignored, so a slot stays bookable after it has been booked

### Read the examples column honestly

Twenty-four hand-written cases catch nine of ten, beating three of the four
property probes. **That is not evidence that examples are better, and it is not
evidence that they are worse.** The faults and the examples were written by the
same person from the same list of ways interval arithmetic goes wrong, so they
agree with each other by construction. No fault corpus assembled that way can
settle the comparison, and this one is not pretending to.

The one fault the examples miss is the interesting cell, because it escaped the
circle. Every removal in `examples.ts` is sorted and disjoint — that is what a
person writing bookings by hand produces, and what a database returns — so
`SUBTRACT_TRUSTS_INPUT_ORDER` never has its trigger typed. No example was
deleted to arrange that. The case simply never came up.

### Read the arbitrary columns literally

These four columns have no circularity in them at all. Same twenty predicates,
same faults, same seed, same everything **except the generator**: 4, 6, 7, 10.
Whatever a property suite is worth here, essentially all of it is decided by the
part of the code that gets skimmed in review.

Two of the misses are structural rather than unlucky:

- `bounded` is the only arbitrary the model can run against, and it cannot
  represent a negative or fractional coordinate — so it is blind to
  `NEGATIVE_START_CLAMPED` and `FRACTIONAL_ENDPOINTS_ROUNDED` no matter how
  many runs it gets. **The domain of your arbitrary is the domain of your
  test suite.**
- Three of the four cannot generate a degenerate range at all, so
  `KEEPS_EMPTY_RANGES` is unreachable for them.

One is luck, and is reported as luck: `sparse` catches `TOUCHING_NOT_MERGED` on
a single scenario out of two hundred. At 50 runs it does not.

### How many runs

`NUM_RUNS` is 200, and the figure is measured rather than chosen. Against the
`clustered` probe: 8 of 10 faults at 25 runs, 9 at 50, still 9 at 100, and 10 at
200. `SUBTRACT_OVERSHOOTS_BY_ONE` is the last one in — it needs a probe point
landing exactly on a removal's end while the range it came from extends past it.

---

## The measurement without a fault corpus in it

The matrix has a circularity in it. This does not.

`coverage.ts` classifies every input each probe actually uses by which of eight
structural *situations* it is in, and counts how many of the twenty-eight
**pairs** of situations any single input reaches.

- `overlap` — two ranges overlap
- `touch` — one range ends exactly where another begins
- `containment` — one range lies wholly inside another
- `degenerate` — a range covers no time at all
- `negative` — a coordinate is below zero
- `fractional` — a coordinate is not a whole number
- `unordered-removals` — the set being removed is not already sorted and disjoint
- `many-ranges` — four or more ranges are involved at once

| Probe | inputs | situations | pairs |
| --- | --- | --- | --- |
| `examples` | 24 | 6 / 8 | 1 / 28 |
| `bounded` | 200 | 5 / 8 | 10 / 28 |
| `sparse` | 200 | 5 / 8 | 7 / 28 |
| `wide` | 200 | 6 / 8 | 15 / 28 |
| `clustered` | 200 | 8 / 8 | 28 / 28 |

The example corpus reaches **more situations than the bounded arbitrary** — six
against five — and **one pair**. Not one pair per case; one pair in the whole
corpus, `overlap` together with `containment`, from the single example that
puts a short range inside a long one. Every other case tests its situation
alone.

That is not a criticism of whoever wrote them. It is what writing examples by
hand *is*: you write down the case you thought of, and the case you thought of
has one thing wrong with it at a time. Situations are what a person can
enumerate; pairs are what they cannot, and they grow quadratically while the
effort of writing examples grows linearly.

Bugs that survive review are usually not in the case somebody thought of.

---

## Determinism

Every property here runs at a fixed seed (`config.ts`). A property test without
one is a different test on every run, which is wrong for a merge gate in two
distinct ways: a failure is only reproducible by whoever still has the CI log,
and a property that catches a bug 3% of the time will go green on the pull
request that introduces it and red on an unrelated one a week later.

The cost is real: a pinned seed explores one sequence of inputs forever, so the
suite stops finding new things the moment it goes green. The honest arrangement
is both — this seed in CI, and a separate unpinned exploration run — and only
the first half is built here.

`fast-check` is pinned to an **exact** version rather than a caret range. A seed
only reproduces a run against the generator that produced it, and the value
stream fast-check derives from a seed is not part of its public API. Without the
pin, every number on this page would be correct on the commit that recorded it
and wrong after the next dependency bump, with nothing to say which.
`dependencies.test.ts` asserts the pin; upgrading fast-check here means
re-running the measurements and updating this file in the same commit.

---

## What is not built

- **No unpinned exploration run.** See above. The machinery for a nightly job
  that varies the seed and reports new counterexamples belongs with the flake
  work in Phase 11, and is not here.
- **The fault corpus can rot in one direction.** `faults.test.ts` fails if a
  fault stops being a bug, or if two faults become the same bug. It cannot tell
  that a fault has quietly become *two* bugs, which would make its row in the
  matrix easier to catch than it should be.
- **`coverage.ts`'s eight situations are a judgement call.** They were chosen
  before the counting, from the branches `availability.ts` actually has plus the
  two coordinate classes the model cannot represent — but a different eight
  would give different numbers. The 1-of-28 result is robust to that choice; the
  exact figures are not.
- **`fc.statistics` is not wired in.** It is the right tool for looking at a
  distribution while writing an arbitrary and the wrong one afterwards, because
  nothing fails when the distribution moves. `profile.ts` is the version with a
  test attached.
- **No stateful (model-based command) testing.** fast-check's `fc.commands` runs
  sequences of operations against a model, which is the natural next step for a
  system with mutable state. `availability.ts` has none.

---

## Files

| File | What it is |
| --- | --- |
| `availability.ts` | the system under test |
| `model.ts` | the obviously-correct reference implementation |
| `arbitraries.ts` | the four generators, and the naive draws kept to be measured |
| `invariants.ts` | the twenty properties, as data |
| `examples.ts` | the example suite the comparison is against |
| `faults.ts` | ten single-behaviour bugs |
| `probes.ts` | the five ways of putting a system under test |
| `matrix.ts` | every probe against every fault |
| `coverage.ts` | the situation and situation-pair counting |
| `profile.ts` | what each arbitrary generates, counted |
| `shrinking.ts` | shrinking measured with and against itself |
| `config.ts` | the seed, the run count, and why both are written down |
