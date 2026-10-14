# Flake detection: what a rerun records, a quarantine that can be audited, and a dashboard

Three things, and they are one thing: you cannot decide what to do about a
flaky test without a count of how often it fails, you cannot count what the
runner did not record, and the mechanism most projects use to put a flaky test
aside destroys the record it would have been counted from.

Every cell below was measured against **Vitest 3.2.7 and Playwright 1.62.1**, not read off a
changelog. `pnpm test` re-measures all 77 cells of the rerun matrix and all 15
of the identity table on every run — thirteen real processes, no browser among
them — so a claim that stops being true fails CI rather than quietly becoming
a wrong sentence here.

## What was here before

This directory replaces a quarantine mechanism that had never been run. Five
things were wrong with it, all five measured:

- **`quarantine()` had no call sites.** Nothing in the repository was
  quarantined, so the suite the helper exists for ran nothing quarantined.
- **`pnpm test:quarantine` could not pass.** Its config collected 224 files
  where the main config collects 190; the extra 34 were every Playwright spec
  and every container suite in the repository — including
  `trace/evidence.spec.ts`, whose eight tests fail on purpose. The run exited 1
  with 37 failed files.
- **The quarantine config could not load the file that defines quarantine.**
  Its alias was `{ '@': '.' }`, and a bare `'.'` is not resolved relative to a
  config file, so every `@/…` import failed at import-analysis time —
  `vitest/flaky.test.ts` among them.
- **The artifact the workflow uploaded was never written.** The config set
  `outputFile: { json: … }` with `reporters: ['verbose']`, and `outputFile`
  applies only to reporters that write files. `quarantine-results/` was never
  created, and the upload passed `if-no-files-found: ignore`, so the absence
  was silent.
- **The reporter chosen to show retries is the one that never shows them.**
  "Verbose output so individual retry attempts are visible in CI logs" was the
  comment. Vitest's `verbose` reporter does not print the `(retry xN)` marker;
  `default` does — and only inside a file it has expanded, which it does only
  when something in that file failed.

The last one is the whole subject of this directory in miniature: a reasonable
decision, written down as a rationale, never run.

## The subject

Eleven wirings, all against the same scripted subject: three tests, one of
which fails its first attempt ever and passes after that, one of which does
the same while filing two errors from the single failing attempt, and one that
always passes. Nothing in the plan fails permanently, which makes the exit code
a measurement of the *flake* rather than of a broken test sitting next to it.

| wiring | retries | artifact | what it is |
|---|---|---|---|
| `vitest-json` | 0 | `vitest-json` | No retries. The baseline: a flake is simply a failure. |
| `vitest-json-retry` | 2 | `vitest-json` | The usual advice. `retry: 2` plus the JSON reporter. |
| `vitest-junit-retry` | 2 | `vitest-junit` | The same run read as JUnit XML — what test analytics services ingest. |
| `vitest-default-retry` | 2 | `vitest-stdout` | The default reporter, read the way a human reads a CI log. |
| `vitest-verbose-retry` | 2 | `vitest-stdout` | The verbose reporter, chosen by `vitest/quarantine.config.ts` to make retries visible. |
| `vitest-attempts-retry` | 2 | `vitest-attempts` | The same run through `reporter.ts`. |
| `vitest-rerun` | 0 | `vitest-json` | No retries, run twice — the "re-run failed jobs" button. Both reports are read. (whole-suite) |
| `playwright-json` | 0 | `playwright-json` | No retries. The baseline for the other runner. |
| `playwright-json-retry` | 2 | `playwright-json` | `retries: 2` plus the JSON reporter. |
| `playwright-junit-retry` | 2 | `playwright-junit` | The same run read as JUnit XML. |
| `playwright-last-failed` | 0 | `playwright-json` | No retries, then `--last-failed`. Both reports are read. (failures-only) |

## What each wiring records

