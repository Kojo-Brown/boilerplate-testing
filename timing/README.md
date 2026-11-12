# CI test-time budget with a regression gate

A test-time budget is two things that are usually confused: a **rule shape**
("what counts as a regression") and a set of **thresholds** ("how much"). This
directory measures the first and calibrates the second, and the reason to keep
them apart is the last finding below — the shape that wins the measurement,
run at the thresholds the measurement was taken with, fails pull requests that
changed nothing.

The gate CI runs is `check.ts`. Everything else here is the argument for it.

## Running it

```sh
# Two reports of the same suite, measured on the same machine.
pnpm test --reporter=json --outputFile=base.json     # on the merge base
pnpm test --reporter=json --outputFile=head.json     # on the head commit
pnpm timing:check --base base.json --head head.json
```

`--base` is repeatable; with several reports the baseline is their per-file
median. The gate exits non-zero on a regression, prints the per-file
comparison slowest-first either way, and appends the table to
`$GITHUB_STEP_SUMMARY` when CI provides one.

```sh
node timing/record.ts --runs 16        # re-record corpus.json (the fixture)
node timing/calibrate.ts a.json b.json # what a suite's noise floor actually is
```

## The instrument

Everything below rests on sixteen measurements of five unchanged files,
recorded by `record.ts` and committed as `corpus.json`. Nothing in the
subject varies between runs, so every difference in these numbers is the
machine. `spread` is the column that matters: it is the percentage regression
a per-file rule has to tolerate on that file to stay quiet when nothing has
happened.

| file             | median  | min     | max     | spread | p95   |
| ---------------- | ------- | ------- | ------- | ------ | ----- |
| `large.test.ts`  | 242.4ms | 241.3ms | 243.4ms | +0%    | +0%   |
| `medium.test.ts` | 51.4ms  | 51.3ms  | 52.6ms  | +2%    | +2%   |
| `small.test.ts`  | 10.3ms  | 9.2ms   | 11.5ms  | +12%   | +12%  |
| `tiny.test.ts`   | 1.1ms   | 0.9ms   | 2.4ms   | +118%  | +118% |
| `uneven.test.ts` | 64.1ms  | 63.1ms  | 64.3ms  | +0%    | +0%   |
| **TOTAL**        | 369.4ms | 366.3ms | 373.0ms | +1%    | +1%   |

### A file's run-to-run spread is a property of its duration, not of its code

The 1ms file's worst run is more than twice its median. The 242ms file's is
within half a per cent of it. Neither file changed. A per-file percentage
threshold is therefore not one threshold but a different threshold per file,
and the thing it varies with is duration — so the only way to set one number
for the whole suite is to set it above the noisiest file, which is the
shortest one, which makes it useless everywhere else.

The total is the quietest column in the table, at +1%. Hold on to that; it
does not survive contact with a real suite either.

## The regressions

| fault            | change                                                  | scaling      | right answer |
| ---------------- | ------------------------------------------------------- | ------------ | ------------ |
| `none`           | nothing — the run as recorded                           | local        | stay quiet   |
| `tiny-doubled`   | fixture/tiny.test.ts takes twice as long (+1ms)         | local        | stay quiet   |
| `small-tripled`  | fixture/small.test.ts takes three times as long (+21ms) | local        | fire         |
| `medium-doubled` | fixture/medium.test.ts takes twice as long (+51ms)      | local        | fire         |
| `large-tenth`    | fixture/large.test.ts takes 10% longer (+24ms)          | local        | fire         |
| `creep`          | every file takes 5% longer (+18ms)                      | proportional | fire         |
| `new-file`       | a new 150ms test file appears                           | local        | fire         |

`none` is the control and the most important row: sixteen identical suites
measured sixteen times. `tiny-doubled` is the other row whose right answer is
silence — a 100% regression that costs one millisecond — and it is there to
catch a design that confuses a large ratio with a large cost.

