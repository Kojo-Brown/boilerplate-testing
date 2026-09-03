# Deterministic time and randomness

Fake timers, injected clocks, seeded RNG — the three pieces of advice everyone
gives, and this directory is about what each one actually buys.

The short version, measured rather than argued:

> **Seeding a generator changes no cell in the detection matrix.** It makes a
> suite fail the same way twice, which is worth having and is not the same
> thing as seeing more. Applied to an uncontrolled clock it moves 12 → 12;
> applied on top of fake timers it moves 13 → 13.

> **`vi.spyOn(Math, 'random').mockReturnValue(0.5)` is worse than doing
> nothing.** It catches 9 of the 15 faults where an entirely uncontrolled test
> catches 12, and the 9 are a strict subset of the 12.

> **One fault changes the output on 99.99% of the draw space and every
> random-draw strategy still misses it.** Being visible in the input space is
> not the same as being asserted on.

---

## The experiment

One subject — `session.ts`, an access-token issuer with a jittered background
refresh — chosen because it is the smallest realistic thing that touches all
five sources of nondeterminism at once:

| Source | In the subject | Read from |
| --- | --- | --- |
| wall clock | stamping an expiry | `Date.now()` |
| monotonic clock | measuring how long an operation took | `performance.now()` |
| randomness | jittering the refresh so clients do not bunch up | `Math.random()` |
| scheduler | running the refresh later | `setTimeout` |
| identity | naming the session | `crypto.randomUUID()` |

13 behaviours (`contract.ts`) are the whole of what any strategy is
allowed to assert, written once and shared, so that the comparison is about the
strategy and not about who wrote the better suite. Fifteen single-behaviour
faults (`faults.ts`) are applied as edits to the real source — every anchor must
match exactly once, so a change to `session.ts` that invalidates one fails
`pnpm test` rather than quietly measuring nothing. Six strategies
(`worlds.ts`) run all thirteen behaviours against all fifteen faults plus an
unedited control.

## What each strategy can even state

Reach is derived, not declared. Each behaviour names the capabilities it needs;
each strategy names the capabilities it has; the reach is the subset relation.
That matters because the headline result *is* the list, and a hand-written list
would be whatever somebody believed on the day.

| Strategy | What you type | Behaviours reachable |
| --- | --- | --- |
| `ambient` | nothing at all | **8 / 13** |
| `constant-random` | `vi.spyOn(Math, 'random').mockReturnValue(0.5)` | **7 / 13** |
| `seeded-random` | `Math.random` from a seeded stream | **8 / 13** |
| `fake-timers` | `vi.useFakeTimers({ now: EPOCH })` | **10 / 13** |
| `standard` | fake timers **and** a seeded generator | **10 / 13** |
| `injected` | every source passed in | **13 / 13** |

Two behaviours are statable only with every source injected:

- **`duration-comes-from-the-monotonic-clock`** needs the wall clock to move
  while the monotonic clock stands still. `fidelity.test.ts` asks Vitest for
  that directly and does not get it: `vi.advanceTimersByTime(500)` moves
  `Date.now()` by 500 and `performance.now()` by 500, and `vi.setSystemTime`
  repoints the wall clock without moving the monotonic one *forwards*, so a
  duration measured across it is still zero. The two clocks are locked by
  design, which is exactly the design that makes the fault invisible.
- **`a-low-draw-refreshes-earlier-than-a-high-draw`** needs a *chosen* draw, not
  a repeatable one. A seed gives you the second and never the first.

And the split nobody expects: a constant draw and a varying one are not
stronger and weaker versions of each other. `delay-centres-on-half-the-lifetime-at-the-median-draw`
is reachable only by the constant, because a seeded stream will essentially
never produce exactly 0.5; the two band behaviours are reachable only by the
varying one, because a constant satisfies "inside the band" trivially.

## The detection matrix

| Strategy | Caught | Missed |
| --- | --- | --- |
| `ambient` | **12 / 15** | `EXPIRY_BOUNDARY_EXCLUSIVE`, `ELAPSED_FROM_WALL_CLOCK`, `JITTER_SIGN_FLIPPED` |
| `constant-random` | **9 / 15** | those three, plus `JITTER_RANGE_HALVED`, `JITTER_NOT_CLAMPED`, `MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES` |
| `seeded-random` | **12 / 15** | `EXPIRY_BOUNDARY_EXCLUSIVE`, `ELAPSED_FROM_WALL_CLOCK`, `JITTER_SIGN_FLIPPED` |
| `fake-timers` | **13 / 15** | `ELAPSED_FROM_WALL_CLOCK`, `JITTER_SIGN_FLIPPED` |
| `standard` | **13 / 15** | `ELAPSED_FROM_WALL_CLOCK`, `JITTER_SIGN_FLIPPED` |
| `injected` | **15 / 15** | — |