Seven questions, in the order somebody actually has them after a rerun. **gate**
— did the exit code report the flake. **verdict** — what status the artifact
gives the test. **attempts** — how many tries the artifact lets you count, `—`
when it says nothing. **evidence** — is the failing attempt's message still
there. **names it** — does the artifact have a *word* for a flake, rather than
leaving one to be derived. **counting** — can a flake rate be computed from it:
`sound` when every attempt count matches what the subject actually did,
`unsound` when a count is available and wrong, `blind` when there is none.
**coverage** — does the artifact hold the whole suite.

| wiring | gate | verdict | attempts | evidence | names it | counting | coverage |
|---|---|---|---|---|---|---|---|
| `vitest-json` | red | failed | 1 | kept | silent | unsound | whole-suite |
| `vitest-json-retry` | green | passed | 2 | kept | silent | unsound | whole-suite |
| `vitest-junit-retry` | green | passed | — | lost | silent | blind | whole-suite |
| `vitest-default-retry` | green | absent | — | lost | silent | blind | nothing |
| `vitest-verbose-retry` | green | passed | — | lost | silent | blind | whole-suite |
| `vitest-attempts-retry` | green | flaky | 2 | kept | named | sound | whole-suite |
| `vitest-rerun` | green | flaky | 2 | kept | silent | unsound | whole-suite |
| `playwright-json` | red | failed | 1 | kept | silent | sound | whole-suite |
| `playwright-json-retry` | green | flaky | 2 | kept | named | sound | whole-suite |
| `playwright-junit-retry` | green | passed | — | lost | silent | blind | whole-suite |
| `playwright-last-failed` | green | flaky | 2 | kept | silent | sound | failures-only |

### Every wiring with retries in it turns the flake green

All seven. That is what retries are for, and it is worth stating plainly
because the rest of the table is about the half of the job they do not do:
seven wirings make the build pass, and two of the seven leave behind a record
from which a flake rate could soundly be computed.

### JUnit XML cannot see a flake, in either runner

It is also the format every third-party test-analytics service ingests. Vitest
writes a bare `<testcase>` for a test that passed on a retry — byte-identical
to one that passed first time. Playwright writes the same, and puts unexpected
failures in `<error>` rather than `<failure>`, so a run with a genuine failure
in it reports `failures="0"`.

### Vitest’s JSON report shows the flake only as an inconsistency, and cannot count it

There is no retry count anywhere in the file. What there is, for a test that
passed on a retry, is `status: "passed"` carrying the failed attempt's message
in `failureMessages` — so the flake is visible to anybody who thinks to look
for a passing test with errors attached, and invisible to everything else.

Counting attempts from the number of messages is the only arithmetic the format
offers, and it is unsound: `soft-intermittent` files two messages from one
attempt, so the report says three attempts where the subject made two. Two soft
assertions in a test are enough to break it.

### Playwright records every attempt, and says `flaky` out loud

One `results` entry per attempt, each with its own retry index, status and
errors, a `status: "flaky"` on the test and a `flaky` count in `stats`. Nothing
has to be inferred, and nothing here needed writing: the Playwright column of
this directory is a parser.

### A green Vitest run’s console output names no test at all

The default reporter expands a file only when something in that file failed, so
a suite whose only problem is a flake prints `Tests 3 passed` and names nobody.
That is the suite somebody is looking at when they go hunting for flakes.

### The verbose reporter, chosen to show retries, is the one that never does

Measured both ways round, with the flake alone in a green file and with a
permanently failing test beside it:

| reporter | flake alone | failing test beside it |
|---|---|---|
| `default` | silent | prints `(retry x1)` |
| `verbose` | silent | silent |

So the marker exists, `default` prints it only in the case where you already
knew something was wrong, and `verbose` — the reporter `vitest/quarantine.config.ts`
picked in order to see retries — does not print it at all.

### A rerun is not a record

Both rerun wirings end green, and in both the flake is recoverable only by
holding two artifacts side by side and noticing that they disagree. Neither
artifact contains the word, or a count, or a status; the second one simply says
the test passed. "Re-run failed jobs" is the most common response to a flake in
the industry and it is the one that records the least.