`scaling` is the property that decides whether a total-only rule can ever see
a fault, and leaving it out of the model was a mistake worth recording: the
first version of the dilution table divided every fault's fixture-sized cost
by the real suite's total, which reports `creep` as 0.016% of a two-minute
suite. It is nothing of the kind. "Every file 5% slower" costs 5% of whatever
the suite is.

## The designs

| design                 | rule                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `none`                 | never fail                                                         |
| `file-percent`         | any file more than 25.0% over its baseline                         |
| `file-percent-floored` | any file with a baseline of at least 25ms, more than 25.0% over it |
| `file-absolute`        | any file more than 25ms over its baseline                          |
| `file-both`            | any file over its baseline by both 25.0% and 25ms                  |
| `total-percent`        | the suite total more than 3.0% over the baseline total             |
| `recommended`          | file-both above the floor, or the total rule                       |

## The measurement

49 cells. Each one is how many of the 16 recorded runs that design fired on
with that fault applied. The column header carries the right answer: **0** in a
`quiet` column, **16** in a `fire` one. A cell that is neither is a threshold
sitting inside the noise.

| design                 | none (0) | tiny-doubled (0) | small-tripled (16) | medium-doubled (16) | large-tenth (16) | creep (16) | new-file (16) | correct |
| ---------------------- | -------- | ---------------- | ------------------ | ------------------- | ---------------- | ---------- | ------------- | ------- |
| `none`                 | 0        | 0                | 0                  | 0                   | 0                | 0          | 0             | 2/7     |
| `file-percent`         | 3        | 16               | 16                 | 16                  | 3                | 3          | 3             | 2/7     |
| `file-percent-floored` | 0        | 0                | 0                  | 16                  | 0                | 0          | 0             | 3/7     |
| `file-absolute`        | 0        | 0                | 0                  | 16                  | 1                | 0          | 0             | 3/7     |
| `file-both`            | 0        | 0                | 0                  | 16                  | 0                | 0          | 0             | 3/7     |
| `total-percent`        | 0        | 0                | 16                 | 16                  | 16               | 16         | 16            | 7/7     |
| `recommended`          | 0        | 0                | 16                 | 16                  | 16               | 16         | 16            | 7/7     |

### A per-file percentage gate fails pull requests that changed nothing

`file-percent` fires on three of sixteen runs of an unchanged suite. Not three
of sixteen different commits — three of sixteen measurements of the same five
files. The three are the runs where `tiny.test.ts` drifted past 1.4ms, and no
baseline fixes it: scored against a one-run baseline and against the median of
all sixteen, it false-alarms either way.

### Flooring the percentage buys silence by giving up almost every detection

Ignore the files too short to measure and the false alarms do go away. So does
the detection: `file-percent-floored` answers one of the five real regressions,
because four of them are either below the floor or below the tolerance. It is
the first of three designs in this table that are quiet because they are blind.

### A threshold set near the size of the regression is a coin flip

`file-absolute` fires on `large-tenth` in **1 of 16 runs**. The regression is
identical in all sixteen; the verdict is not. A 242ms file plus a tenth is
266.6ms and the threshold is 267.4ms, so which side of the line a run lands on
is decided by scheduling. This is the failure mode worth naming, because it is
invisible in any table that records whether a gate *can* catch something rather
than how often: as a boolean this cell reads "caught".

### Only the total rule sees a slowdown that no single file owns

`creep` — every file 5% slower, a heavier setup file or a slower transform — is
caught by the total rule in every run and by no per-file design in any run.
`file-percent` is not at zero in that column, it is at 3: the same three runs
it fails on when nothing has changed at all. Firing sometimes, for the wrong
reason, is not detection.

### The total rule's perfect score is a property of the fixture's size

`total-percent` answers all seven faults. It is also the most misleading number
in this directory, because a total-only rule fires when a regression is a large
enough share of the total — and the share depends on the suite.

