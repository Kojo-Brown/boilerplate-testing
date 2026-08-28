# Mutation testing with Stryker

Coverage says a line ran. A mutation score says a change to that line was
noticed. This directory measures the second one over a declared set of modules
and fails CI when it drops.

```bash
pnpm mutation:check           # run Stryker, then gate on the report
pnpm mutation:check --report-only   # re-score the last run without re-running it
```

---

## What the score is

Stryker rewrites the source under test one small change at a time — `<` becomes
`<=`, a `&&` becomes `||`, a function body becomes `{}`, a string becomes `""` —
and runs the tests against each version. A mutant is **killed** if some test
fails, and **survives** if they all still pass. A survivor is a change to the
production code that your suite is indifferent to.

Two percentages come out, and they are not interchangeable:

```
mutation score          = detected / (detected + survived + uncovered)
score on covered code   = detected / (detected + survived)
```

The second drops the mutants no test executed at all. It is a useful thing to
know and a catastrophic thing to gate on: **deleting the only test for a
function moves its mutants from "survived" to "uncovered", so the covered score
goes up.** This gate uses the first. The experiment at the bottom of this file
shows the two disagreeing by 41.67 points on one commit.

Line coverage cannot make this distinction at all. It counts execution, and a
test that executes a line without asserting anything about the result is
indistinguishable from one that pins it down.

---

## What it measures here

Measured 2026-08-28 on Node 22.22.2 with Stryker 10.0.0 and four workers.
257 mutants, 2 minutes 54 seconds.

| module | score | floor | detected | headroom | uncovered | survived |
|---|---|---|---|---|---|---|
| `property/availability.ts` | 83.66% | 78% | 128/153 | 8 | 5 | 20 |
| `tdd/conventions/refundPolicy.ts` | 96.00% | 90% | 48/50 | 3 | 0 | 2 |
| `factories/defineFactory.ts` | 100.00% | 85% | 14/14 | 2 | 0 | 0 |
| `tdd/doubles/registerUser.ts` | 87.50% | 80% | 35/40 | 3 | 0 | 5 |
| **all scoped modules** | **87.55%** | **83%** | 225/257 | 11 | 5 | 27 |

*Headroom* is how many detected mutants a module may lose before its floor
binds. It is the number that says whether a threshold has teeth, and it is
derived from the floor by `policy.ts#headroom` rather than written down twice.

The floors are stated in mutants rather than percentage points because points
are not comparable across modules: one lost mutant is 7.1 points on
`defineFactory.ts` and 0.65 on `availability.ts`.

Stryker is pinned to an exact version rather than a range, for the reason
`property/` pins fast-check: a score is only meaningful against the corpus that
produced it. A minor release that adds a mutator changes the denominator of
every number on this page and quietly moves four floors, with no diff to
review. `scope.test.ts` fails if the pin loosens.

---

## The scope is declared, the suites are not

`scope.ts` is a closed table of four modules. Mutation testing is minutes where
everything else here is seconds, so pointing it at every source file would
produce a job nobody waits for — and a gate nobody waits for acquires
`continue-on-error: true` within a month. Each entry states the floor and the
reason that module is worth the minutes.

The table is closed in *both* directions and `policy.ts` fails a run either
way: a module in the table with no row in the report, and a file in the report
with no floor. `stryker.config.ts` derives its `mutate` list from the same
array, so the glob and the table cannot drift apart.

Which **suites** run is the part not written down, and that is deliberate. A
scoped mutation run has one way to report a badly wrong number: load too few
suites, and every mutant that only the missing suite would have caught is
recorded as a survivor. The report then says the tests are weak when the truth
is that they were not invited.

So `reach.ts` walks the import graph — the same walk `shape/classify.ts` does
for the ratio policy, built from the same exported primitives — and answers
*every test file that can reach this module*. For `property/availability.ts`
that is nine suites. The three a person would list by hand (`invariants`,
`examples`, `model`) score it at **81.05%**. The nine the graph finds score it
at **83.66%**, because `detection.test.ts` and `faults.test.ts` reach it
through two hops and never name it. The hand-written list would have
understated the suite by 2.61 points and blamed the tests.

---

## What the floors actually catch

