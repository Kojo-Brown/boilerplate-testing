# Concurrency testing: race detection and deterministic async scheduling

Every other detection matrix in this repository is boolean: the probe catches
the fault or it does not. That answer is the wrong shape for concurrency, and
wrong in the direction that gets people hurt.

A strategy that catches a race **one run in seven** does catch it. The cell gets
a tick. In a suite it is a test that goes red on somebody else's pull request,
green on the re-run, and quarantined by the end of the month — and the bug is
still there. So every cell below is a **detection rate**: how often, over
independent trials, the strategy produced a run that broke an invariant.

One subject (`ledger.ts`), thirteen single-behaviour faults applied as edits to
the real source, six strategies, eight scenarios, and a scheduler that can take
the interleaving away from the runtime and hand it back as a list of integers.

## What is being compared

| Strategy | Overlap | Interleaving decided by | Trials | Executions per trial |
| --- | --- | --- | --- | --- |
| `sequential` | no | nothing — one operation at a time | 1 | 8 |
| `concurrent` | yes | the microtask queue | 1 | 8 |
| `jittered` | yes | a seeded delay on every store call | 500 | 8 |
| `stress` | yes | as `jittered`, 25 times over | 80 | 200 |
| `schedule` | yes | a uniform draw over pending operations | 500 | 8 |
| `systematic` | yes | enumeration of the choice tree | 1 | 12 |

`systematic`'s cost is the one number in that column that is a property of the
*subject* rather than of the strategy. Twelve is what the correct ledger costs.
A faulted one costs up to 383, and that turns out to be the most interesting
result here.

## The matrix

Detection rate per fault, over the trials above.

| Fault | `sequential` | `concurrent` | `jittered` | `stress` | `schedule` | `systematic` |
| --- | --- | --- | --- | --- | --- | --- |
| `MUTEX_NEVER_MARKED_HELD` | 0.000 | 1.000 | 1.000 | 1.000 | 0.996 | 1.000 |
| `MUTEX_ACQUIRE_DOES_NOT_WAIT` | 0.000 | 1.000 | 1.000 | 1.000 | 0.996 | 1.000 |
| `MUTEX_RELEASE_ALWAYS_CLEARS_HELD` | 0.000 | 0.000 | 0.150 | 0.963 | 0.078 | 1.000 |
| `MUTEX_WAKES_THE_NEWEST_WAITER` | 0.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `LOCK_RELEASED_ONLY_ON_SUCCESS` | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `DEPOSIT_NOT_LOCKED` | 0.000 | 1.000 | 1.000 | 1.000 | 0.988 | 1.000 |
| `DEPOSIT_UNLOCKS_BEFORE_WRITING` | 0.000 | 0.000 | 0.634 | 1.000 | 0.950 | 1.000 |
| `SETTLE_APPLIES_IN_PARALLEL` | 1.000 | 1.000 | 1.000 | 1.000 | 0.816 | 1.000 |
| `READ_NEVER_COALESCED` | 0.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `READ_STAYS_IN_FLIGHT` | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `OVERDRAFT_CHECK_SOFTENED` | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `TRANSFER_CREDITS_WITHOUT_DEBITING` | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `DEPOSIT_WRITES_THE_AMOUNT_NOT_THE_SUM` | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| **reached** | **6** | **11** | **13** | **13** | **13** | **13** |
| **reached in every trial** | **6** | **11** | **11** | **12** | **7** | **13** |

`detection.test.ts` asserts every number above against the live run, so the
table cannot drift away from the code. The third decimal is noise: 500 trials at
p ≈ 0.15 carry a 95% interval of roughly ±0.031, and a disjoint family of 1,000
seeds is held to within 0.05 of the figure quoted here rather than to the figure
itself.

## Five findings

### 1. `await Promise.all([...])` is not a search

It is the first thing anybody writes when told to test concurrent code, and it
explores exactly **one** interleaving — the same one, on every machine, forever.
`Promise.all` starts the tasks and the microtask queue then runs them in a fixed
order. Every cell in the `concurrent` column is 0.000 or 1.000; not one lands in
between.

That is the opposite of both properties people assume it has. It cannot be
flaky, which is a comfort. It cannot find anything outside the schedule the
engine happens to pick, which is why it misses two faults here — and it misses
them *reliably*, on every run, which is the failure mode nobody investigates.

It is still the best value in the table: five faults no sequential test can
reach, for the same eight executions.

