# Idempotency and retry-safety: a harness, and what it says about eight designs

The standard test for an idempotency key is: call the handler twice, assert the
second response matches the first, assert there is one row. It passes against
`memo-after`, which is the implementation most people write, and which is
**exactly as safe as having no idempotency at all** — 4 of 11 hazards handled,
the same score as the control.

It passes because the standard test poses one hazard out of eleven, and it is
the only one `memo-after` survives.

This directory is a harness for posing the other ten, plus eight reference
implementations to validate it against. The harness is the deliverable; the
matrix is how it earns the right to be believed.

## What is being compared

One subject: `POST /v1/charges`, which inserts a row **and** calls a payment
gateway. The second effect is the part most treatments of this topic leave out,
and leaving it out is what makes the topic look solved — the gateway is somebody
else's process, it does not join your transaction, and once it has answered the
money has moved whatever you do next.

| Strategy | What it does |
| --- | --- |
| `none` | No idempotency of any kind. The control. |
| `retry-backoff` | Exponential backoff with full jitter on the client, and nothing on the server. |
| `natural-key` | A unique constraint on the order id already in the payload; catch the violation. |
| `memo-after` | Look the key up, do the work, then record the response against it. |
| `memo-before` | Commit the key first, in its own transaction, then do the work. |
| `lease` | Commit an in-progress lease, do the work, mark the key done. No recovery. |
| `lease-recovering` | A lease that expires, a stored request fingerprint, and the key passed downstream. |
| `atomic-outbox` | Key, charge and outbox row in one transaction; a consumer calls the gateway after. |

## The outcomes

Seven words, ordered by how bad they are and how long they stay invisible. A
vocabulary with one failure word in it scores "charged the customer twice" and
"took the order and charged nobody" the same, which is what makes `memo-before`
look like a fix.

| Outcome | Meaning |
| --- | --- |
| `safe` | The world matches what a correct implementation leaves, and the client was told the truth. |
| `rejected` | The retry was refused, and refusing was right. |
| `blocked` | The retry got a 409 and the work is stranded. Nothing is corrupt; nobody has an answer. |
| `duplicate` | The effect happened more times than it should have. |
| `lost` | The effect happened fewer times than it should have, and the client was told otherwise. |
| `orphaned` | Money moved and no record of it exists. |
| `wrong-response` | The effects are right and the answer is not — a different request's, or a different customer's. |

`blocked` is never the correct answer to anything here. A client holding a 409
does not know whether it has been charged.

## The matrix

Eleven hazards, eight strategies, re-derived on every run and checked against
this table in both directions by `matrix.test.ts`.

| Hazard | `none` | `retry-backoff` | `natural-key` | `memo-after` | `memo-before` | `lease` | `lease-recovering` | `atomic-outbox` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `clean` | `safe` | `safe` | `safe` | `safe` | `safe` | `safe` | `safe` | `safe` |
| `sequential-retry` | `duplicate` | `duplicate` | `safe` | `safe` | `safe` | `safe` | `safe` | `safe` |
| `concurrent-retry` | `duplicate` | `duplicate` | `safe` | `duplicate` | `safe` | `blocked` | `blocked` | `safe` |
| `crash-after-effect` | `duplicate` | `duplicate` | `safe` | `duplicate` | `safe` | `blocked` | `duplicate` | `safe` |
| `crash-after-claim` | `duplicate` | `duplicate` | `safe` | `duplicate` | `lost` | `blocked` | `safe` | `safe` |
| `crash-after-gateway` | `duplicate` | `duplicate` | `duplicate` | `duplicate` | `orphaned` | `orphaned` | `safe` | `safe` |
| `different-body-same-key` | `duplicate` | `duplicate` | `wrong-response` | `wrong-response` | `wrong-response` | `wrong-response` | `rejected` | `rejected` |
| `cross-principal-key` | `safe` | `safe` | `safe` | `wrong-response` | `safe` | `safe` | `safe` | `safe` |
| `retry-after-decline` | `safe` | `safe` | `safe` | `lost` | `lost` | `lost` | `lost` | `lost` |
| `retry-after-invalid` | `rejected` | `rejected` | `rejected` | `rejected` | `rejected` | `rejected` | `rejected` | `rejected` |
| `key-expired` | `duplicate` | `duplicate` | `safe` | `safe` | `safe` | `safe` | `duplicate` | `safe` |

| Strategy | Handled |
| --- | --- |
| `none` | 4/11 |
| `retry-backoff` | 4/11 |
| `natural-key` | 9/11 |
| `memo-after` | 4/11 |
| `memo-before` | 7/11 |
| `lease` | 5/11 |
| `lease-recovering` | 7/11 |
| `atomic-outbox` | 10/11 |

## What the table says

