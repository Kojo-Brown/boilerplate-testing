# Fuzzing parsers and validators: the generator is the easy half

Fuzzing is a loop. Produce an input, run the program, decide whether the answer
was right — and the third step is the one nobody writes about. Generators are
what the tools ship and what the tutorials demonstrate; the *oracle* is where
the difficulty is, because a campaign runs a million inputs and has to judge
each one with nobody looking at it.

This directory measures both halves against the same subject, and the results
are uncomfortable in both directions.

One subject: `config.ts`, a strict JSON parser followed by a validator for one
service's configuration schema — the shape almost every service has at its
edge. Sixteen single-behaviour faults are applied to the real source, ten in
the parser and six in the validator. Four automated oracles and one
hand-written example suite are run against all sixteen, over a fixed generator
and a fixed seed.

## The oracle matrix

Five probes, sixteen faults, one generator held constant so that the table is a
measurement of oracles rather than of luck.

| Probe | Faults found | What it is |
|-------|--------------|------------|
| `crash` — did it throw | **1 / 16** | one line; needs no knowledge of the subject |
| `roundtrip` — parse → serialise → parse | **2 / 16** | self-consistency; needs no reference |
| `differential` — against `JSON.parse` | **8 / 16** | free, near-perfect, and only for the parser |
| `invariant` — five documented promises | **6 / 16** | the only probe that reaches the validator |
| `examples` — 26 cases somebody wrote | **16 / 16** | the number to distrust; see below |
| all four automated probes together | **14 / 16** | |

Ordered by what they cost to write, which is very nearly the reverse of what
they find — with one inversion that is the whole point of the table.

### `crash` finds one fault, and it is not the fault it appears to find

The oracle everybody starts with — *run it and see if it falls over* — finds
one of sixteen, and the one it finds is caught by two of the other three
probes as well. That is not a coincidence: **a crash is not an oracle's
verdict, it is the absence of one.** The subject never returned, so nothing was
compared, and whichever probe happened to be running reports it. "We fuzzed it
for a week and it never crashed" is a statement about the runtime, not about
the program. In a memory-safe language almost nothing crashes, and fifteen of
these sixteen faults return a wrong answer perfectly politely.

The exception is instructive. `differential` is the only probe that *misses*
the crash, because its list of declared divergences from `JSON.parse` tells it
to skip input nested past `MAX_DEPTH` — which is exactly the input that exposes
a missing depth guard. The strongest oracle here has one hole, the hole is
written down, and the one fault in the corpus that lives in it is invisible to
it at any budget. **An excuse list is a hole with a comment above it.**

### `differential` is a property of the problem, not of the technique

Eight of ten parser faults, in a probe that is four lines long, because
somebody else already implemented this grammar and shipped it in the runtime.
Where a reference implementation exists, fuzzing looks miraculous.

It finds **zero** validator faults, and no amount of effort would change that.
There is no reference implementation of *this service's* configuration rules,
there will never be one, and writing one would mean writing the validator
again. Every guide to fuzzing demonstrates on a parser; this is the half of a
real system that demonstration hides.

### `roundtrip` compares a subject with itself

Two of sixteen, and its weakness is structural rather than incidental. A
parser that is *consistently* wrong round-trips perfectly:
`LEADING_ZERO_ACCEPTED` reads `010` as ten, serialises it to `10`, reads it
back as ten, and every step agrees with every other. It is the oracle to reach
for when no reference exists — and it is close to blind.

### `invariant` is the only way into the validator, and it is hand-written

Five properties, written out from the documented schema: an accepted value
satisfies it, acceptance loses no field, validation is idempotent, a refusal
names a field with a declared code, and validation does not modify its
argument. Six of sixteen: the five validator faults below, plus the crash,
which it reports for the reason every probe does. That fifth property catches
`TAGS_SORTED_IN_PLACE`, which is invisible
end-to-end — the pipeline's input was allocated by the parser a microsecond
earlier and belongs to nobody, so only a probe pointed one layer *below*
`loadConfig` can see it.

`spec.ts` is honest about what it is: a second implementation of the
validator's rules. That is what an oracle for business logic always is. What
makes it worth writing is that the two are not wrong in the same places — it
answers *is this finished value acceptable* over a value already parsed and
whole, while `validateConfig` answers a harder question over `unknown`, in an
order, accumulating messages, and the validator faults live in those mechanics.
What it cannot check is the *rules*: both files read the bounds from the same
exported constants, deliberately, so a rule that is wrong in one is wrong in
the other.

