# Chaos testing: fault injection for latency, errors and dependency outages

Nine faults, six resilience wirings, two places to inject the fault from, and
**108 cells** re-derived by `pnpm test` in about twelve seconds. No container,
no proxy, no new dependency: the dependency is one `node:http` server with a
route per fault, and the cheap imitation of it is a hand-written `fetch`.

The deliverable is not the fault injector. Writing one is an afternoon, and
there are good ones on npm. The deliverable is the measurement of **what a
chaos suite can and cannot see**, because fault injection has the failure mode
that matters most and advertises itself least: a suite that injects the wrong
faults, or injects the right ones in the wrong place, goes green against a
client that will fall over in production — and goes green *faster*, which is
how it earns its place in CI.

Two findings carry the directory. One is about the catalogue: of nine faults,
exactly **one** tells a timeout that works from a timeout that does not, and it
is the one nobody writes. The other is about the injection point: a hand-written
`fetch` stub reproduces every fault that has an *event* in it and gets every
fault made of *waiting* backwards — all twelve such cells, in the direction that
makes the broken wiring look like the only correct one.

## The subject

A service reading a ledger over HTTP. One call, one JSON body, and a resilience
policy around it — which is the smallest piece of a system that can have any of
these faults happen to it, and small enough that every cell in the tables below
is a property of the policy rather than of an application.

A cell is a **series of three calls** rather than one call, and that is not
padding. A circuit breaker's whole job is to stop calling a dependency that is
down, which is a property of the second and third call and invisible in the
first; measure one call and the breaker row is identical to the row above it.

Each cell records three things: what the **last call** did, which side of the
injected latency it settled on, and **how many requests the whole series made**.
The third column is where two of the six wirings live. A retry that never enters
its retry branch returns exactly what a wiring with no retry returns, and a
breaker that never opens returns exactly what the retry underneath it returns.
Both are the failure a chaos suite exists to catch, and both are invisible to
the assertion everybody writes, which is about the value that came back.

## The faults

| fault | category | what the origin does |
|---|---|---|
| `healthy` | control | answers 200 with a well-formed body, immediately |
| `slow-headers` | latency | waits past the budget, then sends status line, headers and body together |
| `slow-body` | latency | sends 200 and headers at once, then stalls mid-body past the budget before finishing it |
| `error-500` | error | answers 500 with a well-formed JSON error body |
| `transient-500` | error | answers 500 to the first request of any call and 200 to every later one |
| `malformed-body` | error | answers 200, `content-type: application/json`, and a body that stops mid-token |
| `connection-refused` | outage | nothing is listening on the port at all |
| `reset-mid-body` | outage | sends 200, headers and part of a body, then destroys the socket |
| `black-hole` | outage | accepts the connection and never writes a byte |

Two per latency, three per error, three per outage, and a control. Three faults
— one per category, which is the obvious reading of the brief — cannot say
anything, because the differences that decide a policy live *inside* each
category:

- **Latency** splits on where the delay is. Headers that are late and a body
  that stalls after the headers arrive are the same event to a stopwatch and
  completely different events to a client.
- **Errors** split on who reports them, and on whether they heal. A 500 is the
  dependency saying no; a truncated body is it saying yes and lying; a 500 that
  clears on the next attempt is the only fault here a retry can recover from.
- **Outages** split on when the connection dies. Refused before anything was
  sent, reset with a body half-delivered, and accepted but never answered are
  three different observations, and only the third is a timeout's problem.

`healthy` is not padding either: without a control, a policy that fails to reach
the dependency at all scores like one that survived everything.

## The wirings

| wiring | what it is | what it claims |
|---|---|---|
| `bare` | `await (await fetch(url)).json()` | nothing — the baseline every other row is measured against |
| `race-timeout` | `Promise.race([fetch(url), rejectAfter(budget)])`, then a status check, then `res.json()` | a call that takes longer than the budget fails instead of waiting, and a non-2xx is an error rather than a body |
| `signal-timeout` | `fetch(url, { signal: AbortSignal.timeout(budget) })`, then a status check, then `res.json()` | the same two things, with the timeout around the whole call rather than around the request |
| `retry-5xx` | as `signal-timeout`, re-attempted up to three times while `res.status >= 500` | a dependency that is failing transiently is retried |
| `retry-any` | as `signal-timeout`, re-attempted up to three times on any thrown error or non-2xx | as above, for transport failures as well as reported ones |
| `breaker` | as `retry-any`, behind a breaker that opens after two consecutive failed attempts and then fails without calling | a dependency that is down is not called again |