### `--last-failed` writes an artifact with the denominator missing

Playwright's rerun-only flag writes a report containing just the tests that
failed before. A dashboard fed on it sees three tests where the suite has four:
the stable test drops out of the denominator, and the flake looks like a test
that passed on its first attempt.

## What quarantining a test does to its identity

Every number in the analytics is a count over a test's past attempts, joined on
a key. Both runners offer exactly one key an artifact actually carries: the
test's name. (`vitest list --json` emits `{name, file}` and nothing else;
Playwright's own id is a hash of the file and the title.)

So a mechanism that marks a flaky test by *renaming* it discards that test's
history at the moment of quarantining, and again when it is released — which is
to say at both of the moments the history is what the decision should be based
on. Three ways of marking the same test, six real `playwright test --list`
runs:

| tagging | title | tags in report | selected by `grep` | excluded by `grepInvert` | same id as untagged |
|---|---|---|---|---|---|
| `untagged` | `subject` | — | no | no | yes |
| `in-title` | `subject @flaky` | `flaky` | yes | yes | **no** |
| `in-option` | `subject` | `flaky` | yes | yes | yes |

### Putting `@flaky` in a title changes the test’s id; the tag option does not

The cost is narrower than it looks from outside, and worth stating exactly:
both forms are selected by `grep`, both are excluded by `grepInvert`, and both
appear as `tags: ['flaky']` in the JSON report, because Playwright parses tags
out of titles too. The only thing the title form additionally changes is the
title and the id — and that is the part that cannot be repaired later.

On the Vitest side the same hazard had the same shape: the old helper
registered `[quarantined] ${name}`.

## The registry

Which tests are quarantined is a file, `quarantine.json`, rather than a marker
at each call site:

```json
{
  "version": 1,
  "entries": [
    {
      "module": "users/list.test.ts",
      "name": "loads the user list",
      "runner": "vitest",
      "reason": "races with the fixture's own poll on a cold cache",
      "owner": "@someone",
      "ticket": "FLAKE-12",
      "addedOn": "2026-10-01",
      "expiresOn": "2026-11-01"
    }
  ]
}
```

A test file registers its cases through the helper and reads the same whether
anything in it is quarantined or not:

```ts
import { createQuarantine } from '@/vitest/flaky'

const test = createQuarantine(import.meta.url)

test('loads the user list', async () => { … })
```

Three things follow from the list being data, and all three are the point:

- **A quarantined test keeps its name.** It is still `test.skip`, so it still
  appears in every report and in `vitest list`, which is what distinguishes a
  quarantined test from a deleted one — and what keeps its history joinable
  when it comes back.
- **Releasing a test is deleting a line from a JSON file.** No test file is
  touched, so nothing renames and no diff has to be read for behaviour.
- **The list can be audited**, because every entry carries an owner, a reason,
  a ticket and an expiry.

`pnpm flake:check` fails on an entry that is any of:

| verdict | what it means |
|---|---|
| `expired` | past its `expiresOn`. Fix the test or renew the entry deliberately |
| `orphan` | names a test no runner collects any more — renamed or deleted |
| `release` | the history says it has stopped failing. Delete the entry |
| `escalate` | the history says it fails *every* attempt. This is not a flake, and quarantine is hiding it |
| `unevidenced` | nothing has measured this test flaking. The entry is an assertion rather than a finding |

Only `hold` passes. The policy — at most 10 entries, none in force for more
than 42 days — is in `quarantine.ts`, and both numbers are arguable in exactly
the way a threshold should be: a suite with eleven quarantined tests does not
have a flake problem, it has a trust problem.

This repository's own registry is empty, which is the healthy state and keeps
the gate inert. The machinery is not therefore unexercised:
`mechanism.test.ts` runs one unchanged fixture file three times — unlisted,
listed, and listed with `QUARANTINE=1` — and checks that the test runs, is
skipped, and runs with retries respectively, with the same name in all three.

## The analytics, and why a rate is not enough

