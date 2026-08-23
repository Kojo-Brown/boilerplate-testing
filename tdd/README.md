# TDD katas

Three worked katas, each built one red/green/refactor step at a time, with the
step log recorded as checked data rather than prose.

```bash
pnpm test tdd/katas tdd/steps   # the katas plus the audit of their step logs
pnpm test tdd                   # the above, and everything else under tdd/
```

For the other half of the discipline — *which* tests to write, rather than in
what order — see [`schools/`](./schools), which builds one feature twice,
outside-in and classicist, and holds both to a shared contract, and
[`doubles/`](./doubles), which compares the five kinds of test double on one
feature and measures what each kind can actually catch.

For the case where the code got there first, see
[`characterisation/`](./characterisation): pinning inherited behaviour before
refactoring it, at the scale the Gilded Rose is too small to need — a generated
corpus, a recorded golden master, and a mutation matrix putting a number on
what the pins would have caught.

## When to use this

Reach for these when you want to **practise or demonstrate the cycle itself**,
not when you want a reference implementation of FizzBuzz. The finished code in
each kata is deliberately unremarkable — four lines of FizzBuzz teach nobody
anything. What is worth reading is the order the code arrived in, and the
reasons recorded against each step.

Useful for onboarding ("this is the granularity we mean by TDD here"), for
pairing warm-ups, and as a reference when arguing about how small a step should
be. Not useful as a library: nothing here is meant to be imported by an
application.

## The cycle, and the fourth phase

| Phase | What it does | May add tests |
|-------|--------------|---------------|
| `red` | Write a test that fails, for a reason you predicted | yes |
| `green` | Write the smallest production change that passes it | no |
| `refactor` | Improve the design without changing behaviour | no |
| `pin` | Characterise behaviour that already exists | yes |

`pin` is the one addition to the classic three, and the Gilded Rose is why. It
starts from inherited code that already works, and there is no honest way to
make a description of existing behaviour fail. Calling those tests `red` would
be a lie; calling them `green` would imply production code was written to
satisfy them. They are a survey. A `pin` step may only appear *before* the
first `red` — you pin behaviour before you change it, never after, because a
characterisation test written after a change pins the change.

The Gilded Rose pins by hand: ten examples chosen by eye, which is the right
size for fifty lines of inherited code you can hold in your head.
[`characterisation/`](./characterisation) is the same move when you cannot —
the corpus is generated, the expectations are recorded rather than written, and
the question of whether the pins are any good is answered by measurement rather
than by reading them.

## The rules the audit enforces

`steps.ts` holds the validators and `katas.test.ts` runs them on every
`pnpm test`. A step log that describes an undisciplined sequence fails the
build rather than being quietly believed:

- a kata opens on a `red` or a `pin`, and never ends on an unanswered `red`;
- every `green` is immediately preceded by the `red` it answers;
- every `refactor` follows a `green` or another `refactor`, so it is always
  performed on a passing suite;
- `pin` steps appear only before the first `red`;
- only `red` and `pin` steps introduce tests, and they must introduce at least
  one;
- every test title claimed by a step exists in that kata's suite on disk, and
  every test on disk is claimed by exactly one step;
- every step names a commit and explains itself, and no two steps claim the
  same commit;
- this README mentions every commit in the log.

The last two rules are what keep the record from rotting. A copy of a history
is a comment, and comments rot; these ones fail `pnpm test` instead.

## Why the history is also stored as data

The real record is the commits on the pull request branch — 29 of them, one per
step, each verified to be the colour it claims by running the suite before it
was committed. This repository squash-merges, so on `main` those 29 commits are
one. The branch history survives on the pull request page, but nothing in the
repository would point at it, and nothing would notice if the code drifted away
from what it described.

So the log is also `katas.ts`, checked against the suites on disk. The
alternative — merging the katas without squashing — would put 29 commits on
`main` for one spec item and make the branch history load-bearing for anyone
reading `git log`. Storing it as data is the cheaper half of that trade, and it
is the half a test can defend.