| fault            | scaling      | share of fixture (5 files) | share of this repo (220 files) | visible to a 3% total rule at that size |
| ---------------- | ------------ | -------------------------- | ------------------------------ | --------------------------------------- |
| `tiny-doubled`   | local        | +0.3%                      | +0.001%                        | no                                      |
| `small-tripled`  | local        | +5.1%                      | +0.016%                        | no                                      |
| `medium-doubled` | local        | +13.9%                     | +0.043%                        | no                                      |
| `large-tenth`    | local        | +6.6%                      | +0.021%                        | no                                      |
| `creep`          | proportional | +5.0%                      | +5.000%                        | yes                                     |
| `new-file`       | local        | +40.6%                     | +0.126%                        | no                                      |

Localised regressions are diluted by the suite's own growth: tripling one 10ms
file is 5.1% of this five-file fixture and 0.016% of this repository's 228-file
suite, which is the same regression two orders of magnitude below any
tolerance worth setting. The proportional one does not move at all.

That is why the shipped rule is a disjunction rather than whichever row scored
best. The per-file clause localises a regression whatever the suite's size,
where the total clause dilutes it away; the total clause catches the slowdown
no single file owns, which no per-file rule sees at any tuning. Each is there
because the matrix shows the other cannot cover it.

There was a third clause — fail any run containing a file the baseline has no
entry for — and wiring the gate into CI is what showed it to be wrong. The
baseline is the merge base, so *every test file a pull request adds* has no
entry, and the clause fails the build for adding tests. This pull request would
have tripped it twelve times. The case it reached for is real, and it is
already the total clause's: a new test file that costs thirty seconds is a
budget breach however it arrived, while a legitimate 800ms suite is 0.6% of
this repository's total and should pass. New files are now printed with a `?`
and no verdict. It cost the matrix nothing — `recommended` still fires on all
sixteen runs of `new-file`, because 150ms added to a 369ms fixture is a 40.6%
total regression.

## What the fixture could not tell us

The matrix picks a rule shape. It does **not** pick thresholds, and the
attempt to use its thresholds is where this directory earned its keep.

Run against this repository's own suite — 232 files, parallel workers, several
of them spawning Vitest or Playwright as a subprocess — `25% and 25ms` accuses
**seven to nine files per run** of regressions that did not happen. Six runs of
the unchanged tree, measured with nothing else on the machine:

| measured                            | value                                       |
| ----------------------------------- | ------------------------------------------- |
| runs of the unchanged suite         | 6                                           |
| files common to every run           | 228                                         |
| median total                        | 138824ms                                    |
| total noise floor                   | +6%                                         |
| worst file, relative                | +362%                                       |
| worst file, absolute                | +2834ms                                     |
| files a doubling of which is caught | 21 of 232                                   |
| their share of the wall clock       | 97%                                         |
| machine                             | linux x64, 4-way parallelism, Node v22.23.4 |
| recorded                            | 2026-11-12                                  |

Three numbers there are worth sitting with. The worst file disagreed with its
own median by **+362%** and by **+2834ms**. And the total — the
column that was +1% on the fixture — has a **+6%** floor, most of which is not
within-batch jitter at all: two batches of three runs, minutes apart, on the
same machine and the same commit, disagreed by 6% while each batch internally
disagreed by 3.6% and 1.9%. A committed baseline cannot survive that, which is
why `check.ts` takes two reports measured in one job rather than reading a
number out of the repository.

So the thresholds are calibrated, not inherited:

| threshold       | fixture (`gates.ts`) | this suite (`budget.json`) |
| --------------- | -------------------- | -------------------------- |
| file tolerance  | 25%                  | 50%                        |
| file delta      | 25ms                 | 250ms                      |
| file floor      | 25ms                 | 100ms                      |
| total tolerance | 3%                   | 15%                        |

Verified out of sample: baseline from two runs, head from three others in the
other batch, **zero alarms** — against **7, 9 and 1** false alarms for the same
three runs at the fixture's numbers.