### 2. The window size is the whole story, and a boolean matrix hides it

Two faults in the corpus are the same bug at two sizes:

- `DEPOSIT_NOT_LOCKED` removes the lock from a read-modify-write. Detected in
  every jittered run.
- `DEPOSIT_UNLOCKS_BEFORE_WRITING` keeps the lock and shortens the critical
  section by one statement. Detected in 63.4% of them.

And `MUTEX_RELEASE_ALWAYS_CLEARS_HELD` — a `release` that marks the lock free
*and* wakes a waiter — needs a third task to arrive at the lock in the moment
between a hand-off and the new holder's first `await`. 15.0%.

Ticked, all three, in a boolean table. The difference between them is the
difference between a test suite and a lottery: at 15.0% a gate needs **29** runs
of the whole scenario set to be 99% sure, against one.

### 3. A stress loop buys a lot and cannot buy certainty

Twenty-five repeats turn 15.0% into a measured 96.3% — close to the 98.3% that
independent repeats predict. It is a real improvement for a real cost (200
executions per trial instead of 8).

It is also, still, a gate that reports green on a genuine bug **once every
twenty-seven CI runs**. The arithmetic is exponential in the wrong direction:
the runs needed for a fixed confidence grow as the rate falls, so the faults a
stress loop is worst at are exactly the ones it needs to be longest for, and
nobody knows which those are in advance.

### 4. Drawing the schedule at random is worse than letting the runtime pick

This is the result that surprised the directory into existing.

Taking the interleaving away from the runtime and choosing uniformly at random
among pending operations makes **four faults flaky that `concurrent` caught in
every single run**, including two where mutual exclusion is gone altogether
(0.996) and the self-racing batch (0.816). It also finds the narrowest fault
about half as often as chaos delays do (0.078 against 0.150).

A uniform draw spreads operations out. A lost update needs them bunched — the
second task's read has to land inside the first task's read-modify-write, and a
scheduler that keeps picking a different task keeps stepping over it. Randomness
is not the property that finds races; *coverage of the orderings that matter*
is, and a uniform draw is a poor proxy for it.

What the controlled scheduler does buy is the thing the flaky strategies cannot:
a failure comes back as `choices: [1, 1, 0, 1, 0, 1, 0]`, and replaying those
integers reproduces it exactly. `detection.test.ts` replays the witness of all
thirteen faults and asserts the same invariants break.

### 5. Correct code has almost no interleavings; the bug creates them

Enumerating every interleaving of a scenario sounds like the expensive option.
Measured, in scenario executions to cover the whole choice tree:

| Scenario | correct | `MUTEX_RELEASE_ALWAYS_CLEARS_HELD` | `DEPOSIT_NOT_LOCKED` | `MUTEX_NEVER_MARKED_HELD` |
| --- | --- | --- | --- | --- |
| `two-deposits` | 1 | 1 | 6 | 6 |
| `race-to-empty` | 1 | 1 | 1 | 64 |
| `queued-writers` | 1 | 1 | 90 | 90 |
| `late-arrival` | 5 | 12 | 210 | 210 |
| all eight | **12** | **19** | **320** | **383** |

A lock that works leaves one store operation outstanding at a time. With one
pending operation there is nothing to choose, so the tree is a line: the correct
ledger's entire interleaving space is **12 runs**, and enumerating it is
cheaper than one trial of the stress loop.

The space is opened up by the fault. `MUTEX_NEVER_MARKED_HELD` — every acquire
walks straight through — takes `late-arrival` from 5 interleavings to 210. Which
is the honest statement of when this technique works: it is affordable exactly
while the code under test is serialising properly, and the run that costs the
most is the one that is about to find something.

For the fault that beats every other strategy, the whole tree is **12 runs of
one scenario**, complete, certain. The stress loop spends 200 executions per
trial and is 96.3% sure.

## The subject

`ledger.ts` is an account ledger over an asynchronous store, built from the
three patterns that put an `await` in the middle of a critical section:

- **Read-modify-write** (`deposit`) — the lost update.
- **Check-then-act** (`transfer`) — a decision made against a value another
  operation can invalidate before the write lands.
- **In-flight coalescing** (`balance`) — the standard fix for a cache stampede,
  and itself concurrent code: a map of pending reads shared between tasks.

Plus `createMutex`, which is where six of the thirteen faults live. The store
offers no transaction and no compare-and-set, deliberately: a ledger built on
those would be correct without a lock, which would make it a fine service and a
useless subject.