They are the recipes a service actually ships, in the order a codebase acquires
them. Two of the six are wrong, and neither is wrong in a way that survives
being stated out loud — which is the point, because both of them pass review:

- `race-timeout` is the `Promise.race([fetch(url), timeout])` from every "how do
  I add a timeout to fetch" answer written before `AbortSignal` existed. The
  race resolves when the **headers** arrive. The body is read afterwards,
  outside the race, with nothing watching it.
- `retry-5xx` keys its retry on `res.status`, which is the one signal a failing
  dependency sometimes does not send at all.

Every step but the first differs from the row above it in exactly one decision,
so a cell that moves between two adjacent rows has only one thing it can be
about. The first step is the exception and it is unavoidable: `bare` means *no*
policy, so `bare` → `race-timeout` adds both a timeout and a status check.

## The matrix

Measured at the `socket` layer — a real origin, real chunks, real resets. Each
cell is `outcome · band · requests`.

| wiring | healthy | slow hdrs | slow body | 500 | 500 once | bad body | refused | reset | black hole |
|---|---|---|---|---|---|---|---|---|---|
| `bare` | ok · prompt · 3 | ok · waited-out · 3 | ok · waited-out · 3 | wrong-body · prompt · 3 | wrong-body · prompt · 3 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | hung · deadline · 3 |
| `race-timeout` | ok · prompt · 3 | aborted · prompt · 3 | ok · waited-out · 3 | http-error · prompt · 3 | http-error · prompt · 3 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | aborted · prompt · 3 |
| `signal-timeout` | ok · prompt · 3 | aborted · prompt · 3 | aborted · prompt · 3 | http-error · prompt · 3 | http-error · prompt · 3 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | aborted · prompt · 3 |
| `retry-5xx` | ok · prompt · 3 | aborted · prompt · 3 | aborted · prompt · 3 | http-error · prompt · 9 | ok · prompt · 6 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | aborted · prompt · 3 |
| `retry-any` | ok · prompt · 3 | aborted · prompt · 9 | aborted · prompt · 9 | http-error · prompt · 9 | ok · prompt · 6 | malformed · prompt · 9 | refused · prompt · 9 | reset · prompt · 9 | aborted · prompt · 9 |
| `breaker` | ok · prompt · 3 | breaker-open · prompt · 2 | breaker-open · prompt · 2 | breaker-open · prompt · 2 | ok · prompt · 6 | breaker-open · prompt · 2 | breaker-open · prompt · 2 | breaker-open · prompt · 2 | breaker-open · prompt · 2 |

## One fault in nine separates a timeout that works from one that does not

`race-timeout` and `signal-timeout` both have a timeout, both set it to the same
budget, and across nine faults their cells differ in **exactly one place**:

```
slow-body    race-timeout: ok · waited-out · 3
             signal-timeout: aborted · prompt · 3
```

On `slow-headers` they agree. On `black-hole` they agree. On every error and
every outage they agree. The one fault that separates them is the one where the
headers arrive on time and the body does not — because that is the only fault
where the thing being raced has already finished when the trouble starts. The
race resolves with a perfectly good `Response`, the timer is cancelled, and
`res.json()` then waits as long as the dependency feels like taking.

Read the band rather than the outcome and it is worse than a missing timeout: a
wiring that reports **success**, nine times its own budget late. A caller with a
100ms SLA gets a 900ms answer and no error to log.

This is what a nine-fault catalogue buys over a three-fault one. A suite whose
latency fault is "the dependency is slow to answer" — the natural one to write,
and the one every tutorial writes — scores these two wirings **identically** and
certifies the broken one.

## A wiring with no status check hands the error payload back as data

`bare` is the only row with no status check, and on both 500 faults its cell
reads `wrong-body`: it did not throw, it did not hang, it *returned* — and what
it returned was `{"error": "ledger unavailable"}` in the place the ledger was
supposed to be.

