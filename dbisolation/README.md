# Database test isolation

Seven ways to stop one test's writes reaching the next, measured against one
Postgres-backed service.

The three the literature names are truncation, transaction rollback and a
template database. The measurement says those three are not the choice, for two
reasons that only appear once a real subject is used:

1. **"Transaction rollback" is two strategies and only one of them isolates.**
   The version everybody describes — `BEGIN` before the test, `ROLLBACK` after —
   stops working the moment the code under test opens a transaction of its own,
   because Postgres has no nested `BEGIN`. The subject's `COMMIT` commits the
   harness's transaction. Nothing errors. The suite goes on passing.
2. **The strategy that isolates best is not the one that tests best.** Rewriting
   the subject's transaction control into savepoints — what Rails, Django and
   `pytest-django` actually ship — isolates almost perfectly and costs five of
   the ten faults in the corpus, plus three of the seven behaviours, which stop
   being able to report anything at all.

What that leaves is on the last line of this document, and it is not any of the
three.

---

## What is being measured

One subject: `orders.ts`, a service that places an order — a header, its lines,
a stock decrement, an audit row and a `NOTIFY`, inside a transaction it opens
and commits itself. It is written the way a service is written, and that is the
load-bearing choice: against a subject that issues one statement per call, six
of these seven strategies are indistinguishable.

Three measurements, each with its own module and its own container suite:

| Measurement | Question | Module |
| --- | --- | --- |
| Detection | Which bugs can a suite still see under this strategy? | `matrix.ts` |
| Leakage | What does the strategy fail to remove between two tests? | `leakage.ts` |
| Cost | What does it charge per test, forever? | `cost.ts` |

Ten faults, each a flag on the one implementation rather than a copy of it, and
each reachable by exactly one mechanism — an assertion, an immediate constraint,
a deferred constraint, or a second connection. Seven behaviours, each declaring
where it has to stand to see anything. Five leakage probes, two of which differ
in one thing only.

---

## Detection

Every cell is scored against that strategy's own **control run** on the correct
subject. A fault counts as `caught` only when some behaviour was green on the
correct subject and red with the fault; a behaviour that is red either way is a
false alarm and is excluded rather than credited, because its verdict does not
depend on the code.

| Fault | `none` | `truncate` | `truncate-restart` | `truncate-derived` | `rollback` | `rollback-savepoint` | `schema-per-test` | `template-db` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TOTAL_NOT_RECOMPUTED` | caught | caught | caught | caught | caught | caught | caught | caught |
| `STOCK_NOT_DECREMENTED` | caught | caught | caught | caught | caught | caught | caught | caught |
| `WRONG_LINE_COUNT` | caught | caught | caught | caught | caught | caught | caught | caught |
| `AUDIT_NOT_WRITTEN` | caught | caught | caught | caught | caught | caught | caught | caught |
| `STOCK_OVERSOLD` | caught | caught | caught | caught | caught | caught | caught | caught |
| `ORPHAN_LINE` | caught | caught | caught | caught | caught | missed | caught | caught |
| `DUPLICATE_REF` | caught | caught | caught | caught | caught | missed | caught | caught |
| `NEVER_COMMITS` | caught | caught | caught | caught | caught | missed | caught | caught |
| `NOTIFY_MISSING` | caught | caught | caught | caught | caught | missed | caught | caught |
| `MIGRATION_IN_TX` | caught | caught | caught | caught | missed | missed | caught | caught |

Six columns score 10/10. `rollback` scores 9/10 and `rollback-savepoint` 5/10.

And which behaviours can be run at all:

| Behaviour | `none` | `truncate` | `truncate-restart` | `truncate-derived` | `rollback` | `rollback-savepoint` | `schema-per-test` | `template-db` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `total` | runs | runs | runs | runs | runs | runs | runs | runs |
| `lines` | runs | runs | runs | runs | runs | runs | runs | runs |
| `stock` | runs | runs | runs | runs | runs | runs | runs | runs |
| `audit` | runs | runs | runs | runs | runs | runs | runs | runs |
| `durability` | runs | runs | runs | runs | runs | unusable | runs | runs |
| `notification` | runs | runs | runs | runs | runs | unusable | runs | runs |
| `migration` | runs | runs | runs | runs | unusable | unusable | runs | runs |

`unusable` means the behaviour is red on a subject with nothing wrong with it.
It is not a softer `missed` — a missed fault is a test that passed when it
should not have, and an unusable behaviour is a test whose result stopped
carrying information in either direction. A suite acquires three of them the day
it switches to savepoint isolation, and what happens next is that somebody
deletes them, because they are red and nobody can make them green.

### The finding nobody quotes

**`rollback` detects more than `rollback-savepoint` precisely because it is not
isolating anything.** Its nine detections include all four commit-time faults —
the deferred foreign key, the deferred unique constraint, the missing commit,
the missing notification — and it catches them because the subject's `COMMIT`
really does commit. The strategy is a detection column and a leakage column at
the same time, and the leakage table below is where it comes apart.

That is worth saying plainly, because the naive wrapper is the version in most
write-ups and it *looks* fine from inside a passing suite. Its failure is not an
error. It is two `WARNING`s on a channel most drivers do not surface, measured
in `mechanism.container.test.ts`: `there is already a transaction in progress`
when the subject begins, and `there is no transaction in progress` when the
harness tries to roll back.

### Why the misses are where they are

Four of the five misses in the `rollback-savepoint` column fall on a fault whose
mechanism is `deferred-constraint` or `other-connection`, and both follow from
the strategy rather than from the fault:

- A deferred constraint is checked at `COMMIT` and nowhere else. The strategy's
  whole trick is that the subject's `COMMIT` becomes `RELEASE SAVEPOINT`, and a
  release does not run the check. Measured directly: the same orphan row is
  released without complaint and rejected with `23503` when committed.
- Uncommitted rows are visible to no other session, so a behaviour standing on a
  second connection sees nothing — on the correct subject as much as on the
  faulted one, which is why `durability` and `notification` are unusable rather
  than merely blind.

`MIGRATION_IN_TX` is a third kind again, and it costs both rollback columns the
same behaviour. `CREATE INDEX CONCURRENTLY` is rejected inside a transaction
block with `25001`, so a strategy that holds a transaction open for the whole
test cannot run that migration, correct or faulted. `IF NOT EXISTS` does not
help — the transaction-block test happens first, even when the index is already
there.

---

## Leakage

The same probe, run twice against one strategy. The first run is asserted green
everywhere — a strategy whose first run fails is broken rather than leaky — and
the cell is what the second run did.

| Probe | `none` | `truncate` | `truncate-restart` | `truncate-derived` | `rollback` | `rollback-savepoint` | `schema-per-test` | `template-db` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rows` | fail | pass | pass | pass | fail | pass | pass | pass |
| `plain-insert` | fail | pass | pass | pass | pass | pass | pass | pass |
| `ids` | fail | fail | pass | pass | fail | fail | pass | pass |
| `audit` | fail | fail | fail | pass | fail | pass | pass | pass |
| `ddl` | fail | fail | fail | fail | pass | pass | pass | pass |