Folklore says a mutation score catches a weakened test. Measured on this
repository, it mostly does not — the suites here are redundant enough to cover
for each other:

| change | `defineFactory.ts` | `refundPolicy.ts` |
|---|---|---|
| baseline | 100.00% | 96.00% |
| delete one assertion (`expect(w.count).toBe(999)`) | 100.00% | — |
| delete the whole `applies overrides on top of defaults` test | 100.00% | — |
| delete the rounding behaviour from **both** suites that test it | — | 96.00% |
| delete one of the two suites entirely | — | 96.00% |
| **add 8 lines of untested code** | **58.33%** | — |

The last row is the one the floors are set for. One small exported function
with no test pointed at it took `defineFactory.ts` from 100.00% to 58.33%
(14 detected of 24) — straight through its 85% floor. Its **covered** score
over the same run was 100.00%, which is the whole argument for gating on the
other number.

The other rows are a finding rather than a disappointment, and the gate reports
the thing that explains them: the `sole` column, which counts the mutants only
one suite reaches. `defineFactory.ts` has 14 of 14 sole to
`factories/factories.test.ts`; `availability.ts` has **zero** sole across nine
suites; `refundPolicy.ts` has zero across two. Where `sole` is zero, deleting a
suite costs nothing measurable — which is worth knowing about a suite either
way.

---

## Two suites over the same code

Both scoped comparisons in this repository turn out to be measurable with one
run, and both say something the suites' own tests cannot.

**Properties vs examples** (`property/availability.ts`, 153 mutants).
`property/README.md` reports its example-vs-property comparison as circular:
24 examples and 10 hand-written faults came from the same person's list, so
they agree by construction. Stryker's corpus is drawn from neither. Against it:

| | killed |
|---|---|
| 20 fast-check invariants (`invariants.test.ts`) | 99 |
| 24 hand-written examples (`examples.test.ts`) | 101 |
| both | 92 |
| invariants only | 7 |
| examples only | 9 |
| either | 108 (70.59%) |

They are the same strength to within two mutants, and each catches a handful
the other does not. The uncomfortable line in that table is the third-party
one: `property/readme.test.ts`, which exists to check that the README's numbers
match the code, kills **111** — more than either suite written to test the
system. Asserting on a documented worked example turns out to be a strong test.

**Arrange-Act-Assert vs Given-When-Then** (`tdd/conventions/refundPolicy.ts`,
50 mutants). The two suites cover exactly the same 46 mutants, neither has a
single mutant to itself, and each one *alone* scores **96.00%** — identical to
running both. `tdd/conventions/README.md` argues the conventions differ in
readability and in nothing else; a mutant cannot tell them apart, which is
about as direct a confirmation as that claim can get.

---

## What the run found

The gate prints every mutant nothing noticed. Five of them are one story.

`tdd/doubles/registerUser.ts` rejects a malformed address with
`{ status: 'rejected', reason: 'INVALID_EMAIL' }`, and its survivors are both
anchors of the email regex plus all three parts of that object — emptying the
status, emptying the reason, and replacing the whole object with `{}`. Nothing
in `tdd/doubles/` asserts the rejection *reason* on that path; `EMAIL_TAKEN` is
pinned in `probes.ts` and `INVALID_EMAIL` never is. The suite says "rejected"
and stops. That is a real gap, recorded here rather than quietly patched: the
detection matrix in `tdd/doubles/` is a measured result and adding assertions
to its probes would change it.

Three of those five would not exist under a type checker: `reason` is a union
type, so `""` does not compile, and neither does `{}`. Stryker can discard such
mutants with `@stryker-mutator/typescript-checker`, which is not used here — it
roughly doubles the run, and a mutant that fails to typecheck *and survives* is
information. It says a distinction the type system makes is one no test makes,
which is exactly what those three say.

`property/availability.ts` carries the other twenty survivors and all five
uncovered mutants. Four of the five uncovered are in `showIntervals`, a
debugging helper nothing asserts on. The survivors cluster in the sweep loops
of `intersect` and `subtract`, where several are equivalent: `i < left.length`
becoming `i <= left.length` is unreachable when the loop already exits on the
first undefined element. Telling an equivalent mutant from a missing assertion
is the manual part of mutation testing and there is no tool for it; the honest
handling is to leave the score where the equivalent mutants put it and set the
floor with that in it, rather than adding a `// Stryker disable` comment for
every one and calling the result 100%.

