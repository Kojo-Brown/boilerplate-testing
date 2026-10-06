# k6 load scenarios

Five load profiles — `smoke`, `load`, `stress`, `soak`, `spike` — one scenario
script that runs any of them, a fixture origin to run them against, and a gate
that checks the thresholds still mean what this directory says they mean.

Every number below was measured against **k6 v1.3.0**, not read off a changelog.
`check.ts` re-measures them, so a claim that stops being true fails CI.

## The five scenarios

| scenario | peak VUs | duration | steepest ramp | thresholds | answers                                       |
|----------|----------|----------|---------------|------------|-----------------------------------------------|
| `smoke`  | 1        | 2m       | 0.0 VU/s      | 3          | Does it work at all?                          |
| `load`   | 50       | 20m      | 0.2 VU/s      | 4          | Does it meet its targets at expected traffic? |
| `stress` | 200      | 30m      | 0.3 VU/s      | 3          | Where does it break, and how?                 |
| `soak`   | 20       | 4.2h     | 0.1 VU/s      | 3          | Does it still work after four hours?          |
| `spike`  | 400      | 5.8m     | 38.0 VU/s     | 5          | Does it come back?                            |

### When to use which

- **`smoke`** before anything else, and in the deploy pipeline. One VU, two
  minutes, the strictest thresholds of the five. It is a yes/no, and it is cheap
  enough to run on every change.
- **`load`** to answer whether the system meets its targets. Read the numbers
  from the steady phase; the ramp is there to get to it, not to be measured.
- **`stress`** to find the breaking point. Its thresholds are deliberately the
  loosest — a stress run that stays inside the load thresholds did not stress
  anything, and tightening them turns a successful experiment into a red build.
- **`soak`** overnight, or on a release candidate. Four hours is the point: leaks,
  connection-pool exhaustion and cache drift are invisible in twenty minutes.
- **`spike`** when traffic is bursty — a launch, a cron fan-out, a cache that
  expires all at once. The burst is not the measurement. The recovery window
  after it is, which is why this profile alone carries phase-scoped thresholds.

## Running one

```sh
k6 run k6/load-test.ts                                   # the load profile
K6_PROFILE=smoke k6 run k6/load-test.ts                  # any of the five
K6_PROFILE=spike BASE_URL=https://api.example.com k6 run k6/load-test.ts
```

With nothing to point it at, this directory ships a target:

```sh
node k6/server.ts &
BASE_URL=http://localhost:8799 K6_PROFILE=smoke k6 run k6/load-test.ts
```

There is no bundling step. k6 v1 loads ES modules and TypeScript natively and
imports `./config.ts` directly; the esbuild incantation this directory used to
document was true of k6 before v0.57 and is not true now.

## The gate

```sh
pnpm k6:check      # needs the k6 binary; K6_BIN overrides the lookup
```

`check.ts` starts the fixture origin and runs k6 three times: the agreement
scenario twice, differing only in `--summary-trend-stats`, and the published
`smoke` profile once. The first two must exit 99 and the third must exit 0 — a
gate that has only ever been seen to pass has not been seen to work.

Then, for each of the 21 cases in `agreement.ts`, it checks two things that can
fail independently: that k6's own verdict is the one the case predicts, and that
recomputing the verdict from the summary export reaches the same answer. The
first says this directory understands k6's semantics; the second says
`thresholds.ts` implements them.

Install the binary with the line CI uses:

```sh
curl -fsSL https://github.com/grafana/k6/releases/download/v1.3.0/k6-v1.3.0-linux-amd64.tar.gz \
  | tar xz --strip-components=1 -C /usr/local/bin k6-v1.3.0-linux-amd64/k6
```

## What was measured

Four of these are ways to hold k6's pass/fail contract wrong. They are not
exotic: each one is silent, and three of the four fail in the direction that
reports green.

### The summary boolean means "breached", not "passed"

`--summary-export` writes, per metric, `"thresholds": {"p(95)<200": false}`.
`false` means the threshold did **not** fail. Read it as `passed: false` — the
intuitive reading, and the one a reviewer skims past — and every passing run
looks like a failing one, every failing run like a passing one. `BREACHED` in
`thresholds.ts` names the polarity so a call site cannot assume it.

### `rate` means one thing on a Counter and another on a Rate

On a Counter, `rate` is events per second: `{"count": 9428, "rate": 4713.5}`. On
a Rate it is the proportion of truthy samples, and the export carries it under
`value` with **no `rate` key at all**: `{"passes": 9428, "fails": 9428, "value": 0.5}`.