Four things fall out of it.

**`rows` and `plain-insert` differ in one thing, and one column notices.** Both
write a single order row and count the table. `rows` goes through the subject,
which opens a transaction and commits it; `plain-insert` writes directly. Every
column agrees on them except `rollback`, which passes the direct write and fails
the one that went through a transaction. That is the naive strategy's failure
stated exactly: it is not weak, it is *conditional*, and the condition is
whether the code under test manages a transaction. A team whose repositories are
single-statement will never see it fail, and will see it fail the week somebody
adds a transaction to one.

**A sequence is not transactional, so rollback does not reset ids either.**
`ids` is the one probe the savepoint strategy fails, and it fails it for the
same reason `truncate` does: `ROLLBACK` gives back the row and not the number,
exactly as `TRUNCATE` without `RESTART IDENTITY` does. The two families are
usually described as opposites and they share this blind spot.

**`TRUNCATE` is a list, and a list goes stale.** `truncate` and
`truncate-restart` fail `audit` because `TRUNCATED_TABLES` in `schema.ts` does
not name `audit_log`. The omission is deliberate and it is the only
hand-maintained list in this directory: it is what a `TRUNCATE` list becomes six
months after somebody adds a table in a pull request that has no reason to touch
the test harness. `truncate-derived` is the same strategy reading
`information_schema` instead, it is four lines, and it closes the cell.

**Nothing that empties tables undoes a schema change.** All four `truncate`
columns fail `ddl`. Both rollback columns pass it, because DDL in Postgres is
transactional — which is the one thing the rollback family does that truncation
cannot. Only the two namespace strategies pass every row.

---

## Cost

Median over 20 iterations, timing only `beginTest` and `endTest` with a
one-statement body. Serial, unlike the other two matrices, which overlap eight
runs on one server — a millisecond figure taken under that load would be a
measurement of the harness.

| Strategy | Median | Range |
| --- | --- | --- |
| `connect-only` (baseline) | 8.4ms | 7.6 – 16.4 |
| `rollback` | 0.8ms | 0.7 – 1.5 |
| `rollback-savepoint` | 0.8ms | 0.7 – 2.4 |
| `none` | 11.6ms | 10.1 – 16.9 |
| `truncate` | 17.1ms | 16.1 – 32.5 |
| `truncate-restart` | 18.2ms | 17.3 – 21.7 |
| `truncate-derived` | 28.7ms | 26.4 – 32.5 |
| `schema-per-test` | 45.3ms | 42.2 – 60.1 |
| `template-db` | 58.9ms | 55.6 – 105.3 |