**Backoff is not a safety mechanism, and the two columns are identical on every
row.** `retry-backoff` genuinely runs one — the deliveries really are spaced by
a growing, seeded, jittered delay on the injected clock, and
`strategies.test.ts` asserts both that the spacing grows and that the column
matches `none` in all eleven cells. Retry budgets, backoff, jitter and circuit
breakers are about load. They decide *when* a duplicate arrives and have no
opinion about whether it is one. This is the single most common answer to "make
our retries safe" and it is worth nothing against correctness.

**The most commonly written implementation scores the same as no idempotency.**
`memo-after` handles 4 of 11, and it is not the same 4 — it fixes
`sequential-retry` and `key-expired`, and it *introduces* two failures `none`
does not have. It loses `cross-principal-key` by looking its key up without a
tenant predicate, handing one customer another customer's charge id; and it
loses `retry-after-decline` by recording the 502 against the key, which makes
that key permanently dead. The window it does not close is between the effect's
commit and the key's, and `concurrent-retry` and `crash-after-effect` are that
window from the outside and the inside. They are the same bug and they are
adjacent cells.

**The unfashionable design is second.** `natural-key` — a unique constraint on
something the payload already contains, no header, no key table, no expiry —
handles 9 of 11, more than every idempotency-key design except the outbox. The
order id was already the identity of the operation and the database already
enforces uniqueness; the whole implementation is one index and one `catch`. Its
two failures are instructive rather than incidental. It is blind to everything
outside the key, so a retry that changes the amount is answered with the
original amount and a 200 (`different-body-same-key`); and it cannot help with
the gateway, because nothing that protects one database can.

**`lease` scores worse than the bug it fixes.** `memo-before` gets 7, `lease`
gets 5. The lease closes the race `memo-before`'s successors are usually
introduced to close, and pays for it by turning every crash into a permanent
409: a lease with no expiry is a lock with no owner, and the operation can never
be completed by anybody. Four of its cells are `blocked`, and `blocked` means a
client that will retry forever and a charge that will never happen.
`lease-recovering` is the same design with the expiry actually implemented, and
it is worth two cells.

**Nothing protects the external effect except telling the external system.**
`crash-after-gateway` kills the process after the money has moved and before
anything about it is committed. Six of eight columns fail it — `none`,
`retry-backoff`, `natural-key` and `memo-after` all charge twice, and
`memo-before` and `lease` produce the only `orphaned` cells in the table: money
gone, no record, nobody knows. The two that survive both do so for the same
reason and it is not the reason either is usually credited for. They pass a
deduplication key **downstream**, and the gateway declines to charge twice for
it. A key table protects your database. It has never had anything to say about
your dependency.

**Recording the response against the key is what breaks retry-after-failure.**
Every strategy with a key table loses `retry-after-decline`; the three without
one are the three that pass. Storing the answer is the mechanism the whole
pattern runs on, and storing a *failure* with it converts one declined attempt
into a key that will refuse every future retry of an operation that never
happened. The fix is not subtle — do not memoise non-success responses — and it
is left unfixed here in all five columns because it is what the implementations
in the wild do, and the row is worth more as a measurement than as a strawman.

**The outbox is 10 of 11, and its one failure is structural rather than a bug.**
`atomic-outbox` commits key, charge and intent together, so the window every
other strategy has between "the effect is durable" and "the record of it is
durable" does not exist. What it cannot do is refuse: it answers 201 from the
commit, before the gateway has been asked anything, so a decline arrives after
the client has been told it succeeded and there is no longer a request to reject
— only a compensating action somebody has to write. That is the trade, and it is
why an outbox is the wrong shape for synchronous authorisation.

**Two rows are unanimous, and both are load-bearing.** `clean` is the control:
without it a strategy that refused everything would score well. `retry-after-invalid`
is the second control, and it says that input validation — the part that is easy
— is not where any of this is decided.

### The one judgement call in the scoring

`cross-principal-key` against `memo-after` is simultaneously a lost write and a
cross-tenant leak: the second customer's charge never happens *and* they are
shown the first customer's charge id. The cell reads `wrong-response`, because
the precedence in `scoring.ts` puts misattribution above a lost write — a lost
write is an availability failure inside one tenant and a leaked charge id is a
confidentiality failure across two. Reasonable people can order those
differently; the point of saying so here is that the table should not be the
only place that severity model is recorded.

### What `key-expired` costs `lease-recovering`

`lease-recovering` is the only column that duplicates a charge *row* while
moving the money once: 2 charges, 1 gateway effect, on both `key-expired` and
`crash-after-effect`. Recovery re-runs the work, and the work is only idempotent
downstream. That is the honest shape of the design — a lease takeover is safe
exactly to the degree the work under it is repeatable, and here the gateway key
makes the money repeatable while nothing makes the row repeatable.

## Using the harness on your own handler

`runDeliveries` takes a subject and a list of deliveries. Nothing in it knows
about the eight strategies.

```ts
import { runDeliveries } from './harness.ts'
import { classify } from './scoring.ts'

const observation = await runDeliveries(
  { handle: myHandler },
  [
    { label: 'first', request: aCharge(), parkAt: 'after-effect' },
    { label: 'retry', request: aCharge() },
  ],
)

expect(classify(observation, myHazard)).toBe('safe')
```