### What that costs, and why it costs less than it looks

A 250ms delta clause cannot see a 200ms file double. Doubling is caught
exactly when a file's baseline is at or above the 100ms floor and above the
250ms delta, which in this suite is **21 files of 232** — 9% of them.

Those 21 files are **97% of the suite's wall clock.** 173 of the 232 files
are under 25ms and between them account for almost none of it. A budget that
can only see the big files still sees nearly all of the time, which is the
single most encouraging fact here: test time is concentrated, so the
calibration that looks like a retreat by file count is close to complete by
the measure a budget exists to defend.

## The measurement that overruled the first two

The matrix picks a rule shape. The calibration sets thresholds. Both were done
before this gate had ever run on the machine it was written for, and the first
thing it did there was **fail a pull request that changed one line of
`SPEC.md`**.

Nothing could have slowed anything. The suite total came in **7.8% faster** and
nearly every file with it. One file did not: `flake/identity.test.ts` went
**17807ms → 29126ms, +63.6%**, between two runs of identical code on one
GitHub runner inside one job.

The local calibration had declared that safe, and the mistake was in the metric
rather than the data. It measured each file's worst run against its **median**,
which reads +9% for that file over six runs. CI holds one base run against one
head run, so what the clause is exposed to is the distance between *any two
draws* — the full range — which is **+41%** for the same file in the same six
runs. `noise.ts` now reports both, and on the corrected metric
`snapshot/check.test.ts` (6440ms → 10009ms, +55% and +3569ms) trips the shipped
thresholds on its own, locally, with nothing changed. The gate was never safe;
the calibration just could not see it.

Thresholds that do clear that floor are about +100% and +12s, which polices
nothing worth policing. And the shape of the problem is now clear: a per-file
wall-clock clause is unreliable at **both** ends — short files have enormous
relative range (+443% on a 3ms file), and the files with enormous absolute
range are the suites that spawn Vitest or Playwright as subprocesses, which are
also the large ones. The band where a per-file budget works is too narrow to be
worth a red build.

The total survived both machines: ±6% across local batches, −7.8% on the
runner, against a 15% tolerance. So `budget.json` has an `enforce` list, and it
holds `total` alone. The per-file comparison is still computed and still
printed — ranked by what each file cost, marked `!` where it crosses the
unenforced thresholds — because that table is what somebody reading a slow
build actually wants. It just does not decide the exit code.

To enforce the per-file clause, calibrate it on the runner it will run on,
raise the thresholds above the **range** `calibrate.ts` reports there, and add
`"file"` to `enforce`. Not before.

This is the directory's own thesis arriving uninvited. The whole point of the
matrix is that a timing gate's interesting failure is the build it fails for
nothing, and the gate built to demonstrate that did it once, in public, on the
second pull request it saw.

## How CI runs it

The `timing` job in `.github/workflows/ci.yml` checks out the merge base,
installs, measures; checks out the head commit, installs, measures; then runs
this gate over both reports. Two suite runs in one job — twice the wall clock,
off the critical path, on one machine — which is the price of a timing number
that means anything. It is a required check like every other job there.

## Keeping it honest

- `runs.test.ts` re-derives all 49 cells from `corpus.json` on every
  `pnpm test` and fails if one moved.
- `readme.test.ts` checks this document against the rendered tables and
  requires every finding above to still hold.
- `findings.test.ts` hands each finding a copy of the measurement with one cell
  moved and requires it to notice.
- `budget.test.ts` holds the enforced threshold clear of the measured floor and
  pins the reason the per-file clause is not enforced, so quietly switching it
  back on without calibrating fails the suite.

Re-record `corpus.json` when the fixture changes; re-run `calibrate.ts` and
raise `budget.json` when the suite or the runner changes. Do not lower a
threshold to make a build green — the gap between what the fixture said was
safe and what this suite needed is the whole point of the directory, and it was
only visible because both numbers were measured.
