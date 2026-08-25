# Test suite shape: the pyramid vs the honeycomb

A ratio policy, derived from the code rather than declared over it, and enforced
in CI.

```bash
pnpm shape:check
```

---

## The two shapes

Both are claims about how a suite's tests should be distributed across layers.
They are usually drawn as pictures and quoted as percentages, but the
percentages are the least interesting part — they disagree about something
substantive.

| | **Test pyramid** | **Testing honeycomb** |
|---|---|---|
| Origin | Mike Cohn, Succeeding with Agile (2009); popularised by Martin Fowler (2012) | Spotify Engineering, "Testing of Microservices" (2018) |
| Claim | Most tests should be unit tests; each wider layer is smaller than the one below | Integration tests should dominate; both the unit layer and the fully integrated layer are thin |
| Typical bands | 60–85% unit / 10–30% integration / 1–10% e2e | 5–30% unit / 50–80% integration / 2–15% e2e |
| Assumes | Behaviour is decided inside units, so most value is reachable without crossing a boundary | Behaviour only exists once components are connected, so a unit test of a delegating class tests the delegation |

The pyramid's argument is about cost. Wide tests are slower, fail for reasons
that are not the defect, and localise badly, so a behaviour you can decide
without crossing a boundary is cheaper to decide there for the life of the code.

The honeycomb's argument is about where the behaviour *is*. In a service whose
job is to move data between a transport, a store and three other services, a
unit test of the class in the middle asserts the delegation — which is the part
refactoring changes and the part users never see.

Neither is right in general. They are answers to "where does the cheapest useful
test live in *this* system", and that has different answers for a domain model
and for an adapter.

**The real claim each shape makes is an ordering, not a percentage.** A pyramid
says `unit > integration > e2e`. A honeycomb says `integration > unit` and
`integration > e2e`. Everything else is tolerance, and this repository's gate
treats it that way: an ordering violation means the suite has *changed shape*, a
band violation means it has *drifted within* its shape. Only the first is a
statement about design.

---

## How a test's layer is decided here

Not by its folder, its filename, or a label its author picked. "Unit test" is
the vaguest word in testing, and a policy stated over a word nobody has pinned
down enforces nothing. So the layer is derived, mechanically, from one question:

> **What is the widest real boundary this test can reach?**

"Reach" is transitive. `playwright/auth.spec.ts` imports `./fixtures`, which
re-exports `./auth`, which imports `@playwright/test` — it drives a browser just
as surely as a spec that imports one directly. `shape/classify.ts` parses each
test file with the same TypeScript parser the lint rules use, follows every
import that resolves inside the repository, and unions what the whole reachable
set imports. The widest boundary in that union wins.

Type-only imports are erased before anything runs and are not reaches.

### The boundary table

Every external module reachable from a test file must be classified in
`shape/boundaries.ts`, either as `pure` or as a boundary. **A module that is
missing fails the audit.** The failure mode of an open table is silent and
one-directional: add a dependency that opens a socket, and every test reaching
it keeps counting as a unit test, so the ratio improves on paper at the exact
moment the suite gets slower.

| Boundary | Reaches | Layer |
|---|---|---|
| `@playwright/test` | browser + running application | `e2e` |
| `node:fs`, `node:fs/promises` | filesystem | `integration` |
| `node:http`, `node:https`, `node:net` | TCP socket | `integration` |
| `node:child_process` | child process | `integration` |
| `supertest`, `superagent` | TCP socket | `integration` |
| `msw/node` | Node's HTTP stack | `integration` |
| `@pact-foundation/pact` | TCP socket + filesystem | `integration` |
| `eslint#ESLint` | filesystem + real config | `integration` |
| `@prisma/client` | database | `integration` |

Everything else is `pure` — it cannot reach outside the test process's own
memory. That is not the same as "has no side effects": React renders into a DOM
and faker mutates a seeded PRNG, and both are `pure` here.

### Three judgement calls, stated so you can disagree with them

**jsdom is not a boundary.** A Testing Library test renders into a DOM that
lives in the test process's own heap. It is not a browser and crosses nothing,
so component tests are unit tests here. The pyramid's cost argument is about
out-of-process work, and there is none.

**`eslint` is split by binding.** The `ESLint` class resolves this repository's
real flat config and lints real paths — genuinely an integration test of the
lint setup. `RuleTester` and `Linter` lint source strings already in memory.
Same package, opposite answers, so the table keys them separately and leaves
bare `eslint` deliberately unclassified: a namespace import reaches both halves
and has no honest single answer, so it fails rather than being guessed at.

**Reading the repository off disk counts as integration.** This is the call
that decides this repository's shape. `actionPins`, `gateSteps`, `patchedDeps`,
`katas`, `taxonomy` and the characterisation corpus all open real files. It is
the classic line — Fowler's "a unit test does not touch the filesystem" — and it
is defensible, but it is a call: those tests are fast, hermetic and
deterministic, which are the properties the pyramid actually cares about.

If you disagree, the disagreement is one line. Change `node:fs` from `boundary`
to `pure` in `shape/boundaries.ts`, and roughly half the middle band moves to
the base. The point of having the table is that the argument happens in one
place, in writing, rather than in fifty test files.

---

## The policy this repository is held to

**Declared shape: test pyramid**. The suite orders `unit > integration > e2e`,
which is the pyramid's claim.

| Layer | Enforced band |
|---|---|
| `unit` | 55–80% |
| `integration` | 15–40% |
| `e2e` | 2–10% |

These are wider in the middle than the textbook pyramid's 10–30%, on purpose,
for two reasons that are properties of what this repository is:

1. **It is a library of testing patterns, not an application.** A meaningful
   share of the suite demonstrates boundary-crossing on purpose — MSW
   interception, supertest over a real socket, Pact against a mock provider. An
   application with 30% integration tests might be over-invested at the seams;
   here it is the subject matter.