That is the cell a chaos assertion of the shape "the call did not throw" marks
as a pass. An error payload is valid JSON, so the parser is happy; the only
thing that could have noticed was a check on `res.ok`, and there is not one.
`isHealthyBody` in `outcomes.ts` exists precisely so that this cell is not
allowed to read `ok`.

## Retrying on any error changes no outcome and triples the requests

`retry-any` and `retry-5xx` produce the **same outcome and the same band on all
nine faults**. Not one cell differs. What differs is the request column, on six
of the nine, where `retry-any` sends exactly three times as many.

Retrying on any error is the strictly better *policy* — `retry-5xx` cannot see a
reset socket or an unparseable body, which the next finding is about — and
against this catalogue it buys nothing and costs 3x. The reason is honest and
worth stating rather than hiding: **every fault here except `transient-500` is
persistent for the length of a series.** A persistent fault cannot show a retry
recovering anything, only the load it adds.

Which is the shape of the real hazard. A dependency that is failing is usually
also a dependency that is overloaded, and the column that says `9` where the row
above says `3` is retry amplification — the mechanism that turns a brownout into
an outage. `transient-500` is the column where the other half shows up: it is
the only fault where a retrying wiring outscores the timeout it is built on, and
`retry-5xx` and `retry-any` both clear it in six requests instead of three.

## The breaker row says nothing about the dependency

On seven of the nine faults the breaker's cell is **identical**:
`breaker-open · prompt · 2`. Latency, a 500, an unparseable body, a refused
connection, a reset socket, a black hole — the row does not distinguish them,
because a breaker's whole design is to stop asking and report locally.

So the only column in which the breaker differs from `retry-any` is **requests**:
2 against 9. That is the entire measurable value of the mechanism, and it is in
the one column a suite asserting on return values never looks at. A breaker
wired up wrong — threshold never reached, state shared where it should be
per-dependency, or simply not reached because the code path is dead — returns
exactly what the row above it returns, on every fault.

It is also why `wiringFor('breaker')` is a factory rather than a constant: a
breaker shared between two cells would carry one fault's failures into the next
fault's measurement.

## The two injection layers

| layer | how the fault is produced | what it costs |
|---|---|---|
| `socket` | a real `node:http` origin on loopback, writing status lines, chunks and resets itself | one ephemeral port and a teardown; the ground truth every cell below is compared against |
| `fetch-stub` | a hand-written `fetch` returning `Response` objects, some of them over a `ReadableStream` | nothing — no port, no teardown, no network at all |

Everything above was measured against a real socket. Almost nobody does that.
The cheap layer is a hand-written `fetch` that returns what the fault is
supposed to look like, and it is cheap in a way that matters: no port, no
teardown, no flake surface, and it runs in jsdom.

So the question is how much it gets right, and the comparison is only worth
having if the stub gets its best shot. It does. It does not hand-wave the
transport faults: `connection-refused` throws a `TypeError` whose `cause.code`
is `ECONNREFUSED`, and `reset-mid-body` errors a half-written body stream with
`UND_ERR_SOCKET` — which is what undici really does, and what a diligent author
gets by reading one real error before writing the stub. `slow-body` is a real
`ReadableStream`, so the headers genuinely arrive before the body stalls.

It has exactly one weakness, and it is not one anybody would catch in review:
**it ignores the `AbortSignal` it is handed.** A `Response` built by hand has no
connection to a signal and neither does a `ReadableStream` built by hand —
honouring one means writing the listener, the rejection and the stream teardown
yourself, three things `fetch` does and no stub in the wild does.

## The same table, injected the cheap way