## How the scheduler works

JavaScript has no threads. A task can only lose control at an `await`, and every
`await` in `ledger.ts` is waiting on the store — so **the store is the
scheduler**. Hand the subject a store whose promises settle when the harness
says they settle, and the interleaving becomes a value:

```ts
const run = await runScheduled(subject, plan, (count, step) => choices[step] ?? 0)

run.schedule.choices  // [1, 1, 0, 1, 0, 1, 0] — the whole run, reproducibly
run.schedule.options  // how many operations were pending at each decision
```

`runtime.ts#runScheduled` starts the tasks, lets the microtask queue go quiet
(one `setImmediate`), then repeatedly settles one pending operation and lets it
go quiet again. Nothing else can move in between, which is what makes the
choices a complete description of the run.

`systematic` walks that tree depth-first, re-running the scenario from the start
for each path — a JavaScript continuation cannot be forked, and the scenarios
are microseconds each.

### Deadlock is a fact, not a timeout

Two faults produce no answer rather than a wrong one. `await Promise.all(tasks)`
on `LOCK_RELEASED_ONLY_ON_SUCCESS` never resolves, and a test written the
ordinary way does not fail — it hangs until the runner kills the file, which is
the least useful failure a suite can produce.

So no runner here ever awaits the work directly. `runFree` awaits *event-loop
turns*, up to a budget, and reports whether the tasks finished; a scheduled run
reports a deadlock as "nothing left to settle and tasks still outstanding". Both
come back in microseconds, attributed to the scenario, through the
`every-task-settles` invariant. It is the one race every strategy in the table
catches — including `sequential`, because the second caller is the test's own
next line.

## What this does not cover

- **The scheduler only permutes the awaits it owns.** Every `await` in the
  subject is on the store. A subject that also awaits a `fetch`, a timer, or
  another service's client has interleavings this cannot reach, and `systematic`
  would be exhaustive over a strict subset while reporting `complete: true`.
- **`systematic` is bounded** at 400 executions per scenario. Every variant here
  finishes inside it — the largest is 210 — but the tree grows fast with the
  number of concurrent tasks, and a scenario that hits the budget reports
  `complete: false` rather than pretending.
- **One subject, thirteen faults, chosen by one person.** The corpus is built
  with a deliberate spread of window sizes, which is the axis the findings are
  about, and that is still a fact about the corpus. What is *not* circular is
  the ordering between strategies: they all run the same scenarios and the same
  invariants, so the columns are comparable even if the rows are somebody's
  list.
- **The rates are properties of a seed family**, not of a wall clock. A real
  jittered suite draws from `Math.random()` and a real machine's timers; this
  one counts microtasks from a seeded generator, so `jittered` here has a
  *better* failure story than the version people write — a failure comes back
  with the seed. The detection rates should transfer; the reproducibility should
  not be assumed to.
- **Nothing here says the invariants are any good.** A suite of vacuous
  invariants would show every strategy at 0.000 and look like a scheduling
  problem.

## Files

| File | What it is |
| --- | --- |
| `ledger.ts` | The subject: mutex, read-modify-write, check-then-act, coalescing. |
| `runtime.ts` | The two runners — free and scheduled — and the deadlock budget. |
| `scenarios.ts` | Eight scenarios and the thirteen invariants they are judged by. |
| `faults.ts` | Thirteen single-behaviour edits to the real source. |
| `load.ts` | Compiles and imports one faulted copy. |
| `strategies.ts` | The six strategies, and the confidence arithmetic. |
| `matrix.ts` | The measurement: every strategy against every variant. |
| `detection.test.ts` | Every number in this README, asserted against the run. |

## When to reach for which

- **Always** write the sequential tests. They catch every bug whose concurrency
  is inside one call, plus the deadlock, and they are the cheapest thing here.
- **`Promise.all` on the operations that share state** is the highest-value line
  in the table: five more faults for nothing. Just do not believe it is
  searching.
- **Reach for a controlled scheduler** when a bug has already been seen once and
  cannot be reproduced, or when the code being written is the lock itself. The
  interleaving space of correct code is small; enumerating it is usually cheaper
  than the stress loop somebody is about to write, and it comes back with a
  schedule instead of a rate.
- **Reach for the stress loop last**, knowing what it is: a lottery with good
  odds, priced per ticket, that cannot tell you it has finished.
