# Testcontainers: Postgres, Redis and Kafka, per suite, with reuse

Reuse does not break tests. That is worth saying first, because "we tried
`withReuse()` and the suite went flaky" is the story everyone tells, and it is
never what happened. What breaks tests is state a suite does not own, and a
fresh container per suite is not an isolation strategy — it is a way of not
having one and getting away with it. Reuse simply stops the getting away with
it.

So the question this directory measures is not *is reuse safe*. It is: **of the
things a suite already does about state, which are enough, and what does each
one cost?** Three real servers, three behaviours per server chosen to trip on
three different kinds of leftover, four strategies per server, and every suite
run twice against one container.

The short answer is that no reset is complete on all three stores, one of them
is not even fast, and the failure modes are so different per store that "test
isolation" is barely one topic: Postgres fails an assertion, Redis fails a
different assertion depending on which namespace you picked, and Kafka does not
fail at all — it hangs.

## What is being compared

Each store gets the same three shapes: nothing, a reset, a namespace. The
namespace row is split in two where a store offers more than one, because that
is where the interesting differences are.

### Postgres

| Strategy | What it does |
| --- | --- |
| `none` | Write to the same schema every time and clean up nothing. |
| `truncate` | `TRUNCATE` every table between suites. |
| `truncate-restart` | `TRUNCATE … RESTART IDENTITY`, the same statement plus the sequences. |
| `schema-per-suite` | A schema per suite, `search_path` set to it. Nothing shared, so nothing reset. |

### Redis

| Strategy | What it does |
| --- | --- |
| `none` | One database, one key prefix, nothing cleared. |
| `flushdb` | `FLUSHDB` between suites. |
| `prefix-per-suite` | A key prefix per suite. Works in a cluster. |
| `db-per-suite` | A numbered database per suite. |

### Kafka

| Strategy | What it does |
| --- | --- |
| `none` | One pair of topics, one consumer group, for every suite that ever runs. |
| `delete-topic` | Delete the topics between suites, and wait for the deletion to reach metadata. |
| `group-per-suite` | A consumer group per suite, sharing the topics. |
| `topic-and-group-per-suite` | A topic and a group per suite. Nothing shared, nothing deleted. |

And the nine behaviours, each picked to depend on a different leftover:

| Store | Behaviour | Trips on |
| --- | --- | --- |
| Postgres | `counts-rows` | rows |
| Postgres | `first-receipt-id` | a sequence |
| Postgres | `rejects-duplicate-email` | a unique index |
| Redis | `misses-cold-cache` | a key |
| Redis | `acquires-lock` | a key with a TTL still running |
| Redis | `counts-its-own-keys` | the keyspace |
| Kafka | `creates-topics` | topic metadata |
| Kafka | `replays-seeded-events` | committed consumer-group offsets |
| Kafka | `counts-its-own-outbox` | the log |

## The matrix

Every suite runs twice against one container, with the strategy applied
between the two. The cell is what happened on the **second** run: `pass`, `fail`
(an assertion did not hold) or `hang` (nothing came back at all). The first run
is green in every cell of every table — `residue.container.test.ts` asserts
that separately, because a strategy whose first suite already fails would have
a meaningless second column.

### postgres

| Behaviour | `none` | `truncate` | `truncate-restart` | `schema-per-suite` |
| --- | --- | --- | --- | --- |
| `counts-rows` | fail | pass | pass | pass |
| `first-receipt-id` | fail | fail | pass | pass |
| `rejects-duplicate-email` | fail | pass | pass | pass |

### redis

| Behaviour | `none` | `flushdb` | `prefix-per-suite` | `db-per-suite` |
| --- | --- | --- | --- | --- |
| `misses-cold-cache` | fail | pass | pass | pass |
| `acquires-lock` | fail | pass | pass | pass |
| `counts-its-own-keys` | pass | pass | fail | pass |

### kafka

