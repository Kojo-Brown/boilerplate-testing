# Characterisation tests

Pinning what inherited code *does*, before changing how it does it — and
measuring what the pins would actually have caught.

```bash
pnpm test tdd/characterisation     # the pins, the divergences, the refactor, the matrix
pnpm characterise:record           # re-record the golden master (read record.ts first)
```

## The situation

[`legacy/renewal.ts`](./legacy/renewal.ts) calculates subscription renewal
invoices. It has been in production for three years, it is eighty lines of
running total, and it is about to be changed. There are no tests. There is
[`requirements.md`](./requirements.md), which is three years old and wrong in
five places.

This is the ordinary case, and the ordinary mistake is to start by writing
tests from the documentation. That produces a suite which describes the system
somebody intended, run against a system that has since drifted — so it goes red
in a handful of places, and the natural next move is to fix the code, at which
point a refactoring task has silently become a billing change.

A characterisation test does the opposite. It asserts that behaviour has not
changed, and says nothing at all about whether the behaviour is right. That
distinction is the whole technique, and the reason `tdd/README.md` gives the
cycle a fourth phase — `pin` — rather than pretending such a test can be red
first.

## What it costs to skip this

The three suites below were run against ten single behaviour changes applied to
the real legacy source — the sort of change a competent engineer makes while
tidying, and **six of the ten are the code being brought into line with its own
documentation**. Every one of them would pass code review.

| Change | Documentation says so | Specification suite | Golden master, invoice only | Golden master, everything |
|--------|:---:|:---:|:---:|:---:|
| the large-volume tier starts at 100 seats rather than above it | yes | · | ✓ | ✓ |
| volume and loyalty discounts are added together and applied once | yes | · | ✓ | ✓ |
| the coupon is applied first and the account credit deducted afterwards | yes | · | ✓ | ✓ |
| tax is rounded to the nearest cent instead of truncated | no | ✓ | ✓ | ✓ |
| an invoice total can no longer be negative | yes | · | ✓ | ✓ |
| the function stops writing the billing date onto its argument | no | · | · | ✓ |
| coupon codes are matched without regard to case | no | · | ✓ | ✓ |
| the grandfathering cut-off compares parsed dates rather than strings | yes | · | ✓ | ✓ |
| an empty coupon code is reported as unrecognised instead of ignored | no | · | · | ✓ |
| a renewal dated in the future bills in full instead of prorating below zero | yes | · | ✓ | ✓ |
| **stopped** | | **1 / 10** | **8 / 10** | **10 / 10** |

The matrix is derived by [`detection.test.ts`](./detection.test.ts), which
compiles each mutant from the source file and runs every suite against it.
Nothing in the table is believed on the strength of sounding right, and the
control — the same source compiled through the same pipeline with no edits —
is checked first, because a pipeline that changed behaviour by itself would
make every column look perfect.

Three things in that table are worth more than the totals.

**The specification suite is not lazy.** It is 18 behaviours read carefully out
of the documentation, it passes, and it would sail through review. It stops one
change in ten because it pins what somebody decided, and nine of these ten
changes are in the space nobody has decided about.

**Its one catch is an accident.** `requirements.md` states a tax rate and says
nothing about rounding. But asserting on a worked example means writing down a
number, and 7.25% of 90 is 6.525, so the assertion had to choose. It chose
what the code does, and pinned the truncation without anybody deciding to. That
is where specification suites get their real coverage: wherever their examples
happen to land.

**The last two columns differ only in where they look.** Same 128 cases, same
recording, same comparison — one watches the returned invoice and the other
also watches the object that was passed in and the service log. Two of the ten
changes are invisible to the first, and one of those two is a function quietly
losing a side effect that four callers depend on. Choosing what counts as
"the behaviour" is a bigger decision than choosing how many cases to record.

## How it was built

### 1. Break the smallest dependencies you can, first

Nothing can be recorded while a call is unrepeatable, and this one called
`new Date()` and `Math.random()` in its body. So the first edit — made with no
safety net, because there could not be one yet — added an `ambient` parameter
defaulted to exactly the three things the body used to do inline.

| Seam | Was inlined as | Without it |
|------|----------------|------------|
| `now` | `new Date()` | proration and the billing date move every day the suite runs |
| `random` | `Math.random()` | the audit flag disagrees with itself between two runs of the same case |
| `warn` | `console.warn` | half the behaviour goes to a stream nothing is watching |
| `trace` | nothing — added as a sensor | no way to state which branches the corpus reaches |

An edit in that position can only be defended by keeping it small enough that
its correctness is one claim, and then testing that claim head-on:
[`seams.test.ts`](./seams.test.ts) substitutes the globals themselves, calls
with one argument the way production does, and checks that the substitutions
were seen. Those are the only tests here that stub a global rather than pass a
stub in, and they are what makes the default value in the signature believable.

### 2. Build the corpus, and be able to say why it is adequate

[`corpus.ts`](./corpus.ts) generates 128 cases in three layers: a base case,
every interesting value of every dimension varied one at a time against it, and
a seeded pseudo-random tail over the full cross product. OFAT is cheap and
makes a missing value obvious; it also sees no interactions whatsoever, which
is what the tail is for — the bugs that survive a refactor are nearly always a
coupon *and* a credit, or a future renewal date *and* a currency with no tax
rate.

