# Debugging a CI failure from its trace

A Playwright trace is the only artefact of a failed CI run that can answer a
question you did not think to ask before the run. A screenshot shows you the
page; a video shows you the page moving; the log shows you the assertion that
gave up. The trace holds all three plus the network log, the console, the DOM at
every step and your own source, and a viewer that steps through them together.

It is also, in practice, the artefact people open once, glance at, and close.
This directory measures why, and what to look at instead.

Two measurements, both re-run by `pnpm trace:check` on every CI run:

- **Retention** — for each `trace` mode and each thing a test can do, is there a
  trace on disk afterwards? Eighteen cells, read off the filesystem. This is the
  question that comes first, and the one that most often ends the investigation.
- **Evidence** — for each of eight characteristic faults, what does each of the
  viewer's seven channels actually tell you? Fifty-six cells, read out of eight
  real trace zips.

## When to reach for this

Reach for a trace when a test failed in CI and passed on your machine, or when
the assertion that failed is not the thing that is broken. Both are the normal
case: of the eight faults below, six report to the CI log as a locator timeout.

Do not reach for it when the log already names the cause — a missing environment
variable, a syntax error, an install that failed. The measurement below has a
row for exactly that case, and the row is empty.

## Getting the trace out of CI

The trace is written into the run's `outputDir` as `trace.zip`, so CI has to
upload it before the runner is destroyed:

```yaml
- name: Upload traces
  if: ${{ !cancelled() }}
  uses: actions/upload-artifact@v7
  with:
    name: playwright-traces-${{ github.run_attempt }}
    path: playwright-results/
    retention-days: 7
```

`if: ${{ !cancelled() }}` rather than `if: failure()`: a flake that passed on
its retry does not fail the job, and it is the run you most want the trace for.

Then open it. Either locally —

```
pnpm exec playwright show-trace path/to/trace.zip
```