## The katas

### FizzBuzz

**Teaches:** triangulation, and refactoring when a branch ladder stops paying
for itself.

The first green is a hardcoded `'1'`, which survives exactly one more test.
That is the point: faking it makes the *next* test do real work, and step 3 —
the second example, the one people skip — is what forces the constant to become
a rule. The ladder of early returns grows to four branches before step 11
replaces it with a table of rules, at which point `"FizzBuzz"` stops being a
special case and becomes what falls out when both rules match.

#### FizzBuzz

| # | Phase | Commit | Why |
|---|-------|--------|-----|
| 1 | red | `test(tdd): red — fizzBuzz returns "1" for 1` | The first test buys the API, not the algorithm. Red because the module does not exist. |
| 2 | green | `feat(tdd): green — return the literal "1"` | Faking it. A constant is the smallest thing that passes, and it makes the next test do real work. |
| 3 | red | `test(tdd): red — fizzBuzz returns "2" for 2` | Triangulation: a second example is what forces the constant to become a rule. |
| 4 | green | `feat(tdd): green — stringify the number` | The constant collapses into the general rule under the weight of two examples. |
| 5 | red | `test(tdd): red — fizzBuzz returns "Fizz" for 3` | First rule that is not the identity. Asserting on 3, not 6, keeps the failure unambiguous. |
| 6 | green | `feat(tdd): green — Fizz on multiples of three` | One branch. Writing the Buzz branch here would be speculation with nothing to check it. |
| 7 | red | `test(tdd): red — fizzBuzz returns "Buzz" for 5` | The symmetric rule, failing for the expected reason. |
| 8 | green | `feat(tdd): green — Buzz on multiples of five` | Repetition twice is not yet duplication worth naming; the refactor waits for a third case. |
| 9 | red | `test(tdd): red — fizzBuzz returns "FizzBuzz" for 15` | The case the early-return shape gets wrong: 15 matches the first branch and returns "Fizz". |
| 10 | green | `feat(tdd): green — FizzBuzz on multiples of both` | Green by the cheapest route, and the least satisfying design in the kata — which is the pressure for the next step. |
| 11 | refactor | `refactor(tdd): replace the branch ladder with a rules table` | Four branches become a table plus a fold. The combination case disappears rather than being handled. |
| 12 | red | `test(tdd): red — fizzBuzzUpTo lists the first fifteen answers` | The sequence is a separate responsibility. The expected array is written out rather than generated. |
| 13 | green | `feat(tdd): green — fizzBuzzUpTo maps the range` | Composition, not a second algorithm: no new branches, because the mapping was already covered. |

### Bowling Game

**Teaches:** choosing examples so that a failure has exactly one explanation.

Every test is a whole game with one interesting thing in it and gutters
everywhere else. That is not laziness — a realistic mixed game would fail just
as loudly and tell you far less. The pivot is step 7, where a strike breaks the
two-rolls-per-frame assumption in both directions at once: the bonus is short
*and* the frame boundaries drift. A perfect game scoring 120 instead of 300 is
what makes the second failure legible, which is why both tests belong in one
red step.

#### Bowling Game