### The two faults nothing automated finds

`EXPONENT_PLUS_REJECTED` — the parser refuses `1e+5`. `RATIO_UPPER_BOUND_EXCLUSIVE`
— the validator refuses a ratio of exactly 1, which the schema documents as
inclusive. They are the only two faults in the corpus that make the subject
*too strict*, and they are exactly the two the whole apparatus misses.

That is not an accident of this corpus. Every oracle above is a statement about
what the subject **accepts**: it did not crash, its output round-trips, its
output matches the reference, its accepted value satisfies the schema. Nothing
in a fuzzing campaign generates a known-good input and demands that it be
accepted, because "known-good" is a judgement and a generator has none. A
validator that rejects everything satisfies every property in `oracles.ts`.

**Over-rejection is invisible to fuzzing by construction**, and the only probe
that catches either fault is a case somebody sat down and wrote:

```ts
it('a ratio of exactly 1 is inside the inclusive bound', …)
```

The two are invisible for different reasons, which `seeds.test.ts` separates.
`RATIO_UPPER_BOUND_EXCLUSIVE` is invisible *in principle* — there is no oracle
that could tell a wrongly-refused config from a rightly-refused one.
`EXPONENT_PLUS_REJECTED` is invisible only *in practice*: `differential` would
catch it in one input, and no generator ever produced that input. See
[what one seed is worth](#what-one-seed-is-worth).

### Why 16 / 16 for the examples is not a result

The same person wrote `examples.ts` and `edits.ts`. A corpus of faults and a
corpus of cases produced from one person's idea of what goes wrong will agree
with each other for reasons that have nothing to do with either technique —
`property/README.md` reports the same circularity and it applies here
unchanged, and the honest thing is to state the consequence rather than bury
it: **on this corpus the automated probes are a strict subset of the
examples.** Every fault the campaign found, a hand-written case found too.
Nothing here says fuzzing pays for itself.

What the circularity hides is *when* each list was written. The examples were
written by somebody who knew which sixteen things could be wrong, because they
had just written them down. The campaign knew nothing: it produced
`{"":7,"":0,"":0,"":{"":true,"":0}}` — the minimised witness for
`DUPLICATE_KEY_FIRST_WINS` — from a mutation of an unrelated document, on
input 18 of two thousand, having been told only what a JSON parser is supposed
to agree with. That is the property that does not survive being written down as
a matrix, and it is the only reason to run the campaign at all: **the examples
cover what somebody thought of, and that is exactly and only what they cover.**
`snapshot/README.md` measures the same boundary from the other side — its
hand-written assertion suite misses a rounding bug on the one order nobody
wrote a case for.

## What each generator actually reaches

Detection is half the story; the other half is whether the campaign got
anywhere near the code. "The campaign found no bugs" is the output of a fuzzer
that is working and of one whose inputs never got past the first byte, and
nothing in the report tells them apart.

So the campaign is measured by reach as well as by findings, against the
subject's own declared outcomes — thirteen ways the parser can refuse an input,
nine ways the validator can, both exported as closed lists from `config.ts`.
Over 2,000 inputs each:

| Generator | Parse refusals | Validation refusals | Parsed | Accepted |
|-----------|----------------|---------------------|--------|----------|
| `random` — uniform characters | **7 / 13** | **1 / 9** | 3 | 0 |
| `mutate` — edits to a seed corpus | **13 / 13** | **6 / 9** | 262 | 16 |
| `grammar` — generated from the schema | **1 / 13** | **9 / 9** | 1958 | 635 |
| `mixed` — the three in rotation | **13 / 13** | **9 / 9** | 737 | 227 |

Three findings, none of them obvious from the folklore:

1. **The naive fuzzer never arrives.** Uniform characters get a document past
   the parser three times in two thousand and produce a valid config zero
   times. Every invariant about accepted configs is dead code under it, and the
   report it prints is indistinguishable from a thorough campaign's.
2. **The two specialised generators are near-complements.** `grammar` reaches
   every validator refusal and exactly one parser refusal — it serialises
   through `JSON.stringify`, so it *cannot* emit a syntax error. `random`
   reaches the opposite half, badly. Neither is a fuzzer you would ship alone.
3. **A corpus of real documents is what bridges them.** `mutate` reaches all
   thirteen parse refusals *and* six of nine validation refusals, because its
   seeds are valid configs and a few edits leave them parseable. It is the only
   single generator that reaches both halves — and it still misses three
   validator refusals that `grammar` provokes in a handful of inputs.

### The same oracle, four generators

The oracle matrix holds the generator still to compare oracles. Turn it around
— hold the *oracle* still and vary the generator — and four faults separate
them cleanly. Each row is one fault, one oracle, four campaigns:

| Fault | Oracle | `random` | `mutate` | `grammar` | `mixed` |
|-------|--------|----------|----------|-----------|---------|
| `CONTROL_CHARACTER_ACCEPTED` | `differential` | · | ✓ | · | ✓ |
| `PROTOTYPE_POLLUTION` | `differential` | · | · | ✓ | ✓ |
| `NO_DEPTH_LIMIT` | `crash` | · | · | ✓ | ✓ |
| `UNKNOWN_KEY_IGNORED` | `invariant` | · | ✓ | ✓ | ✓ |

A raw control character inside a string is a byte-level accident and only
byte-level edits produce it; `JSON.stringify` escapes every one. A `__proto__`
*key* and thirty thousand levels of nesting are both structural, and no
sequence of random edits to a config document assembles either. The oracle is
identical down each column — what changes is whether the input that would have
tripped it was ever produced. **A campaign is a generator and an oracle, and
reporting either one alone is reporting half a measurement.**

The measure is real and coarse: reaching `UNEXPECTED_CHARACTER` says nothing
about which of a dozen places raised it. Statement coverage would be finer and
would need the subject instrumented. This needs nothing, costs one pass, and
separates the three generators by an order of magnitude.

### The generator bug that cost a matrix column

`grammar` adds an unknown key to a document to exercise `UNKNOWN_KEY`, and
`__proto__` was on the list of keys it added. Written the obvious way —

```ts
document['__proto__'] = value
```

— it sets the document's prototype instead of adding a key, the key never
reaches the serialised text, and the generator silently loses the only input
that can expose `PROTOTYPE_POLLUTION`. Which is the parser bug this directory
is measuring, committed by the fuzzer instead of by the parser. It was found by
a `·` in the matrix, not by anything failing. `PERTURBATIONS` uses
`Object.defineProperty`, and `generators.test.ts` asserts that `"__proto__"`
appears in the emitted text.

### The yield problem, measured

The first version of `grammar` drew each field independently — a valid name 80%
of the time, a valid `retries` 80% of the time, and so on. That reads as
reasonable and produced a document the validator accepts **0.4%** of the time.
Every invariant about accepted configs was being checked two or three times in
a 2,000-input campaign, and two faults went unfound for no reason except that
the generator almost never reached the code they were in.

The fix is the one `property/README.md` reaches from the other direction: build
the value you want and break *one* thing, rather than rolling for each field
and hoping. Acceptance went from 0.4% to 32%, and `generators.test.ts` holds a
floor under it so a regression is loud rather than silent.

## What one seed is worth

`EXPONENT_PLUS_REJECTED` is invisible to every automated probe in the matrix.
It is not invisible to the differential oracle — `probeOnce(subject,
'differential', '1e+5')` reports it immediately. The oracle is fine. The
*corpus* cannot reach it: `+` is in the mutation alphabet and `e` is in three
seeds, and assembling a signed exponent inside an otherwise valid number takes
several coincident edits that a blind search does not make.

`seeds.test.ts` measures exactly what that costs, with everything else held
identical:

| Corpus | Campaign | First finding |
|--------|----------|---------------|
| `SEED_CORPUS` as it stands | 20,000 mutations | **never** |
| `SEED_CORPUS` + one seed containing `1e+5` | 20,000 mutations | **input 45** |

The seed is deliberately still absent. Adding it would take `differential` from
eight faults to nine and cost the demonstration, and it would not change the
lesson: the next spelling nobody thought of is still missing, and no report
anywhere says so. **A campaign's blind spots are invisible from inside the
campaign.** The only things that make them visible are a coverage measure like
`reach.ts` and an injected fault like this one.

## Minimising a witness, and where that stops working

A mutation fuzzer's find arrives as line noise. `PROTOTYPE_POLLUTION` was first
reported on a 187-character document; nobody files that. `minimise.ts` is
Zeller and Hildebrandt's ddmin plus a single-character sweep, reducing towards
a predicate that holds the *reason* fixed rather than merely "still fails" —
the loose predicate walks every witness in the corpus to the empty string,
which fails everything for the most boring reason available.

It works, and then it stops working, and the two halves split cleanly:

| Witnesses | Kept after minimising | Example |
|-----------|-----------------------|---------|
| parser faults (unstructured) | **34%** on average | 187 → 34 characters |
| validator faults (well-formed documents) | **79%** on average | 96 → 88 characters, 776 predicate calls |

The second row is not a defect in the algorithm. ddmin deletes contiguous
chunks and single characters, and every such deletion from a well-formed JSON
document makes it malformed — so the predicate stops holding and the search
stalls with the document almost intact, after a four-figure number of
evaluations. Reducing a structured input needs a reducer that knows the
structure, which is precisely what `fast-check` has and a mutation fuzzer does
not: `property/shrinking.ts` gets 734 → 8 in 62 steps because it kept the
derivation tree, and here there is no tree to keep.

**A crash witness is not minimised at all**, deliberately. ddmin drives a stack
overflow to the exact depth *this* runtime, on *this* machine, with *this*
frame size happens to fail at — 4,188 brackets — and a witness sitting on that
boundary stops reproducing on a runner with a slightly larger stack. It would
fail in the most expensive way available: green where it was recorded, red in
CI, for a reason that looks nothing like the bug. The crash witnesses keep
their margin and `corpus.ts` writes them as `"[".repeat(30000)`.

## What runs in CI, and what does not

The campaign does not. It is a search — 2,000 inputs per probe per fault, plus
a minimisation search on every hit — and paying for it on every commit to learn
a result that has not changed is how a gate acquires `continue-on-error: true`
within a month. `mutation/README.md` makes the same trade for the same reason.

So the search runs by hand:

```bash
pnpm fuzz:record        # re-runs every campaign and rewrites corpus.ts
```

and what it finds is committed. Two suites then read `corpus.ts` for opposite
reasons:

- **`corpus.test.ts` replays the witnesses.** Thirty-three inputs, milliseconds,
  and it is the regression gate: these sixteen faults, once found, stay found.
  It checks both directions — each witness must still expose its fault, and
  each must still be *silent* on the honest subject, which is what stops the
  corpus filling up with inputs that fail for unrelated reasons.
- **`detection.test.ts` re-runs the campaigns for real** and fails if the live
  matrix and the recorded one disagree in either direction. Without it the
  corpus is a screenshot: a set of inputs that once reproduced something,
  agreeing forever with itself. With it, a corpus that has quietly stopped
  being reachable by the campaign that produced it cannot sit there looking
  green.

The control comes first in both. `config.ts` compiled through the same
edit-and-import pipeline with no edits must be clean under all five probes —
without that, a broken harness would make every variant look caught and the
matrix would report a perfect score produced entirely by a bug in the
measurement.

## When to reach for which

- **Parsing a published format?** Write the differential oracle first. It is
  four lines, it is nearly complete, and it will find things no test suite
  would. Then write down every intended divergence, and understand that you
  have just enumerated your blind spots.
- **Validating your own rules?** A differential oracle does not exist for you.
  Write invariants, accept that they are a second statement of the spec, and
  spend the effort on a generator that produces *valid* documents — because
  every property you can state is about what the validator accepts, and a
  generator that never produces an acceptable document checks none of them.
- **Either way, keep the examples.** They cost an afternoon and they are the
  only thing in this directory that catches a rule the system is too strict
  about.
- **Do not report "it did not crash."** Report what the campaign reached.

## The files

| File | What it is |
|------|------------|
| `config.ts` | the subject: strict JSON parser, config validator, and the pipeline over both |
| `spec.ts` | the schema restated as a predicate, for the invariant oracle |
| `edits.ts` | sixteen single-behaviour faults, as edits to the real source |
| `load.ts` | compiling and importing a variant, plus the unedited control |
| `random.ts` | seeded mulberry32, so a campaign can be replayed |
| `generators.ts` | the three archetypes, the rotation, and the seed corpus |
| `equality.ts` | structural comparison, own properties only, in two flavours of zero |
| `oracles.ts` | the four automated probes and what each is blind to |
| `examples.ts` | 26 hand-written cases, used as a suite and as the fifth probe |
| `campaign.ts` | the loop, and the one place a thrown subject becomes a finding |
| `minimise.ts` | ddmin plus a character sweep |
| `reach.ts` | what a generator provoked, against the declared outcome lists |
| `corpus.ts` | generated — the recorded matrix and one witness per detection |
| `record.ts` | `pnpm fuzz:record`; rebuilds the above by running the campaigns |
| `settings.ts` | the seed, the budget, and the nesting depth every number is a property of |