So `http_req_failed: ['rate<0.01']` has to be answered from `value` and
`my_counter: ['rate<100']` from `rate`. Reading the wrong one is not an error —
it is a number four orders of magnitude out. `AGGREGATE_KEYS` declares the
fallback order and `readAggregate` reports which key answered.

### A threshold k6 evaluated can be missing from the export

k6 evaluates `p(99)<500` correctly whatever the summary says. But
`--summary-trend-stats` defaults to `avg,min,med,max,p(90),p(95)`, so the export
has no `p(99)` in it — and three of the five profiles here set a p(99)
threshold. A verdict recomputed from a default export is therefore *blind* to
those: it cannot disagree with k6, it has no number.

That is reported as `unverifiable`, never as a pass, because a gate that scores
a missing measurement as a pass is worse than no gate. Widening the stats fixes
it, and `check.ts` runs both ways to prove it: one unverifiable case by default,
none with `p(99)` included.

### A misspelt sub-metric selector passes

This is the one that matters, and the reason `spikeProfile` looks the way it
does. k6 creates a sub-metric for a selector that matches nothing and scores it
against no samples — and an empty Trend's `p(95)` is `0`, an empty Rate's rate
is `0`:

```json
"http_req_duration{phase:typo}": {"p(95)": 0, "thresholds": {"p(95)<500": false}}
```

`false`. It passed. So a scenario that forgets to set the tag, or a selector
with a typo in it, switches the gate off and reports green. Which threshold
shapes survive that:

| threshold   | on an empty sub-metric | has teeth?                |
|-------------|------------------------|---------------------------|
| `p(95)<500` | passes                 | no — enforces nothing     |
| `avg<300`   | passes                 | no — enforces nothing     |
| `max<1000`  | passes                 | no — enforces nothing     |
| `rate<0.01` | passes                 | no — enforces nothing     |
| `count>0`   | breaches               | yes — usable as a witness |
| `count>=1`  | breaches               | yes — usable as a witness |

Only a threshold that cannot hold on zero samples has teeth. So every
sub-metric threshold group here carries one — `passesVacuously` decides which
shapes qualify by evaluating them against an empty metric, and `config.test.ts`
fails any profile whose selector group has no witness.

### The spike profile is the one that needs a witness

A spike test's pass/fail criterion cannot be written as one number over the
whole run. A system that sheds load during a 20x burst and recovers in thirty
seconds passed; one that stays up through the burst and is still degraded three
minutes later failed. Averaged over the run those two look alike.

So the burst thresholds are tolerant (`p(95)<2000`, `rate<0.10`) and the verdict
is carried by `http_req_duration{phase:recovery}` and
`http_req_failed{phase:recovery}`, which are the baseline expectations. Those
only work if the scenario tags each request with the phase the run is in, which
is what `phaseAt` and `Stage.phase` are for — and what
`http_reqs{phase:recovery}: ['count>0']` is there to notice if it ever stops
happening.

### Spike and stress differ by slope, not by peak alone

Both end up above the load profile's peak, so a peak comparison does not
distinguish them. The slope does: `stress` walks to 200 VUs over twenty minutes
at 0.3 VU/s, `spike` reaches 400 in ten seconds at 38 VU/s — more than a
hundredfold. `steepestRamp` measures it, including on the way down, because a
drop from 400 to 20 in ten seconds is as abrupt as the rise and a connection
pool can fail on it too.

## Files

| file                    | what it is                                                        |
|-------------------------|-------------------------------------------------------------------|
| `config.ts`             | the five profiles, their stages and phases, and `phaseAt`         |
| `thresholds.ts`         | threshold expressions parsed and evaluated; the three semantics   |
| `verdict.ts`            | a summary export scored per threshold, and rendered               |
| `load-test.ts`          | the scenario the profiles run through — the file to copy          |
| `metrics.ts`            | the custom metrics `load-test.ts` records                         |
| `server.ts`             | the fixture origin, including `/slow` and `/fail` to force breaches |
| `agreement.ts`          | the 21 cases and the compressed profile `check.ts` runs            |
| `agreement.scenario.ts` | the k6 script for the agreement run                               |
| `check.ts`              | `pnpm k6:check` — the three runs and every assertion              |
| `findings.ts`           | the model this README is rendered from                            |

`config.ts`, `thresholds.ts` and `agreement.ts` carry no k6 imports, so they
compile and unit-test under both the root tsconfig and `tsconfig.k6.json`. The
scenario files import `k6/http` and only exist inside the binary; `pnpm
typecheck` runs both configs so neither half goes unchecked.