| Behaviour | `none` | `delete-topic` | `group-per-suite` | `topic-and-group-per-suite` |
| --- | --- | --- | --- | --- |
| `creates-topics` | fail | pass | fail | pass |
| `replays-seeded-events` | hang | pass | pass | pass |
| `counts-its-own-outbox` | fail | pass | fail | pass |

`residue.container.test.ts` re-derives every cell above on every run and fails
on any disagreement, in either direction: a cell that stops being true and a
cell nobody wrote down both go red.

## Five findings

### 1. The same leftover produces three different failure modes

`none` is red almost everywhere, which is the boring part. What each red cell
*does* is not boring at all, and it is the reason "just make the tests
independent" is poor advice on its own — the three stores do not tell you the
same thing when you get it wrong.

- **Postgres, `counts-rows`** fails on its own assertion: `expected 3 orders,
  found 6`. This is the good case. The message names the problem.
- **Postgres, `rejects-duplicate-email`** fails in its *arrange* step, before it
  asserts anything: the customer it was about to register is already there. A
  test that dies in setup reports a stack trace from a fixture, and the first
  instinct is to look at the fixture.
- **Kafka, `replays-seeded-events`** does not fail. The consumer group's
  committed offsets are already at the end of the log, so the consumer receives
  nothing, and goes on receiving nothing. The suite is red only when whatever
  timeout is outermost fires — and the first thing anybody does with a test that
  times out is raise the timeout.

That third one is why the outcome vocabulary here has three words rather than
two. `hang` is not a worse `fail`; it is a different thing to debug, on a
different day, by somebody who has stopped believing the test.

### 2. `TRUNCATE` is not a reset, and everybody's first reset is `TRUNCATE`

The `truncate` column is green except for one cell, and that cell is the whole
finding: `first-receipt-id` inserts one row into an empty table and expects id
1, and gets 2. `TRUNCATE` removes rows. A `bigserial`'s sequence is a separate
object and it is not a row, so it survives — `TRUNCATE … RESTART IDENTITY` is
the version that does what people think the first one does.

This is the most dangerous cell in the three tables, because it is the one that
looks fine. Two of the three Postgres behaviours pass under `truncate`; a suite
whose tests never assert on a generated id would be green for years and would
still be sharing state.

### 3. A namespace is the only thing that is complete for all three stores — and picking the wrong namespace is its own bug

`schema-per-suite`, `db-per-suite` and `topic-and-group-per-suite` are the three
green columns. They are also the three cheapest: nothing is deleted, so nothing
has to be waited for.

But `prefix-per-suite` and `group-per-suite` are namespaces too, and both have a
red cell:

- **A Redis key prefix does not partition the keyspace.** `misses-cold-cache`
  and `acquires-lock` pass under `prefix-per-suite`, because both are about a
  key. `counts-its-own-keys` calls `DBSIZE` and sees four keys where it wrote
  two, because `DBSIZE`, `KEYS`, `SCAN` and `FLUSHDB` are about the database and
  a prefix is not a database. Note the direction: this is the one Redis
  behaviour that `none` *passes*, since two suites writing the same two keys
  leave two keys behind. The namespace made a passing test fail.
- **A Kafka consumer group is only half the state.** `group-per-suite` fixes
  exactly the offsets — `replays-seeded-events` goes from `hang` to `pass` — and
  leaves the log and the topic metadata alone, so the other two cells stay red.

The Redis case has a deployment constraint attached: a stock Redis has sixteen
numbered databases and Redis Cluster has one, so a suite that will run against
a cluster takes the prefix and lives with the blind spot. `suite.ts` allocates a
database per suite and says so when it runs out, rather than wrapping round and
handing two suites the same one.

### 4. Deleting a Kafka topic is the only reset here that is not instantaneous

The reset column costs, measured as the time each strategy's `beforeAll` took
between the two suites:

| Strategy | Between suites |
| --- | --- |
| `postgres` / `truncate` | 20ms |
| `postgres` / `truncate-restart` | 19ms |
| `postgres` / `schema-per-suite` | 20ms |
| `redis` / `flushdb` | 2ms |
| `redis` / `db-per-suite` | 0ms |
| `kafka` / `delete-topic` | 63ms |
| `kafka` / `topic-and-group-per-suite` | 0ms |

63ms is not slow — the CI runner measured 55ms for the same reset. It is
*asynchronous*, which is the part that matters:
`deleteTopics` returns when the controller accepts the request, not when the
topic is gone, and a `createTopics` issued too early fails against a topic that
is mid-deletion. So `isolation.ts` has an `awaitTopicGone` polling loop, and
neither Postgres nor Redis needs anything of the kind — `TRUNCATE` and `FLUSHDB`
have both happened by the time they return. On a single-broker KRaft cluster
with two topics the wait is tens of milliseconds; it is a function of the
cluster, and it is a loop somebody has to write and get right, in return for
nothing that naming the topic per suite does not give for free.

### 5. `start()` resolving is not readiness, and the gap is not where you would guess

Every figure below is a pair, because `await container.start()` is two things:
the runtime started a container, and *some wait strategy decided that was
enough*. `awaitUsable` then performs one real operation of the store's own
protocol — a query, a `PING`, a metadata fetch — and counts what that costs.

Measured on the machine named at the bottom of this file, images already
pulled, containers not reused — and, in the right-hand columns, on the
`ubuntu-latest` runner of the CI job that runs these suites, which is a
different machine, a different Docker version and a cold image cache:

| Store | `start()` | usable after | probes | total | CI `start()` | CI usable after | CI probes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Postgres | 2,330ms | +22ms | 1 | 2,352ms | 2,093ms | +10ms | 1 |
| Redis | 259ms | +10ms | 1 | 269ms | 143ms | +2ms | 1 |
| Kafka | 225ms | +7,647ms | 146 | 7,872ms | 144ms | +7,517ms | 145 |

The two machines agree to within a few per cent on every figure, and the
matrix cells are identical on both — which is the point of quoting them side by
side. This is not a slow laptop.

Postgres and Redis are honest: one probe, single-digit or low-double-digit
milliseconds, which is the probe's own connection setup rather than a gap.
Postgres is honest *because the module injects a `HEALTHCHECK`* — the official
image ships none, and `@testcontainers/postgresql` adds `pg_isready` on a 250ms
interval and waits for it.

Kafka's `start()` is the **fastest of the three** and its readiness is by far
the slowest: 97% of the wait happens after the container reports itself
started, across 146 probes of which 145 were refused. That is not the broker
being slow, and it is not a race that a bigger machine fixes. The mechanism is a
one-line bug in `@testcontainers/kafka@12.1.0`, which is why the version is
pinned exactly:

```js
// beforeContainerCreated(): swap in a substitute strategy so the real starter
// script can be copied in once the published port is known.
this.originalWaitStrategy = this.waitStrategy            // undefined — nobody set one
this.waitStrategy = Wait.forLogMessage('Waiting for script...')

// containerStarted(): wait again, this time — it intends — for the real one.
const waitStrategy = await this.selectWaitStrategy(client, inspect, this.originalWaitStrategy)
```

`selectWaitStrategy` is declared `(…, waitStrategy = this.waitStrategy)`.
Passing an explicit `undefined` to a parameter that has a default *triggers the
default*, so the second wait is handed the substitute strategy — a log line the
container printed seconds earlier — and returns at once. The intended fallback,
`Wait.forListeningPorts()`, is never reached. The debug log shows the same wait
happening twice:

```
[02bcc51eaf4b] Waiting for log message "Waiting for script..."...   ← the substitute
[02bcc51eaf4b] Log wait strategy complete
[02bcc51eaf4b] Waiting for container to be ready...                 ← the "real" wait
[02bcc51eaf4b] Waiting for log message "Waiting for script..."...   ← the same one
[02bcc51eaf4b] Log wait strategy complete
```