— or by dragging the zip onto [trace.playwright.dev](https://trace.playwright.dev),
which is a static page that parses it in the browser and uploads nothing.

## Which runs leave a trace behind

`trace` takes six values. They differ in *which attempt* they keep, and two of
them keep the attempt that passed.

| `trace`                   | passing | failing | flaky |
| ------------------------- | ------- | ------- | ----- |
| `off`                     | none    | none    | none  |
| `on`                      | first   | both    | both  |
| `retain-on-failure`       | none    | both    | first |
| `on-first-retry`          | none    | retry   | retry |
| `on-all-retries`          | none    | retry   | retry |
| `retain-on-first-failure` | none    | first   | first |

Measured with `retries: 1`, one test per outcome. `first` is the initial attempt,
`retry` the second, `both` both of them. See `attempts/attempts.spec.ts`.

## Two modes record the attempt that worked

`on-first-retry` and `on-all-retries` record nothing on the first attempt. For a
test that fails and then passes — a flake, the failure a trace is *most* worth
having for — the only recording they leave is of the attempt that went fine.
Downloading it and finding a green run is not the viewer letting you down.

## Half the modes cannot help you with a flake

`off`, `on-first-retry` and `on-all-retries`: three of the six leave no recording
of a flake's failed attempt. Two of the three are named as though they exist for
retries.

## `retain-on-failure` is the only mode that keeps every failed attempt and no passing one

It records everything and deletes the recordings of attempts that passed, which
is the only combination that keeps both of a twice-failing test's attempts and
the failed half of a flake, without keeping a trace of every green test. It is
what this repository's `playwright.config.ts` uses.

`retain-on-first-failure` looks equivalent and is not: it keeps the first
attempt only, so for a test that failed twice it has dropped the attempt whose
output the CI log is showing you.

## `on` is the only mode that keeps a trace of a green test

Useful when the question is "what did this test actually do", and expensive: a
trace per test per shard, kept forever, for runs nobody will look at. It is the
right mode for the suite in this directory and the wrong one for yours.

## Two names, one behaviour

At one retry, `on-first-retry` and `on-all-retries` cannot be told apart. They
diverge only above `retries: 1`, which is not where most CI configs are.

## Eight faults

Each one is a real defect in a real page — `subject.ts` renders them, a query
parameter selects one — provoked by a test written the way the test that really
had this bug would be written. Nothing in a test hints at its own fault.

| fault             | the defect                                             | what the CI log says                     |
| ----------------- | ------------------------------------------------------ | ---------------------------------------- |
| `renamed-element` | the page renders `#sum`; the test waits for `#total`   | timeout waiting for locator              |
| `duplicate-label` | two buttons carry the same accessible name             | strict mode violation                    |
| `covered-button`  | a transparent overlay sits on top of the button        | timeout waiting for element to be stable |
| `late-content`    | the total arrives after the assertion timeout          | expected 1240, received the placeholder  |
| `failing-api`     | the endpoint answers 500 and the page renders nothing  | timeout waiting for locator              |
| `hanging-api`     | the endpoint never answers                             | timeout waiting for locator              |
| `throwing-script` | an uncaught TypeError stops the page before it fetches | timeout waiting for locator              |
| `missing-env`     | the test reads an environment variable CI does not set | Error: TRACE_FIXTURE_TOKEN is not set    |

## What each channel is worth

Seven channels, which is roughly what the viewer's panes show: the failure
message with its call log, the action and step list, the DOM snapshots either
side of each action, the network log, the console, uncaught page exceptions, and
the first-party source the trace embeds.

| fault             | error   | actions | snapshot | network | console | pageerror | source  |
| ----------------- | ------- | ------- | -------- | ------- | ------- | --------- | ------- |
| `renamed-element` | symptom | context | cause    | context | empty   | empty     | context |
| `duplicate-label` | cause   | context | context  | context | empty   | empty     | context |
| `covered-button`  | cause   | context | context  | context | empty   | empty     | context |
| `late-content`    | symptom | context | symptom  | context | empty   | empty     | context |
| `failing-api`     | symptom | context | symptom  | cause   | cause   | empty     | context |
| `hanging-api`     | symptom | context | symptom  | cause   | empty   | empty     | context |
| `throwing-script` | symptom | context | symptom  | context | empty   | cause     | context |
| `missing-env`     | cause   | context | empty    | empty   | empty   | empty     | empty   |

- `cause` — this channel alone names the defect
- `symptom` — shows the failure, not the defect
- `context` — narrows or corroborates, once you have the cause
- `empty` — no entries at all

`empty` is measured; the other three are judgements, argued below. `pnpm
trace:check` fails when a cell claiming `empty` holds entries, when a cell
claiming anything else holds none, and when any of the specific facts those
judgements rest on stops being true — see `PROBES` in `check.ts`.

## Five faults out of eight do not name themselves

Only `duplicate-label`, `covered-button` and `missing-env` have their cause in
the error channel. For the other five the message is a timeout or a wrong value,
and the answer is in a pane you have to click.

## The answer is in the call log, not in the first line

`covered-button` is the exception that proves the rule. Its message opens
`TimeoutError: locator.click: Timeout 2000ms exceeded`, which is what CI prints
and what a reader stops at. Eight lines further down the same message, in the
call log, is `<div id="veil"></div> intercepts pointer events` — repeated on each
of the four retries. The channel held the answer the whole time; the first line
did not.

This row was `symptom` in the first draft, on the reasoning that a click timing
out on stability never reaches hit-testing. The gate rejected it.

## The two channels nobody opens are empty six times out of eight

Console and page errors: six of the eight faults record nothing in either. That
is the honest case for skipping them — most of the time there is nothing there.

## When they are not empty, they are the answer

And it is the other two that make it worth the click. Every case where either
channel holds anything is a case where that channel names the cause:

- `throwing-script` — the page-error channel has the `TypeError` and its line.
  Every other channel shows a total that never arrived.
- `failing-api` — the console has `Failed to load resource: … 500` against the
  URL. The page is silent about the bad answer; Chromium logs the failed
  subresource anyway.

## Two faults are the same failure until you open the network tab

`failing-api` and `hanging-api` produce the same error message, the same wrong
count, the same empty list in the snapshot. In the network log one is a 500 and
the other is a request with no status at all. There is nowhere else to tell them
apart.

## Only one fault needs the DOM snapshot

`renamed-element`. Its error says `element(s) not found`, which is true and says
nothing about what the page rendered instead; the snapshot has
`<span id="sum">` in it.

The snapshot earns its place elsewhere by being a DOM rather than an image.
`covered-button`'s overlay is fully transparent, so a screenshot of that page is
a picture of a perfectly clickable button — the element exists only in the
markup.

## One fault the trace cannot name

`late-content` has no `cause` in any channel. The total arrives after the
assertion gives up, every channel agrees the placeholder was on screen at that
moment, and no recording of a failed run can distinguish "arrives in five
seconds" from "never arrives". The trace bounds the defect and leaves you to
find it in the source.

## The emptiest trace is the one you did not need

`missing-env` fails before it touches the browser. Its trace is written, it
opens, and five of its seven channels hold nothing at all — no snapshot, no
request, no console, no page error, and no embedded source, so the Source pane is
blank for the one failure that happened in test code.

It is also the only fault whose CI log had already told you the answer. The
trace's browser half is empty exactly when you did not need to open it, which is
worth knowing in the other direction: a trace with five empty channels is
evidence that the cause never reached the page.

## A reading order

Given the table, the order that finds the cause soonest:

1. **Read the whole error, not its first line.** Scroll the call log. Three of
   eight end here, and one of those three looks like a bare timeout.
2. **Open the network pane.** Two faults live only here, and a 500 or a
   status-less request settles them immediately.
3. **Open the console pane.** Empty six times out of eight, and the answer the
   other two.
4. **Step to the failing action and read the DOM snapshot**, not the screenshot.
   What is in the markup and invisible is what a screenshot cannot show.
5. **If all four came back empty, stop looking at the trace.** Either the cause
   never reached the browser, or it is a timing defect the recording cannot
   name. Both are in the table.

## What is not measured here

- **The viewer itself.** Every claim above is about what a trace *contains*,
  parsed out of the zip by `channels.ts`. Whether the viewer renders a channel
  usefully is a claim about a user interface and nothing here tests it.
- **Anything above one retry.** `on-first-retry` and `on-all-retries` are
  measured as identical, which is true at `retries: 1` and false above it.
- **Trace size and its cost.** `on` keeps a trace per test and the artefact
  budget is a real reason teams pick a cheaper mode; no cell here is a number of
  bytes.
- **Browsers other than Chromium.** The evidence table is Chromium's, and at
  least one cell is specifically its behaviour: the console entry that
  `failing-api` rests on is Chromium logging a failed subresource, not the page
  logging anything. Firefox and WebKit may not.
- **Multi-context tests.** `channels.ts` folds several browser contexts into one
  census and `channels.test.ts` covers that, but no fault here opens two.

## Files

| file | what it is |
| ---- | ---------- |
| `subject.ts` | the page, and its eight faults, as a pure function |
| `server.ts` | that page on a port, plus the endpoints it fetches |
| `faults.ts` | the catalogue: the defect, and what CI says about it |
| `zip.ts` | enough ZIP reading to open a trace, with no dependency |
| `channels.ts` | a trace zip, parsed into the seven channels |
| `evidence.ts` | the evidence table, its accessors and its findings |
| `retention.ts` | the retention table, its accessors and its findings |
| `evidence.spec.ts` | eight tests that fail on purpose, one per fault |
| `attempts/` | three tests that pass, fail and flake, run once per mode |
| `check.ts` | `pnpm trace:check`: re-measures both tables, prints both |

`evidence.spec.ts` and `attempts/attempts.spec.ts` are the *subjects* of the
measurement rather than tests of anything, and are excluded from `pnpm test`:
running them there would make the unit suite red by design.
