# Test doubles: dummy, stub, spy, mock, fake

Five kinds, one feature, and a matrix showing what each one can actually catch.

```bash
pnpm test tdd/doubles     # the five kinds, the store contract, and the detection matrix
```

## Why one feature

Most taxonomies of test doubles are five snippets from five different
programs, which teaches five libraries and nothing about the choice between
them: no snippet is ever a live alternative to another. Here there is one use
case — [`registerUser.ts`](./registerUser.ts) — with four collaborators, and
every kind is demonstrated against it, so "use a stub here" is always a claim
about a decision somebody could have made differently.

The vocabulary is Meszaros' (*xUnit Test Patterns*), which is also the one
Fowler uses in *Mocks Aren't Stubs*. **Test double** is the family name;
dummy, stub, spy, mock and fake are the five members.

## The feature and its seams

Register a user: reject a malformed address, reject one already taken, ask the
seat policy what the plan allows, persist the record, send a welcome email,
and — only when an admin registered somebody else — write an audit entry.

| Seam | Collaborator | Demonstrated as |
|------|--------------|-----------------|
| `users` | the user store | fake |
| `seats` | the seat policy | stub |
| `mailer` | outbound email | spy, then mock |
| `audit` | the audit log | dummy |

`mailer` appears twice on purpose. **A double's kind is a property of how a
test uses it, not of the object** — the same recording mailer is a spy when
the test asserts on it afterwards and a mock when it carries the expectation
itself. `dummy.ts` makes the same point from the other side: the audit log is
a dummy on the self-service path and a spy on the admin path, in the same file.

## The five kinds

### Dummy

Fills a required parameter on a path that must never use it.

Written passively (methods that do nothing) it is untestable scenery. Written
as a landmine — [`LandmineAuditLog`](./dummy.ts), methods that throw — the
claim "this path does not audit" becomes executable, and `dummy.test.ts` runs
both versions against the same bug to show the passive one staying green.

### Stub

Hands back a canned answer the system would otherwise go and fetch.

[`StubSeatPolicy`](./stub.ts) is a lookup table and nothing more. The test
asserts on what the system *did with* the answer, never on the stub. Give the
stub two different answers, as `probes.ts` does, and a system that hard-codes
the seat limit has nowhere to hide; give it one, and it agrees with the bug.

### Spy

Records the calls it receives; the test asserts on them afterwards.

[`SpyMailer`](./spy.ts) keeps a typed log. Everything else is ordinary: it
answers like a stub and has no opinion about being called. The consequence is
its defining trade — a spy is exactly as strict as the assertions written
against it, and silent about every interaction nobody asked about.

### Mock

Carries the expected conversation up front and fails on any departure.

[`MockMailer`](./mock.ts) is constructed with the calls it expects, fails at
the moment reality diverges, and `verify()` reports the calls that never came —
plus any failure the system under test swallowed in a `catch`. A mock-based
test that forgets `verify()` is not really using a mock.

### Fake

A working implementation with a shortcut inside — a Map, not a database.

[`InMemoryUserStore`](./fake.ts) enforces the real rules: normalised
addresses, one record per mailbox, no aliasing of the caller's object. That
makes it the only kind that can be *wrong the way implementations are wrong*,
so it is held to [`userStoreContract.ts`](./userStoreContract.ts) — the same
suite a Prisma or Postgres adapter would have to pass. `fake.test.ts` runs
that contract against a store with one rule dropped, to show it has teeth.

## When to use which

| Kind | Seam here | Reach for it when | Stop when |
|------|-----------|-------------------|-----------|
| **Dummy** | `audit` | the collaborator is irrelevant to the path under test | the path does use it — then the question is a spy or a mock |
| **Stub** | `seats` | the system needs an input and the assertion is about what it did with it | the stub starts branching on its arguments — that is a fake trying to be born |
| **Spy** | `mailer` | the effect you care about is a call that leaves no state behind | the effect is observable as state — assert the state instead |
| **Mock** | `mailer` | the protocol is the requirement: which calls, with what, in what order | the calls are an implementation detail you expect to change |
| **Fake** | `users` | the test needs the collaborator to really behave: remember, reject, run out | nothing holds it to the real implementation’s contract |