| # | Phase | Commit | Why |
|---|-------|--------|-----|
| 1 | red | `test(tdd): red — a gutter game scores 0` | The degenerate case, where roll()/score() gets chosen over score(rolls). |
| 2 | green | `feat(tdd): green — an empty game that always scores 0` | roll() discards its argument and score() returns a constant. Honest for one example. |
| 3 | red | `test(tdd): red — a game of all ones scores 20` | The most behaviour that can be described without mentioning frames at all. |
| 4 | green | `feat(tdd): green — remember the rolls and sum them` | The constant becomes a sum. Inventing the frame loop here would be untested code on a hunch. |
| 5 | red | `test(tdd): red — a spare adds the next roll as a bonus` | One spare in a known position, the rest gutters: the failure can only be about spares. |
| 6 | green | `feat(tdd): green — walk ten frames and pay the spare bonus` | The sum becomes a frame walk, still assuming frames are two rolls wide. |
| 7 | red | `test(tdd): red — a strike takes one roll and pays two` | Two tests in one step: they fail for the same single reason, and 120-instead-of-300 is what makes the frame drift obvious. |
| 8 | green | `feat(tdd): green — a strike consumes one roll, not two` | Advancing the cursor by one fixes the bonus and the frame boundaries together. The tenth frame needs no special case. |
| 9 | refactor | `refactor(tdd): name the frame rules` | Five arithmetic expressions become named predicates, and score() reads as the scoring rules. |

### Gilded Rose

**Teaches:** pinning inherited behaviour before changing it, and refactoring
only once a green suite makes it safe.

The starting position is the original tangle — nested negations, repeated
string literals, quality clamped in four places — and it is left exactly that
awful on purpose. Step 1 fences it in. Step 3 then adds conjured items as a
guard clause *in front of* the legacy ladder rather than editing it, because
that ladder is still the only description of the old behaviour; the whole thing
is rewritten in step 4 with ten tests watching.

Two details are worth stealing. The step-4 rewrite is only equivalent because
the pin tests fixed the corners: the backstage thresholds read the sell-by date
before it is decremented (so 11 and 6, not 10 and 5), Sulfuras sits at 80 above
the quality cap and must not be clamped, and clamping once at the end matches
clamping per increment only because the deltas never change sign within an
update. And step 4 deliberately leaves conjured decay wrong — flat, rather than
doubling past the sell-by date — because no test asks for that yet, and a
refactor commit is the wrong place to change behaviour. It is the next red.

The payoff is step 7: three updaters that differed only by a number collapse
into `perishable(rate)`, which makes Aged Brie ripening and a vest rotting the
same function with opposite signs. That abstraction was not available in step 4
and would have been wrong if guessed at — the argument for keeping refactor
steps separate from the greens that precede them.

#### Gilded Rose

| # | Phase | Commit | Why |
|---|-------|--------|-----|
| 1 | pin | `test(tdd): pin — characterise the legacy Gilded Rose` | Green on the first run by construction: a survey of inherited behaviour, not a specification. Everything after this is only safe because of it. |
| 2 | red | `test(tdd): red — a conjured item degrades twice as fast` | The new requirement, and the first test here allowed to fail: conjured items fall through to the normal branch. |
| 3 | green | `feat(tdd): green — conjured items lose two a day` | A guard clause in front of the legacy ladder — the smallest edit that touches no line the pin tests are watching. |
| 4 | refactor | `refactor(tdd): look the ageing rule up by name` | The ladder becomes a table, equivalent only because of details the pin tests fixed: the 11/6 thresholds, Sulfuras above the cap, clamping at the end rather than per increment. |
| 5 | red | `test(tdd): red — a conjured item degrades by four past its date` | Twice as perishable as a normal item, which already doubles past its date. The step-3 guard never modelled that. |
| 6 | green | `feat(tdd): green — conjured decay doubles past the sell-by date` | One ternary in the one place that owns conjured items — what the previous refactor bought. |
| 7 | refactor | `refactor(tdd): three ageing rules are one rule with a rate` | The duplication was not extractable in step 4; it only became true once step 6 gave conjured the same doubling the others had. |

## Adding a kata

1. Work it in real red/green/refactor commits. Run the suite at every step and
   check the colour is the one you expected — a red that fails for the wrong
   reason is worth more attention than a green.
2. Add a `Kata` entry to `katas.ts` with one `Step` per commit.
3. Add a section and a step table here, and the shape to the phase-sequence
   assertion in `katas.test.ts`.
4. `pnpm test tdd` will tell you if the log and the code disagree.