"Flakiest tests, by failure rate" ranks a test that fails 4 attempts in 40
below one that fails 30 in 40 — so the top of the list is the broken test
nobody has fixed and the flake that is actually eroding trust is five rows
down. The two need opposite treatment: one is a bug report, the other is a
quarantine candidate.

So the classification is two-dimensional. `failureRate` says how often a test
fails; `flips` counts consecutive attempts that *disagreed*, which is what
makes a test flaky rather than merely failing. A test that failed its first
twenty attempts and passed its last twenty has a failure rate of 0.5 and one
flip: it was not flaky, it was fixed.

| class | what it is | what to do |
|---|---|---|
| `stable` | never failed an attempt | nothing |
| `flaky` | fails sometimes, and flips | quarantine it, with an expiry |
| `broken` | fails every attempt | fix it; it is not a flake |
| `fixed` | failed in the past, has a long enough pass streak since | release it from quarantine |

Ranking uses `(failures + 1) / (attempts + 2)` rather than the raw rate, so a
test with one failed attempt does not outrank one with 150 failures in 200. The
raw rate is kept alongside it, because the smoothed one is the wrong number to
put in a sentence like "fails one run in ten".

## The dashboard

Markdown, into `$GITHUB_STEP_SUMMARY`, because a dashboard nobody opens is a
dashboard that does not exist:

```
| Test | | Flaked | Attempts | Rate | Trend | Streak | Last failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `loads the user list` | 🟠 flaky | 2/5 | 2/7 | 28.6% | `·!·!·` | 2 | `Error: timed out waiting for the stream` |
```

`Flaked` counts runs the test passed only after a retry — a reader thinks in
builds, not attempts. `Trend` is per run, oldest first, with three states and
not two: `·` passed, `!` passed on a retry, `×` failed. Collapsing the middle
one into "passed" is how a flaky suite comes to look green.

There is deliberately no headline percentage for the suite as a whole. That
number goes down when somebody adds a thousand stable tests, which makes it a
measure of suite size.

## Running it

```sh
pnpm test                 # re-measures both tables: 13 processes, no browser
pnpm flake:check          # the gate: audits the registry, prints the dashboard
pnpm test:quarantine      # runs the listed tests instead of skipping them
```

The history the dashboard is computed from is a directory of attempt files, one
per run:

```sh
FLAKE_ATTEMPTS=.flake/$(date -u +%Y-%m-%dT%H-%M).jsonl \
  pnpm vitest run --reporter=default --reporter=./flake/reporter.ts
```

In CI, download the artifacts of the last N runs into one directory and point
`FLAKE_HISTORY` at it. `.github/workflows/flake.yml` does the nightly half of
that; the registry audit itself runs on every pull request, inside `ci.yml`'s
`gates` job.

Playwright needs no reporter: its JSON report is already an attempt record, and
`collect.ts` reads `*.json` in the history directory as one. Name those files
after the run — the report carries no run identifier, and two runs sharing a
name read as one test with twice the attempts.

## Files

| file | what it is |
|---|---|
| `wirings.ts` | the eleven wirings and the plan they share |
| `read.ts` | one parser per artifact format; decides nothing |
| `probes.ts` | the seven questions, answered against the subject's own ledger |
| `runs.ts` | spawns the runners; the only file here that starts a process |
| `matrix.ts` | the published table, re-derived by `runs.test.ts` |
| `identity.ts` | the tagging table, re-derived by `identity.test.ts` |
| `reporter.ts` | the Vitest reporter that writes one line per attempt |
| `attempts.ts` | the attempt record, and the two report parsers that produce them |
| `history.ts` | the analytics: counts, flips, streaks, classification |
| `quarantine.ts` | the registry, its parser, and the six verdicts |
| `dashboard.ts` | the Markdown |
| `collect.ts` | reads a directory of runs, and asks the runners what tests exist |
| `check.ts` | `pnpm flake:check` |
| `fixture/` | the scripted flaky subject. Excluded from `pnpm test` |