Three things it gives you that a twice-called handler does not:

1. **Overlap.** A delivery parks at a named point and the next one runs until it
   finishes or blocks on a lock. `after-effect` is the window that matters.
2. **Death.** `crashAt` ends a delivery the way a power cut does — no unwind, no
   response, committed work kept, uncommitted work lost, locks released as a
   real database releases a dead connection's.
3. **Counting the effect rather than the response.** Two identical 200s prove
   nothing. Charges and money moved are counted separately because they fail
   separately, which is the only reason `orphaned` is visible at all.

If your design depends on a background process — an outbox consumer, a
reconciler, a sweeper — declare it as `reconcile`. The harness runs it once
after every delivery has settled. Declaring it is the honest move: a transactional
outbox is a handler *and* a consumer, and a harness that ran the consumer for
free would be scoring a system nobody deployed.

## Determinism

Every number here is byte-identical between runs, and `harness.test.ts` asserts
it over 25 repeats of the overlapping hazard. There is no timer, no sleep and no
wall clock anywhere in the directory:

- Overlap is a **named park point** released when the partner has finished or is
  observably blocked, not a delay that is usually long enough.
- Time is an injected counter (`clock.ts`). `key-expired` advances it by 90
  seconds without taking 90 seconds, and without forcing the TTL down to
  something nobody would deploy.
- Ids are a per-run sequence, so a failing cell can be diffed against a passing
  one.
- Backoff jitter is a seeded LCG, not `Math.random`.

`concurrency/README.md` argues the opposite case for its own matrix — that some
races are only reachable by scheduling many trials and reporting a detection
rate. The difference is that there the interleaving *is* the subject; here it is
a fixture, and a detection rate would only be telling you the fixture was
unreliable.

## Why the store is not a `Map`

Almost every demonstration of idempotency keys is backed by a `Map` and a
`has`/`set` pair, and every one of them is sound — because a `Map` has no
concurrency. `has` and `set` cannot be separated by anything, so the
check-then-act that is the entire bug class is unreachable and the naive
implementation passes.

`store.ts` models three things instead, each load-bearing for at least one cell:

- **Transactions**, so "the effect and the key are committed together" is a
  design somebody can implement.
- **Unique indexes that block.** A second insert of a value another open
  transaction holds *waits*, then fails if that transaction committed and
  proceeds if it rolled back. This is what Postgres does and it is the single
  mechanism that makes an atomic lease possible.
- **Crashes that release their locks.** A dead delivery's transactions are
  abandoned and its reservations freed, because a real database does that when a
  connection drops. This one was found the hard way: without it
  `crash-after-gateway` against `natural-key` deadlocks, and a harness that hangs
  there looks exactly like a flaky test with a timeout — which is how a real lock
  leak gets misdiagnosed.

Isolation levels are deliberately not modelled; `dbisolation/` is where that
question lives. Every strategy here is decided by the unique index and by
transaction boundaries, which behave the same at every isolation level Postgres
offers.

## Over a real socket

The matrix runs against handler functions, which is the right place to measure
88 cells. `server.ts` and `server.test.ts` answer the obvious objection rather
than arguing with it: the highest-stakes rows are re-run over a loopback socket
with real `Idempotency-Key` headers, real status codes and a real
`Idempotent-Replayed` header, and the same outcomes come out.

## Files

| File | What it is |
| --- | --- |
| `harness.ts` | The deliverable. Deliveries, park points, crash points, observation. |
| `store.ts` | A transactional store with blocking unique indexes and crashes. |
| `service.ts` | Eight handlers, written out rather than parameterised. |
| `gateway.ts` | The effect that is not yours to roll back. |
| `hazards.ts` | Eleven ways one request arrives more than once, each declaring its correct outcome. |
| `strategies.ts` | The eight columns: handler, client retry policy, blurb. |
| `scoring.ts` | Seven outcome words and the precedence between them. |
| `matrix.ts` | The 88-cell run. |
| `server.ts` | The `node:http` shell, kept separate so unit tests stay unit tests. |
| `clock.ts` | The injected clock and id source. |
| `fixture.ts` | A context for tests that call a handler directly. |

## When to reach for which

- You control the payload and it already contains something unique — **use the
  natural key.** It is one index and one `catch`, and it beats every key-header
  design except the outbox.
- You need a client-supplied key — **use a lease with an expiry, a stored request
  fingerprint and per-tenant scoping**, and do not memoise failures. `memo-after`
  is not a smaller version of this; it is a different thing that passes the same
  test.
- Your handler has an effect outside its database — **pass a deduplication key to
  whatever owns that effect.** Nothing you do locally reaches it.
- You can tolerate answering before the downstream has — **the outbox is the
  strongest design here**, and the reason to hesitate is that it cannot refuse.
