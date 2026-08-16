# Outside-in (London) vs classicist TDD

The same feature, built twice, held to one contract.

```bash
pnpm test tdd/schools     # both designs, their own suites, the shared contract, and the audit
```

## Why one feature, twice

Most write-ups of this argument compare a mockist example of one problem with a
classicist example of another, which makes every difference between them
unfalsifiable — the designs differ, but so do the problems. Here the feature is
specified once in [`orderContract.ts`](./orderContract.ts) as a suite that both
implementations must pass, to the cent and to the unit of stock. Whatever else
the two schools disagree about, they agree there.

The contract mentions no collaborator, class, or injection point. It knows only
what a caller can observe: the result of placing an order, the stock left
afterwards, and the charges the payment provider accepted. Everything the two
schools argue about happens between those observations, so a contract that
named any of it would be scoring the match for one side.

## The feature

Place an order in a small shop. Price the lines against a catalogue, apply an
optional whole-percent promo code that can expire, reserve the stock, charge
the customer, and confirm with an order number. Reject — with a reason, and
without leaving stock held or money taken — for an empty order, a nonsense
quantity, an unknown sku, insufficient stock, a dead promo code, or a declined
card. Discounts apply to the order total and round half up.

It is deliberately the shape of feature where the schools actually diverge:
several collaborators, one real external boundary, an unwind path, and a piece
of arithmetic with an edge to it.

## The two designs

### [`london/`](./london) — outside-in, mockist

Written from the outermost test inwards. The first test asked for an order to
be placed and had nothing to place it with, so a collaborator was invented and
immediately mocked; the next question invented the next one. The result is an
orchestrator over six ports — `catalogue`, `promotions`, `inventory`,
`payments`, `orderIds`, `clock` — and **no implementation of any of them**.
The suite substitutes 6 collaborators, which is all of them.

`placeOrder.test.ts` barely mentions what an order costs. It says what was said
to whom, in what order: that pricing finishes before stock is touched, that
money is taken only once the goods are held, that a declined card hands back
exactly the reservations that were taken and no more.

### [`classicist/`](./classicist) — inside-out, state-based

Written from the pieces that can be judged on their own. `Money` came first,
then `Catalogue` and `Promotions`, then the `Inventory` ledger, then pricing,
and the feature was assembled last out of things that were already correct. The
suite substitutes 1 collaborator: `payments`, because on the other side of it
is a third party over a network. The other four collaborators are the
production classes, constructed with test data — a `Catalogue` with two prices
in it is still a `Catalogue`, and an `orderIds` counter that yields `ORD-1` is
the same class production would use.

`placeOrder.test.ts` never mentions a call, an order of calls, or a number of
calls. It asks what the order cost, what stock is left, and what the gateway is
holding.

## What each one catches that the other cannot

This is the part worth reading, and both directions are real.

**Only the London suite can state a protocol.** "Reserve the stock before you
charge the card" is a claim about order of operations. A final snapshot of
stock and charges cannot distinguish it from charging first and reserving
after — both end in the same state when everything works, and differ only in
what a crash halfway through leaves behind. `london/placeOrder.test.ts` pins it
with `invocationCallOrder`; the classicist suite has nothing to say about it.

**Only the classicist suite can state an invariant.** "Never oversell, never
half-reserve" is a claim about a real ledger. `inventory.test.ts` proves that
two lines of the same sku are one claim on one pile of stock — that an order
for 2 + 2 of the last 3 is refused outright. In the London design, `Inventory`
is an interface nobody has implemented, so that rule has no home and no test.
The same goes for promo expiry: `catalogue.test.ts` pins the exact instant a
promo dies, while a mocked `promotions` port returns whatever the orchestrator's
test asked for, at any instant.

Notice what those two paragraphs have in common: **each suite is silent
precisely where its design has no code**. The London design has no domain
objects, so its tests cannot check domain rules. The classicist design has no
protocol layer worth isolating, so its tests cannot check sequencing.

## The trade, stated plainly