"Interesting value" means a boundary, the value either side of it, a legal
absence, and something malformed that a real caller has actually sent. The seat
list is 0, 1, 25, 26, 100, 101, 500 because the code branches at 25 and 100,
and a corpus sampling 10 and 200 would pin both discount tiers while pinning
neither edge.

Adequacy is then stated rather than hoped for. The function reports the branch
it takes through the sensing seam, and [`corpus.test.ts`](./corpus.test.ts)
closes a loop between two claims: every one of the 21 branches in the source is
declared, and every declared branch is reached by at least one case. Neither
can be satisfied by editing the other, because one side is read out of the
source text. It is statement coverage and nothing stronger — no claim at all
about interactions between branches — which is why the mutation matrix above is
the sharper question.

### 3. Record, and make the recording hard to launder

[`golden-master.json`](./golden-master.json) holds, per case, the returned
invoice, the customer object *after* the call, the lines written to the log,
and the branch path. It is a committed file produced by
[`record.ts`](./record.ts), not a snapshot the runner will rewrite for you, and
the difference is the point: a recording that refreshes when the suite goes red
is a very slow way of asserting that the code equals itself. `--update` in easy
reach is exactly how snapshot suites stop being tests, and a characterisation
suite has no other job.

The file carries a fingerprint over every input of every case. That closes the
one dishonest move the arrangement is otherwise open to — deleting the cases a
change happens to break and re-approving the rest — because shrinking the
corpus moves the fingerprint and fails
[`goldenMaster.test.ts`](./goldenMaster.test.ts) until somebody re-records on
purpose.

One limitation is admitted rather than hidden. JSON cannot write down negative
zero, and a zero-seat account renewed against a future date produces one, so
[`observe.ts`](./observe.ts) normalises `-0` to `0` at the boundary and states
the cost: these pins do not distinguish them. For money that is right —
`(-0).toFixed(2)` is `'0.00'`, so no invoice can tell either — and for a
subject where `1 / x` mattered it would be wrong, and the format would have to
change. Choosing the recording format chooses what the pins can see.

### 4. Only then, refactor

[`refactored.ts`](./refactored.ts) is the same invoicing as eight named steps
instead of one running total.
[`equivalence.test.ts`](./equivalence.test.ts) compares it to the legacy
implementation over every case and every visible effect, and then compares it
to the recording taken before any of this started. Both are worth having: the
first catches a refactor that drifted, the second catches the subtler accident
of a change made to *both* files at once, agreeing with itself and nothing
else.

The branch path is excluded from that comparison, and the exclusion is the
point rather than a loophole — a `find` over a tier table does not take the
same path as an if/else ladder, and a check that demanded it would forbid the
change the pins exist to permit. Behaviour is held fixed; structure is what is
being changed.

Every quirk survives the refactor on purpose. The tiers are still exclusive,
loyalty still compounds, the credit still comes off before the coupon, the
total can still go negative, grandfathering still compares ISO dates as
strings, and tax is still truncated. A refactoring commit that fixed any of
those would be a behaviour change wearing a refactor's clothes, and the pins
are only trustworthy as a safety net because they are never edited in the same
breath as the code.

## The five divergences

Found by writing the documentation's own claims as tests and watching them go
red. [`divergences.ts`](./divergences.ts) records each one as something that
runs — what the sentence implies, what the code produces, and a probe that
produces it — so a disagreement that later gets fixed fails a test rather than
rotting into a wrong paragraph.

| Documented | Actually | Probe |
|------------|----------|-------|
| Accounts with 100 seats or more receive 15%. | the tiers are exclusive, so exactly 100 seats gets the 7% tier | 837, not 765 |
| Volume and loyalty discounts are added together and applied once. | loyalty is applied to the already volume-discounted figure, so the two compound | 3633.75, not 3600 |
| The coupon is applied to the discounted amount, and any account credit is deducted from the result. | the credit is deducted first, so a percentage coupon discounts the smaller figure | 36, not 31 |
| An invoice total is never negative; unused credit is carried forward. | the credit runs the total below zero, and tax is charged on the negative figure | −43.97, not 0 |
| Accounts created before 1 January 2019 keep their original price. | the cut-off compares dates as strings, so any non-ISO date sorts below it and is grandfathered | 190, not 290 |

Three of the five bill *more* than the documentation promises and two bill
less, which is why "just make it match the docs" is not available: three of
those fixes are refunds and two are price rises, and both kinds reach a
customer. What the exercise produces is not a decision about any of them. It is
five decisions somebody can now take one at a time, each with a test that will
say exactly who it moves — and that list is worth more than the tidier code is.

## When to use this

Reach for a characterisation suite when **you need to change code whose
behaviour nobody can currently state**, and the cost of an unnoticed change is
higher than the cost of recording a few hundred cases. Billing, pricing,
permissions, anything that has been running long enough to have customers
depending on its accidents.

Do not reach for it when you are writing new code — pinning behaviour you chose
five minutes ago is a snapshot test with extra ceremony, and it will be right
about a design you have not finished having opinions about. Do not use it as a
permanent test suite either. It is scaffolding: once the behaviour is
understood and the important parts have real specification tests written
deliberately, most of the corpus can go. Keeping 128 recorded cases forever
means every intentional change comes with a 128-line diff nobody reads
carefully, which is the failure mode this whole arrangement exists to avoid.

The order matters more than any of the machinery. Pin, then refactor, then
change behaviour — in three separate commits, so that exactly one of them is
ever the one that changed what customers see.