| wiring | healthy | slow hdrs | slow body | 500 | 500 once | bad body | refused | reset | black hole |
|---|---|---|---|---|---|---|---|---|---|
| `bare` | ok · prompt · 3 | ok · waited-out · 3 | ok · waited-out · 3 | wrong-body · prompt · 3 | wrong-body · prompt · 3 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | hung · deadline · 3 |
| `race-timeout` | ok · prompt · 3 | aborted · prompt · 3 | ok · waited-out · 3 | http-error · prompt · 3 | http-error · prompt · 3 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | aborted · prompt · 3 |
| `signal-timeout` | ok · prompt · 3 | ok · waited-out · 3 | ok · waited-out · 3 | http-error · prompt · 3 | http-error · prompt · 3 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | hung · deadline · 3 |
| `retry-5xx` | ok · prompt · 3 | ok · waited-out · 3 | ok · waited-out · 3 | http-error · prompt · 9 | ok · prompt · 6 | malformed · prompt · 3 | refused · prompt · 3 | reset · prompt · 3 | hung · deadline · 3 |
| `retry-any` | ok · prompt · 3 | ok · waited-out · 3 | ok · waited-out · 3 | http-error · prompt · 9 | ok · prompt · 6 | malformed · prompt · 9 | refused · prompt · 9 | reset · prompt · 9 | hung · deadline · 3 |
| `breaker` | ok · prompt · 3 | ok · waited-out · 3 | ok · waited-out · 3 | breaker-open · prompt · 2 | ok · prompt · 6 | breaker-open · prompt · 2 | breaker-open · prompt · 2 | breaker-open · prompt · 2 | hung · deadline · 3 |

## Where the two layers disagree

| wiring | fault | `socket` says | `fetch-stub` says |
|---|---|---|---|
| `signal-timeout` | `slow-headers` | aborted · prompt · 3 | ok · waited-out · 3 |
| `signal-timeout` | `slow-body` | aborted · prompt · 3 | ok · waited-out · 3 |
| `signal-timeout` | `black-hole` | aborted · prompt · 3 | hung · deadline · 3 |
| `retry-5xx` | `slow-headers` | aborted · prompt · 3 | ok · waited-out · 3 |
| `retry-5xx` | `slow-body` | aborted · prompt · 3 | ok · waited-out · 3 |
| `retry-5xx` | `black-hole` | aborted · prompt · 3 | hung · deadline · 3 |
| `retry-any` | `slow-headers` | aborted · prompt · 9 | ok · waited-out · 3 |
| `retry-any` | `slow-body` | aborted · prompt · 9 | ok · waited-out · 3 |
| `retry-any` | `black-hole` | aborted · prompt · 9 | hung · deadline · 3 |
| `breaker` | `slow-headers` | breaker-open · prompt · 2 | ok · waited-out · 3 |
| `breaker` | `slow-body` | breaker-open · prompt · 2 | ok · waited-out · 3 |
| `breaker` | `black-hole` | breaker-open · prompt · 2 | hung · deadline · 3 |

## The cheap injection layer is faithful about events and backwards about waiting

Twelve cells of fifty-four, and they are not scattered. The stub agrees with the
socket on **every** cell of `healthy`, `error-500`, `transient-500`,
`malformed-body`, `connection-refused` and `reset-mid-body` — six columns, every
wiring, exact agreement including the request counts. Those are the faults made
of an **event**: a status, a payload, a refused connect, a dead socket. A hand-
written stub reproduces an event faithfully because an event is a value, and
returning a value is the one thing a stub does well.

Every disagreement is in the three columns made of **waiting** —
`slow-headers`, `slow-body`, `black-hole` — and on exactly the four wirings
whose defence is the signal the stub ignores. Four times three is twelve, and
the twelve are the whole set: the two wirings that do not use `AbortSignal`
(`bare`, which has no timeout, and `race-timeout`, which runs its own timer)
agree with the socket everywhere.

The rule that falls out is sharper than "stubs are approximate", and it is the
one worth taking away: **a fault that is a value can be injected from anywhere;
a fault that is a duration has to be injected from somewhere the clock is
real.** The cheap layer is not a bad tool, it is a tool with a boundary, and
the boundary is exactly where the fault stops being a thing that happened and
starts being a thing that did not.

## At the stub layer the broken wiring is the only one that looks correct

This is the direction that makes the twelve cells dangerous rather than merely
wrong. Against `slow-headers`:

```
socket       bare: waited-out    race: prompt   signal: prompt   retry-5xx: prompt   retry-any: prompt   breaker: prompt
fetch-stub   bare: waited-out    race: prompt   signal: waited-out   retry-5xx: waited-out   retry-any: waited-out   breaker: waited-out
```