Nine faults are caught by every strategy. They are the baseline: a probe that
misses one of *those* is broken rather than limited, and without them the table
has nothing to be measured against.

### Seeding buys reproducibility, not sight

`ambient` and `seeded-random` catch **the same twelve faults**. `fake-timers`
and `standard` catch **the same thirteen**. The seed changes nothing about what
can be seen — twice, at both ends of the table.

This is not an argument against seeding. A suite that fails differently on every
run is a suite whose failures nobody can act on, and `fuzz/settings.ts` makes
that case at length. It is an argument against the belief that seeding is a step
towards *coverage*. It is a step towards being able to read the report.

### The most commonly written line is the weakest strategy

`vi.spyOn(Math, 'random').mockReturnValue(0.5)` catches nine faults. Writing no
control at all catches twelve, and the nine are a strict subset. Pinning every
draw to the midpoint gains one behaviour — the median claim, which nothing else
here can state — and loses three faults for it: the halved jitter window, the
missing clamp, and the clamp that only catches negatives are all invisible to a
suite that only ever sees one value.

The trade is real and it is defensible in one direction. What is not defensible
is making it by accident, which is what happens every time that line is written
to "make the test deterministic".

### Two faults survive everything short of injection

`ELAPSED_FROM_WALL_CLOCK` — measuring a duration by subtracting two `Date.now()`
readings — is the most common timing bug in production code, and no fake-timer
library can see it, because seeing it requires separating two clocks that every
fake-timer library deliberately locks together.

`JITTER_SIGN_FLIPPED` is the more interesting one, and the reason
`sensitivity.ts` exists.

## Visibility is not detectability

`sensitivity.ts` evaluates the delay at every draw on a 10,000-point grid, for
the control and for each faulted copy, and reports the fraction of the draw
space on which they differ. The number is computed, not sampled — a random
estimate of how often a random test fails would itself need error bars.

| Fault | Visible on | Visible at the midpoint |
| --- | --- | --- |
| `JITTER_SIGN_FLIPPED` | **99.99%** | no |
| `JITTER_RANGE_HALVED` | **99.99%** | no |
| `JITTER_ALWAYS_POSITIVE` | **88.75%** | yes |
| `REFRESH_FRACTION_TOO_LATE` | **88.75%** | yes |
| `JITTER_NOT_CLAMPED` | **31.24%** | no |
| `MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES` | **10.00%** | no |

Nine of the fifteen faults do not touch the draw at all, and no number of
samples reaches a fault the draw does not influence. That is the quiet argument
against "seed it and run it a lot" as a strategy.

But the row that matters is the first. `JITTER_SIGN_FLIPPED` changes the delay
on **99.99% of the draw space** and every random-draw strategy in the matrix
misses it. There is no tension here once it is said plainly: a test that draws
randomly sees a different number and *has nothing to compare it against*. Only
a test that chose the draw knows that 0.1 should refresh sooner than 0.9. The
fault is maximally visible and completely unasserted, and the two facts are
about different things.

## How many draws a band check needs

`BAND_DRAWS` is 512, and it comes out of the table above rather than from a
round number. The narrowest fault is visible on 10.00% of the space, so:

| Draws | Chance of seeing the narrowest fault |
| --- | --- |
| 3 | 27.1% |
| 12 | 71.8% |
| 512 | 1 − 1.4 × 10⁻²⁴ |

A dozen draws is what a hand-written band check uses, and on this fault it is a
coin toss — so the matrix would have been reporting the seed rather than the
technique. At 512 every cell that depends on a tail is decided.

## The gate

None of the above says whether *this repository* controls its own
nondeterminism, and a pattern library that documents determinism while quietly
reading `Date.now()` in nine places is worse than one that says nothing.

So `audit.ts` parses every TypeScript file in the repository and finds every
read of a clock, a draw, an identity source or a scheduler. Each one must have a
row in `registry.ts` giving a disposition and a sentence of reason; each row
must match a read. Closed in both directions, like `mutation/scope.ts` and
`snapshot/registry.ts`, and pinned by count, because "this file is allowed to
read the clock" waves through the eleventh read in a file that has ten.