The default, when more than one would work: assert on state with a fake, and
reach for an interaction double only when the effect leaves no state to assert
on — an email, a charge, a published event. Every interaction assertion is a
sentence about *how* the code works, and those are the sentences that have to
be rewritten when the code is refactored without changing what it does.

## What each kind actually catches

[`faults.ts`](./faults.ts) injects five bugs, one at a time.
[`detection.test.ts`](./detection.test.ts) runs all five probes against all
five broken systems and asserts this table. It is derived by running them, not
by reasoning about them.

| Fault | dummy | stub | spy | mock | fake |
|-------|-------|------|-----|------|------|
| `SILENT_WELCOME` — the welcome email is never sent | · | · | ✓ | ✓ | · |
| `NUDGES_AT_REGISTRATION` — a second, unasked-for email goes out with the welcome | · | · | · | ✓ | · |
| `IGNORES_SEAT_POLICY` — every plan gets the same hard-coded seat limit | · | ✓ | · | · | · |
| `FORGETS_TO_PERSIST` — the user is welcomed but never written to the store | · | · | · | · | ✓ |
| `AUDITS_EVERY_REGISTRATION` — self-service signups are written to the audit log too | ✓ | · | · | · | · |

Four things this table is saying:

1. **Each kind is blind in a different direction.** The fake sees a lost
   signup and not a lost email; the spy sees the lost email and not the lost
   signup. Neither is the better double; they are answers to different
   questions.
2. **The mock strictly dominates the spy here** — it catches the unasked-for
   email as well, because it rules out calls nobody wrote an assertion for.
   That is a fact about detection power only. The same strictness fails the
   day somebody adds a second, perfectly correct email, which is why a suite
   made mostly of mocks calcifies. Detection power is not the only axis.
3. **A spy catches the extra call the moment you assert the silence** —
   `expect(mailer.nudges).toEqual([])`. The point of the row is that somebody
   has to think of writing it.
4. **Only a landmine dummy sees the fifth row.** No other kind is looking at
   the audit log on that path, so a passive dummy leaves the fault uncovered
   by the whole suite.

## Notes from practice

- **`vi.fn()` is the right reach in a real suite.** The doubles here are
  hand-written so their types are visible and the assertions read as domain
  facts (`mailer.welcomes`) rather than argument indexing. In application code
  `vi.fn()`, `vi.spyOn()` and `mockResolvedValue` are shorter and everyone
  knows them. Nothing about the taxonomy changes: `vi.fn()` with
  `mockResolvedValue` is a stub, and the same object becomes a spy the moment
  a test asserts `toHaveBeenCalledWith`.
- **Fakes are the only kind you must maintain.** Budget for the contract suite
  before choosing one; a fake nobody holds to the real implementation is a
  second source of truth that always eventually disagrees.
- **Doubles are for collaborators you own or must not touch** — the network,
  the clock, the payment provider, the outbox. Doubling a value object or a
  pure function buys nothing and costs a coupling.
- **If a test needs more than about three doubles to stand up**, the design is
  usually telling you the unit is too big, not that the test needs more
  scaffolding.

## Files

| File | What it is |
|------|------------|
| [`registerUser.ts`](./registerUser.ts) | the feature: four ports and a use case |
| [`dummy.ts`](./dummy.ts) [`stub.ts`](./stub.ts) [`spy.ts`](./spy.ts) [`mock.ts`](./mock.ts) [`fake.ts`](./fake.ts) | one kind per file |
| [`world.ts`](./world.ts) | the inert collaborators every test starts from |
| [`probes.ts`](./probes.ts) | one test per kind, written the way that kind is meant to be used |
| [`faults.ts`](./faults.ts) | five injected bugs |
| [`taxonomy.ts`](./taxonomy.ts) | the taxonomy and the detection matrix, as data |
| [`taxonomy.test.ts`](./taxonomy.test.ts) | checks this README against that data |
| [`userStoreContract.ts`](./userStoreContract.ts) | the contract the fake is held to |