At the socket layer all five wirings with a timeout end the call promptly, which
is what a timeout is for. At the stub layer **`race-timeout` is the only one that
does** — because its timer is its own and fires whatever the transport thinks,
while the four wirings that correctly delegate to the transport are delegating to
a stub that throws the signal away.

So a suite built on the cheap layer does not merely fail to find the bug in
`race-timeout`. It reports `race-timeout` as the one wiring whose timeout works,
and reports the four correct ones as hanging or over-running. Replace the broken
wiring with a correct one and that suite goes **red**. The pressure the
measurement applies is backwards, which is worse than no measurement, and
nothing about the stub looks wrong while it happens.

## A breaker cannot open against a dependency that never answers

The last cell is worth its own heading because it is a fact about breakers
rather than about stubs, and the stub layer is simply where it becomes visible.

```
socket       breaker / black-hole: breaker-open · prompt · 2
fetch-stub   breaker / black-hole: hung · deadline · 3
```

A breaker counts failures. A call that never settles never produces one. At the
socket layer the breaker opens against `black-hole` only because the
`AbortSignal` beneath it converted the silence into three failures it could
count; at the stub layer, where that signal is ignored, the breaker sits there
with its counter at zero while all three calls run to the harness's deadline.

**A circuit breaker's protection is entirely downstream of a working timeout.**
It is not a second line of defence against a hanging dependency — it is a
consumer of the first line, and with the first line removed it contributes
nothing at all. Which is the inverse of how a breaker is usually sold.

## Using it

```
pnpm test            # re-derives all 108 cells; chaos/ is about twelve seconds of it
```

There is no `chaos:check` script and no CI job of its own, deliberately. The
whole measurement needs an ephemeral loopback port and nothing else — no
browser, no container, no binary, no credential — so it belongs inside
`pnpm test`, where a cell that moves is caught on every commit rather than in a
job somebody can mark advisory. That is the difference between this directory
and `containers/` or `trace/`, which cannot go anywhere else.

To copy the technique rather than the result: `origin.ts` is the fault origin
and is the file worth reading first — every fault is three lines of
`node:http`, and the two that cannot be written any other way (`res.socket
.destroy()` with a body in flight, and a handler that simply returns) are three
lines each. `policies.ts` is the six wirings. If you take one thing, take
`slow-body`: it costs one route and it is the only fault in this catalogue that
can tell your timeout is in the wrong place.

## What is not measured here

- **The layer in between.** An interceptor that patches Node's HTTP stack — MSW
  in `node` mode, or an undici `MockAgent` — sits between the stub and the
  socket, and would plausibly get the latency cells right while staying cheap.
  It is not measured, so this directory makes no claim about it: the two layers
  here are the one everybody reaches for first and the one that is true.
- **Retry backoff and jitter.** The retrying wirings re-attempt immediately.
  Nothing measured depends on the gap between attempts and every cell is an
  outcome or a count, so a backoff would add a timer and a random draw to the
  one directory whose timings are already the thing under suspicion.
  `k6/load-test.ts` is where this repository argues for jitter.
- **Half-open breakers.** The breaker here opens and stays open. A reset timer
  would need a clock the three-call series is too short to reach, and would
  change no cell: what the table is about is whether the second and third call
  reach the dependency at all.
- **Transient transport faults.** `transient-500` heals; `reset-mid-body` and
  `connection-refused` do not. So the one case where `retry-any` should beat
  `retry-5xx` on an *outcome* rather than on a count — a socket that dies once
  and then works — has no column, and the finding above says what it says about
  this catalogue rather than about retries in general.
- **Concurrency.** One caller, three sequential calls. Connection-pool
  exhaustion, head-of-line blocking behind a parked request, and a thundering
  herd on breaker close are all real chaos faults and none of them is here.
- **Anything above the client.** These are faults between a service and one
  dependency. Partial failure across several dependencies, and whether a
  degraded answer is better than none, are design questions this measurement
  does not reach.

Measured against Node 22.22.0, whose `fetch` is undici. The band
boundaries, the budget and the injected latency are derived in `timings.ts`,
including the one that was got wrong first — a boundary with half a millisecond
of clearance, which published a band that flipped between two runs.