---

## Attribution: `killedBy` is not the killers

The obvious thing to want from a report that knows about test files is "which
suite killed which mutants". `killedBy` does not answer it. Stryker stops a
mutant's test run at the first failure, so the field holds whichever test
happened to be scheduled first among those that would have failed. Two suites
compared on it are being compared on test ordering.

`coveredBy` has no such problem — it is recorded during the coverage dry run
and does not depend on what fails — so the gate's attribution is built on it
and reports what is sound without a second run: how much of a module each suite
*reaches*, and how much only that suite reaches.

Complete kill sets do exist, behind `disableBail: true`, which runs every
covering test against every mutant. The properties-vs-examples table above came
from one such run and it cost **7 minutes 54 seconds for a single module** —
against 2 minutes 54 seconds for the whole four-module gate. It reported the
same score (128 of 153) with the timeouts up from 3 to 16. It is the right tool
for a question asked once and the wrong one for a gate.

---

## Cost, and why it is a separate CI job

66% of the mutants here are *static* — produced by code that runs when the
module is first imported rather than inside a function — and Stryker reloads
the test environment for each one. For `availability.ts`, which builds its API
at module scope, it is 97%. That, not the size of the suite, is what makes this
minutes rather than seconds.

In CI the mutation gate is its own job on one Node major, in parallel with the
matrix. A mutation score is a property of the tests, not of the runtime, so
three legs would re-derive the same percentage for three times the minutes.
`workflow-templates/gateSteps.ts` audits that it still runs under
`--throw-deprecation` like every other gate — it matters more here than
anywhere else, because it is the one gate whose Node version the matrix does
not cover.

---

## Two things that will bite you

**pnpm and the plugin glob.** Stryker discovers plugins by globbing
`node_modules/@stryker-mutator/*`. Under pnpm the top level of `node_modules`
holds symlinks and the glob comes back empty, so a perfectly good install dies
with `Cannot find TestRunner plugin "vitest". In fact, no TestRunner plugins
were loaded. Did you forget to install it?`. Naming the plugin explicitly in
`plugins` skips the glob.

**A directory that shares a package's name.** Stryker copies the repository
into a sandbox and runs Vitest with that copy as the Vite root. This repository
has a top-level `vitest/` directory, so resolving the bare specifier `vitest`
from inside that root finds the directory before the package, and every worker
dies in the dry run with

```
Failed to load url <sandbox>/vitest (resolved id: <sandbox>/vitest).
Does the file exist?
```

which names neither Stryker, nor the directory, nor the collision — and the
import that trips it is inside Stryker's own injected setup file, so reading
this repository's sources does not explain it. `mutation/vitest.config.ts`
pins the specifier to the package's resolved entry point. Excluding `vitest/`
from the sandbox also works and is worse: it would make every future suite in
that directory invisible to a mutation run.

---

## What is not gated

- **Everything outside the four scoped modules.** That is the cost decision,
  stated in `scope.ts` rather than hidden in a glob. Adding a module is one
  table entry and a floor.
- **Equivalent mutants.** Nobody has classified the 27 survivors into "missing
  assertion" and "cannot be killed", so the score is a lower bound on the
  suite's real strength and the floors carry that.
- **The per-suite comparison.** It needs `disableBail: true` and does not run
  in CI, so the tables above are a measurement with a date on them, not an
  invariant. Re-run them before quoting them.

---

## Files

| file | what it is |
|---|---|
| `scope.ts` | the closed table: modules, floors, and why each is worth the minutes |
| `reach.ts` | which suites reach a module, over the same import walk `shape/` uses |
| `report.ts` | the schema, the arithmetic, and the coverage attribution |
| `policy.ts` | the gate's decisions as a pure function of report and scope |
| `check.ts` | `pnpm mutation:check`: run Stryker, evaluate, print, exit |
| `stryker.config.ts` | Stryker's options, with `mutate` derived from `scope.ts` |
| `vitest.config.ts` | the Vitest project a run executes, with `include` derived |