A suite whose client retries — kafkajs does, five times, with backoff, which
comes to about nine seconds — sees this as slowness. A suite whose client does
not sees a connection error on a container that had just reported itself
started, on some runs and not others. This directory measured the second
version first: with retries switched off, one of the four first-run consumers in
the residue matrix read nothing at all inside its eight-second budget, from a
topic that had been created and seeded moments earlier. The other three were
fine. That is the shape of the bug — it is a race, and the container being
"started" is what makes it look like one that cannot exist.

The conclusion is not "avoid the Kafka module". It is that a wait strategy is
somebody else's claim about readiness, the client is the only thing that knows,
and one real operation before the first test is cheap insurance —
`startUsableStore` never hands back a store that has not answered.

## What reuse is worth, and why it is off in CI

`withReuse()` finds a running container whose creation request hashes to the
same value and adopts it. Measured here, cold against warm, total wait
including readiness:

| Store | Cold | Reused | Saved |
| --- | --- | --- | --- |
| Postgres | 2,146ms | 100ms | 95% |
| Redis | 207ms | 18ms | 91% |
| Kafka | 7,294ms | 36ms | 99.5% |

Kafka is where reuse pays, and it pays because of finding 5: what reuse skips is
not container creation — that was 225ms — it is the seven and a half seconds of
broker startup that `start()` never waited for in the first place.

Two things about it are worth knowing before switching it on, and
`reuse.container.test.ts` checks both:

- **The match is a hash of the whole creation request.** Add an environment
  variable, change a label, expose another port, and the second start silently
  creates a *second* container rather than failing. The failure mode of reuse is
  not corruption; it is reuse quietly not happening, and the only symptom is the
  wall clock.
- **A reused container is invisible to the reaper.** Ryuk removes containers by
  the `org.testcontainers.session-id` label, and `GenericContainer#start`
  attaches that label on the path that does *not* reuse — necessarily, because a
  container marked with this session's id would be destroyed when this session
  ends, and then there would be nothing to reuse. So a reused container outlives
  every run. That is the right trade on a developer machine and the wrong one on
  a shared daemon.

Hence the policy in `daemon.ts`: reuse when a human is watching, cold containers
under `CI`. On a hosted runner the daemon starts empty, so every reuse lookup
would miss and the saving would be exactly zero — leaving only the liability.
`CONTAINERS_REUSE=1` or `=0` overrides it either way.

Locally, `pnpm containers:prune` removes what reuse left behind. It matches this
directory's own label rather than `org.testcontainers`, because the second one
also matches whatever else on the machine happens to use Testcontainers.

## The fixture

`suite.ts` is the part to copy. It is the matrix's conclusion as code:

```ts
describe('an orders table', () => {
  const postgres = usePostgresSuite('orders api')

  it('stores an order and reads it back', async () => {
    await postgres().connect(async (client) => {
      // `search_path` already points at this suite's own schema
    })
  })
})
```

- **One container per store per *run*, not per suite.** The first suite that
  asks for a store starts it; every other suite in the run shares it. "Spun up
  per suite" is what the phrase says and it would mean paying finding 5's eleven
  seconds again for each one.
- **A namespace per suite**, from the green column of the matrix: a schema for
  Postgres, a numbered database for Redis, a topic and group name for Kafka.
- **The namespace carries a per-run nonce**, not just the suite name. A name
  derived from the suite alone is unique within a run and identical across runs,
  which is exactly the state a reused container preserves — running
  `pnpm test:containers` twice would otherwise mean something different from
  running it once.
- **Postgres and Redis are torn down; Kafka is not.** Dropping a schema and
  flushing a database are one immediate statement each. Deleting a topic is
  finding 4, so a reused broker accumulates one topic per suite per run and the
  thing that collects them is `containers:prune`.