Five dispositions, meant to be exhaustive for a healthy repository:
`measured`, `seam-default`, `inert`, `masked`, `shaping`. A site that fits none
of them is a signal about the site, not a missing word.

**Why the parser and not a regular expression.** A pattern match over this
repository finds 19 sites outside `determinism/`. Four are not uses at
all — two string literals in `tdd/characterisation/characterisation.ts` naming
the calls it removed, a sentence in a comment in `legacy/renewal.ts`, and a
*test title* in `seams.test.ts` reading ``'reads the wall clock, as the inlined
`new Date()` did'``. That is a 21% false-positive rate, which is a gate somebody
switches off. The parser reports **15**, and the difference is not cleverness:
it already knows the difference between a call and a sentence about a call.

Every failure the gate can report is caused deliberately in `audit.test.ts` and
the message checked. A gate that cannot fail has not been tested.

**Its blind spot**, stated rather than discovered later: a computed callee
(`globalThis['Date'].now()`) cannot be named and is not reported.

## Two things this directory does on purpose that the repository forbids

`CLAUDE.md` says: deterministic by construction, injected clocks, seeded RNG, no
sleeps. Three of the six strategies here use real clocks and real sleeps,
because the cost of *not* controlling time is half of what is being measured and
cannot be measured by a probe that has already been fixed. Those reads are
registered as `measured` — the one disposition that argues *for* ambient
nondeterminism — and confined to this directory, which `audit.test.ts` checks.

The fake-timer strategies model `vi.useFakeTimers()` rather than installing it:
it replaces globals process-wide, so no two strategies could run at once and the
ambient one would be measuring a fake clock. A model nobody checks is a comment,
so `fidelity.test.ts` runs the real tool against the real `ambientEnvironment`
and asserts the four properties the model depends on. If Vitest ever gains a way
to skew the wall clock against the monotonic one, that file goes red and this
README is wrong.

## Two things measured along the way

**A jittered delay is a float and no scheduler honours one.** The delay here is
typically something like 20.0527ms, and both Vitest's fake clock and Node's real
one quantise to whole milliseconds. That is where `EARLY_TOLERANCE_MS` comes
from: a probe asserting a callback did not fire early has to allow the
millisecond the scheduler rounded away, or it reports a fault every time the
draw is fractional — which is most of the time.

**A real-clock test may only assert lower bounds.** Late is indistinguishable
from busy, so "the callback ran within 30ms" is a claim about the runner's load.
"The callback did not run before 30ms" is a claim about the code, because
nothing makes a timer fire early. Every timing assertion in `probes.ts` is
one-sided for that reason, and the real-clock strategies wait a deliberately
generous 200ms past a deadline before calling a callback missing.

**One side effect worth knowing about.** `SCHEDULE_AT_ABSOLUTE_TIME` hands
`setTimeout` an instant where it expects a delay. Node clamps an out-of-range
delay to 1ms and prints `TimeoutOverflowWarning` — which is where the handful of
those in a `pnpm test` run come from. The fault is caught by every strategy, but
for opposite reasons: under a hand-drained queue the callback never comes due,
and under Node it fires almost immediately.

## When to reach for which

- **Fake timers** when the question is about an instant or an interval — an
  expiry boundary, a debounce, a retry schedule. They are the largest single
  jump in the table (8 → 10 behaviours, 12 → 13 faults) and they need no
  refactor.
- **A seeded generator** when you need to be able to read the report. Expect no
  new detections from it; expect to stop re-running the job.
- **A constant draw** only when the midpoint is the case you mean, and never as
  a way to "make it deterministic" — it is the one strategy here that is
  strictly worse than doing nothing.
- **Injection** when the code decides something from a value it drew, or
  measures a duration. It costs a parameter and it is the only thing in this
  table that reaches the last two faults.

## Files

| File | What it is |
| --- | --- |
| `session.ts` | The subject: issue, expire, jitter, schedule, renew, time |
| `environment.ts` | The five sources behind one seam; ambient, manual and deterministic implementations |
| `contract.ts` | The thirteen behaviours and the capabilities each needs |
| `worlds.ts` | The six strategies and the capabilities each has |
| `probes.ts` | The behaviours as executable checks, shared by every strategy |
| `faults.ts` | Fifteen single-behaviour edits to the real source |
| `load.ts` | Compiling and importing one faulted copy |
| `matrix.ts` | The measurement: every strategy against every fault, plus the control |
| `sensitivity.ts` | How much of the draw space each fault occupies |
| `audit.ts` / `check.ts` / `registry.ts` | The repository-wide gate |