2. **Its audit suites read the repository off disk**, per the judgement call
   above.

The textbook ceiling of 30% does not merely pinch — **this suite is outside it**,
at 32.8%. That is the finding rather than a problem to size around: a pattern
library that demonstrates boundary-crossing, and audits itself by reading its own
files, has a legitimately fatter middle than the application the pyramid was
drawn for. Saying so is more useful than quietly adopting a band nobody meets.

The end-to-end ceiling is deliberately *not* widened and stays on the textbook
10%, because it is the band with the most to catch. Widening it to 12% was tried
first and abandoned: at 12% a doubled Playwright suite still passed, which makes
the ceiling decorative.

### What the bands still refuse

Holding the other layers still:

- `e2e` may grow 51 → 94 tests (+84%) before the ceiling fires. A doubling to
  102 gives 10.7% and fails.
- `integration` may grow 295 → 401 (+36%). The band that stops it is the **unit
  floor**, not the integration ceiling — adding integration tests dilutes every
  other layer's share, so 55% unit binds at 401 while 40% integration would not
  bind until 402. Bands interact; only the tightest one is ever the real limit.
- 130 unit tests may be deleted before the 55% floor fires.

Each of those is checked at the edge in `shape/policy.test.ts` — the last value
that passes and the first that does not. Both figures this section first carried
were wrong, and the tests are what found them.

---

## The measurement

Measured on the merge commit of PR #32, by `pnpm shape:check`:

```
  unit          553  █████████████████████████···············  61.5%   band 55–80%  ok
  integration   295  █████████████···························  32.8%   band 15–40%  ok
  e2e            51  ██······································   5.7%   band 2–10%   ok
```

899 tests across 59 files. The numbers move with every commit; the command is
the source of truth, not this block.

One number the ratio deliberately does not use: those 51 end-to-end tests are
*declarations*. `playwright.config.ts` runs them across six projects — five
browser/device projects that each take all 51, plus a visual project that takes
19 — so they are **274 executions**, each against a real browser. The ratio is a
statement about tests written and maintained, not tests run, which is worth
remembering when the pyramid's cost argument is the reason you are reading this.

---

## How it is enforced

Deliberately split in two, because the two halves have different costs.

**`pnpm test` — the classification.** `shape/shape.test.ts` parses every test
file, resolves what each reaches, and fails if anything is unclassified,
unparsable, or lands outside the three layers. Cheap, deterministic, and it runs
wherever the unit suite runs. This is the half with the silent failure mode.

**`pnpm shape:check` — the ratio.** Its own CI step. Counts tests by asking the
runners (`vitest list`, `playwright test --list`), joins those counts to the
classification, and fails on a band or ordering violation.

### Why the counts come from the runners

The obvious implementation counts `it(...)` calls with the parser that is
already there. It is wrong here, and measurably: a static count of this suite
comes out **19% low**, and the error is concentrated rather than spread, which
is fatal to a ratio.

| File | Static count | True count | Why |
|---|---|---|---|
| `tdd/conventions/eslint-plugin/aaaStructure.test.ts` | 0 | 18 | `RuleTester` generates one test per `valid`/`invalid` entry |
| `tdd/schools/orderContract.test.ts` | 0 | 28 | a shared contract invoked once per school |
| `k6/config.test.ts` | 29 | 53 | cases built in a loop over a table |
| `tdd/katas.test.ts` | 3 | 12 | `it.each(KATAS.map(...))` — rows unknowable without evaluating the module |

Every one of those under-counts a file that is *also* an integration test, so a
static census would report a tidier pyramid than the one that exists. A gate
that flatters the thing it measures is worse than no gate.

Both runners collect without executing and neither needs a browser or a database
to do it, so the real collectors are affordable in CI.

### What the join catches

Counting and classifying separately means the two can disagree, and every
disagreement is a bug in something:

- **Uncollected** — a test file on disk that no runner will run a single test
  from. Usually an include glob that stopped matching after a rename: the
  failure mode where a suite gets quieter and greener at once.
- **Unknown** — a runner collected a file the walker did not find.
- **Double-counted** — two runners claim the same file.
- **Stale exception** — a file in `EXPECTED_EMPTY` that now collects tests.

One file is legitimately empty: `pact/provider/users.provider.pact.verify.test.ts`
declares its suite as `it.skipIf(!process.env['PROVIDER_BASE_URL'])`, and
`vitest list` omits skipped tests. It is an entry in `EXPECTED_EMPTY` with a
reason attached, so a second one has to be argued for in writing.

---

## Using this in your own repository

1. Copy `shape/` and add `"shape:check": "node shape/check.ts"` to `scripts`.
2. Empty `MODULES` in `boundaries.ts` and run `pnpm shape:check`. Every module
   your tests reach will be reported unclassified — classify them one at a time.
   The list is the useful part: it is an inventory of everything your test suite
   touches, which most teams have never seen written down.
3. Pick a shape. If the ordering check fails on the shape you assumed you had,
   that is the finding, and it is worth more than the gate.
4. Set bands with headroom, then check them at the edge the way
   `policy.test.ts` does. A band drawn snugly around today's number is a
   screenshot with a CI job attached.

Two things this does **not** measure, and should not be read as measuring:

- **Time.** The ratio counts tests, not seconds, and the two come apart badly
  here: the e2e layer is 5.7% of the declarations and 274 browser executions.
  A suite can satisfy every band on this page and still spend most of its wall
  clock at the top. Time is the more honest metric and the harder gate, because
  it is not deterministic.
- **Coverage.** Nothing here says the tests are any good. A pyramid of vacuous
  unit tests passes every check on this page.