`example.container.test.ts` is the same fixture used in anger against all three
stores, and it is a runnable file rather than a snippet in this README.

## Running it

```
pnpm test              # the image table, the fixture's naming, this README. No Docker.
pnpm test:containers   # everything that starts a container. Needs a runtime.
pnpm containers:prune  # remove what reuse left running
```

The split is by filename: `*.container.test.ts` needs a container runtime and
runs in its own Vitest project and its own CI job; every other test file in this
directory is ordinary computation and runs in `pnpm test` on every commit, so
the image pins, the naming rules and this README's tables are checked whether or
not a daemon is available.

An environment that cannot reach Docker Hub sets
`TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX` (for example `mirror.gcr.io/`) and
Testcontainers rewrites every unqualified image name, Ryuk's included.

## One warning this job emits and nothing catches

The CI job's log carries a single line the local run does not:

```
(node:2681) TimeoutNegativeWarning: -1788789282350 is a negative number.
Timeout duration was set to 1.
```

The number is exactly `-Date.now()`, which locates it precisely.
`kafkajs@2.2.4` initialises `RequestQueue#throttledUntil` to `-1` and computes
`scheduleAt = this.throttledUntil - Date.now()` in
`scheduleCheckPendingRequests`; the clamp to a positive value on the next line
only applies when there is something pending, so an empty queue schedules a
timer with a large negative delay. Node clamps it to 1ms and warns. Nothing
misbehaves.

It is recorded here rather than fixed, and rather than ignored, because this
repository made warnings fatal on purpose and this is one that no gate can see:
`--throw-deprecation` promotes `DeprecationWarning` and this is a
`TimeoutNegativeWarning`. The two ways to close it are a `process.on('warning')`
trap that fails the run, and a one-line patch to kafkajs in `patches/` beside
the Storybook one. Both were considered and neither was taken for a log line
that costs nothing: the trap would fail this job on any warning any dependency
ever emits, which is a policy decision for the whole repository rather than for
one directory, and a patched dependency is maintenance carried until upstream
moves — and kafkajs 2.2.4 is from 2022.

## What is deliberately not here

- **A comparison of database isolation strategies.** Transaction rollback per
  test, a template database, `TRUNCATE` — that is the next item in `SPEC.md` and
  it deserves its own subject. The Postgres column here asks only what a *reused
  container* leaks and which of the obvious answers covers it.
- **More than one broker, or a network.** Every measurement above is one
  container per store on the default bridge. Multi-container topologies
  (`Network`, compose) change the readiness question and would change finding 5.
- **Reuse across processes.** Vitest is configured `singleFork` here, so
  "shared" means shared within one worker. Reuse across *runs* is measured;
  reuse across concurrent workers is a lock-contention question this directory
  does not answer.

## Provenance

Every number above was measured on:

- Linux 6.18 x86_64, 4 CPUs, 15.7GiB, Docker Engine 29.3.1; the CI columns are
  a GitHub `ubuntu-latest` runner, 4 CPUs, Docker Engine 28.0.4
- `testcontainers@12.1.0`, `@testcontainers/postgresql@12.1.0`,
  `@testcontainers/redis@12.1.0`, `@testcontainers/kafka@12.1.0`, all pinned
  exactly — finding 5 is a property of a version, not of Kafka
- `postgres:17-alpine`, `redis:7.4-alpine`, `confluentinc/cp-kafka:8.0.0`
- Images already present locally, so no pull is included in any figure

The matrix cells are asserted against a live run on every CI build. The
millisecond figures are not: a gate that fails because a runner was 40ms slower
is a gate somebody switches off. What `readiness.container.test.ts` asserts
instead is the shape — Postgres and Redis usable on the first probe, Kafka not,
and `start()` accounting for a smaller share of the wait on Kafka than on either
other store — which is the part that is a property of the modules rather than of
the hardware.