Those figures are one run's, on one machine, against a container started for it.
They move: an earlier run of the same code against a server that had
accumulated a few hundred databases put `template-db` at 162.8ms rather than
58.9ms, which is a property of that server and not of the strategy. The suite
does not assert them. What it
asserts is the orderings in `COST_ORDERINGS`, each of which names a pair with a
multiple between them rather than two neighbours: `truncate-restart` against
`truncate` is a real difference and not a robust one, and a claim that flips on
a noisy runner teaches the next person to re-run the job rather than read it.

| Cheaper | Dearer | Why |
| --- | --- | --- |
| `rollback-savepoint` | `none` | The rollback family holds one connection for the whole run; `none` does nothing between tests and is still dearer, because it reconnects. |
| `rollback` | `truncate` | The comparison usually quoted. |
| `none` | `truncate` | What the `TRUNCATE` itself costs, with the connection on both sides of the subtraction. |
| `truncate` | `truncate-derived` | A catalogue query per test is the price of the list not going stale. |
| `truncate-derived` | `schema-per-test` | A schema per test re-runs the whole DDL per test. |
| `schema-per-test` | `template-db` | Cloning a database copies files; creating a schema writes catalogue rows. |

The `connect-only` row is why this table is worth having. "Transaction rollback
is twenty times faster than truncating" is true here — 0.8ms against 17.1ms —
and it is mostly not a fact about `TRUNCATE`. Five of the seven strategies hand
each test a fresh connection, which costs 8.4ms before anything is reset, and
the rollback family is the only one that cannot and therefore never pays it.
That connection is **half** of the 16.3ms headline gap. Against `none`, which
reconnects and then does nothing, the `TRUNCATE` itself is worth 5.5ms. A suite
that pools its connections halves the gap without changing strategy at all.

`template-db` is the expensive row and it is the only strategy that restores the
catalogue by copying rather than by rebuilding, which is what it is being paid
for. At 58.9ms per test a thousand-test suite spends a minute cloning, and on
the loaded server above nearly three. That range is the number to put next to
the alternative rather than the word "slow".

---

## Five facts, asked of the server

Every miss above is downstream of one of these, and they are measured in
`mechanism.container.test.ts` rather than cited, because each is the kind of
claim that sounds settled.

1. **There is no nested `BEGIN`.** A second `BEGIN` inside a transaction is a
   `WARNING` and a no-op; the following `COMMIT` commits the outer transaction.
   The harness's `ROLLBACK` then warns that there is no transaction in progress
   and the rows survive.
2. **`RELEASE SAVEPOINT` does not check deferred constraints.** The same orphan
   row releases cleanly and fails `COMMIT` with `23503`.
3. **`CREATE INDEX CONCURRENTLY` is rejected inside a transaction block** with
   `25001`, and `IF NOT EXISTS` does not spare it even when the index exists.
4. **A sequence is not restored by `ROLLBACK`.** The rolled-back insert takes
   id 1 and the next insert takes id 2.
5. **A template database must have no other sessions connected,** and `STRATEGY`
   does not change that: both `WAL_LOG` (the default since Postgres 15) and
   `FILE_COPY` raise `55006` while a session is attached, and both succeed once
   it is gone.

Fact 5 is in this list because the first draft of this directory claimed the
opposite, from a plausible inference about a real change and a shell probe whose
background session had already exited. It also has a consequence for the
harness rather than the subject: `template-db` applies the DDL to its template
and then **ends that connection**, and must. A harness that pooled a connection
to its own template — the obvious thing to do, and what every other strategy in
`strategies.ts` does — fails on the first clone with an error naming the
template rather than the pool.

---

## What to use

Not any of the three the question names.

**A namespace per test.** `schema-per-test` and `template-db` are the only
columns that are green everywhere in both matrices: 10/10 detection, seven
behaviours usable, five leakage probes passed. They are also the two most
expensive, and they are expensive for the same reason they are complete — they
restore the catalogue rather than emptying tables, so DDL, sequences and tables
nobody remembered are all covered by construction rather than by a list.

Between the two, `schema-per-test` at 45.3ms against `template-db`'s 58.9ms —
and the gap widens on a busy server, because cloning is the row that degrades —
unless the subject does something a schema cannot hold: anything reading
`pg_database`, anything with an extension installed per database, anything where
`current_schema()` would have to appear in production code to make the tests
pass. `containers/README.md` reaches the same recommendation from an entirely
different measurement — what a *reused container* leaks between suites — and
`containers/suite.ts` implements the schema-per-suite version of it.

**If the suite is too large to pay for that,** `truncate-derived` is the honest
fallback: it costs 28.7ms, it scores 10/10 on detection, and the only leakage
row it fails is `ddl`. Derive the table list; do not write one down. The two
columns either side of it in the leakage table are the same strategy with a
list that was correct when somebody typed it.

**Do not reach for the transaction wrapper because it is fast.** It is fast, by
a factor the baseline row shows is half the connection. What it costs is five
of ten faults and three of seven behaviours, and the bill arrives as tests that
are deleted for being red rather than as a number anybody measures.