| | London (outside-in) | Classicist (inside-out) |
|---|---|---|
| Substituted collaborators | 6 of 6 | 1 of 5 (`payments`) |
| A failing test tells you | which unit broke | that *something* under here broke |
| Tests are coupled to | the protocol between objects | observable behaviour |
| Survives an internal refactor | rarely | usually |
| Design pressure applied to | interfaces, early | domain objects, early |
| Feedback on the whole feature | at the start | at the end |
| Left owing at the end | six unwritten implementations | nothing |
| Test data setup | per-test, tiny | real objects, larger |

Two entries deserve their evidence rather than your trust:

*Survives an internal refactor.* Suppose promo lookup moves into the catalogue —
one collaborator instead of two, no behaviour change. On the classicist side,
`placeOrder.test.ts` does not change at all; `catalogue.test.ts` absorbs the
promo cases and the contract still passes untouched. On the London side, the
`promotions` port disappears, so every test that constructs the doubles changes,
and the three that assert on `discountFor` are rewritten or deleted. Neither
suite caught a bug, because there was no bug — but one of them charged you for
the refactor.

*A failing test tells you which unit broke.* Break `Money.discountedBy` and the
classicist side lights up in four places: `money.test.ts`, `order.test.ts`,
`placeOrder.test.ts`, and the contract. Only the first names the culprit. The
London orchestrator has no arithmetic to break, and its one test that would
notice — the total passed to `charge` — points straight at the line that is
wrong. That is the mockist trade working as advertised: redundancy is the price
the classicist pays for refactorability.

## When to use which

**Reach for outside-in / mockist when:**

- the unit's job *is* coordination — sagas, workflows, orchestrators, anything
  whose whole value is calling other things in the right order with the right
  unwind path;
- the collaborators do not exist yet, or belong to another team, and you want
  the interface pressure now rather than after they ship;
- the real collaborator is slow, remote, or non-deterministic and a fake would
  be a research project;
- you need the failure to name a file, because the system is large and "some
  test in the checkout area is red" is not a diagnosis.

**Reach for classicist / state-based when:**

- there is a domain worth modelling — money, dates, stock, tax, scheduling —
  where the rules have edges and the edges want their own tests;
- the collaborators are cheap and deterministic in memory, which is most of
  them, most of the time;
- the code will be refactored more often than it is rewritten, and you would
  rather not pay a test-suite tax each time;
- the team is arguing about mock setup more than about behaviour, which is the
  usual first symptom of over-substitution.

**In practice, most codebases want both** — including this one. The honest
default: state-based tests for anything with a domain in it, interaction tests
where the *protocol itself* is the requirement, and a contract suite over the
feature so the two never drift apart. That is exactly the shape of this folder.

## What is checked rather than claimed

[`design.test.ts`](./design.test.ts) derives the structural claims above from
the code that actually runs the contract, and fails `pnpm test` if they stop
being true:

- the London entry point exports an orchestrator and nothing else — every
  collaborator really is an interface with no implementation;
- its declared seam list matches the keys of the wiring the contract runs, and
  none of those objects is a production class borrowed from the other folder;
- the classicist wiring's only test double is `payments`, derived by checking
  every other collaborator is an instance of a class the design ships;
- this README names every seam and quotes both counts.

The last one exists because the numbers in the table above are the argument. If
a seventh port appeared in the London design, the sentence claiming six would
be wrong, and a wrong sentence in a README is invisible. Here it is a red test.

## Files

| File | What it is |
|---|---|
| `orderContract.ts` | the feature, specified once, as a reusable suite |
| `orderContract.test.ts` | that suite, run against both designs |
| `london/placeOrder.ts` | six ports and an orchestrator, no implementations |
| `london/placeOrder.test.ts` | mockist suite: call order, call counts, arguments |
| `london/world.ts` | stubs written to stand the design up for the contract |
| `classicist/money.ts` | value object; integer cents, half-up discounts |
| `classicist/catalogue.ts` | real `Catalogue` and `Promotions`, with an expiry rule |
| `classicist/inventory.ts` | real ledger; all-or-nothing reservation |
| `classicist/order.ts` | pricing and command validation, as pure functions |
| `classicist/orderIds.ts` | real sequential order numbers |
| `classicist/placeOrder.ts` | the feature, assembled from things already tested |
| `classicist/fakePaymentGateway.ts` | the one double: a fake, not a mock |
| `classicist/world.ts` | production classes plus the fake, wired for the contract |
| `design.test.ts` | the audit that keeps this README honest |
