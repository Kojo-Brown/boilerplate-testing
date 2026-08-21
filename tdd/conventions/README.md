# Arrange-Act-Assert and Given-When-Then

Two conventions for shaping a test, the same eight behaviours written both
ways, and a lint plugin that makes each of them a build failure instead of a
paragraph in a wiki.

```bash
pnpm test tdd/conventions   # both suites, both rules, and the audit
pnpm lint                   # where the conventions are actually enforced
```

## Why one feature

Arrange-Act-Assert and Given-When-Then are conventions about *shape*, not about
what to test. Compared on two different features they would mostly compare the
features. So there is one policy — [`refundPolicy.ts`](./refundPolicy.ts),
eight behaviours, three outcomes and two return windows — and both
[`aaa.test.ts`](./aaa.test.ts) and [`gwt.test.ts`](./gwt.test.ts) state exactly
the same eight things about it, with the same fixtures and the same
assertions. Only the shape differs.

Keeping that true is not left to good intentions:
[`behaviours.ts`](./behaviours.ts) holds the eight behaviours and the exact
title each side gives them, and [`conventions.test.ts`](./conventions.test.ts)
parses both suites and checks them against it. A ninth case on one side fails
`pnpm test`.

## The two shapes

**Arrange-Act-Assert** puts the structure in the body, as marker comments:

```ts
it('withholds a restocking fee on an opened order', () => {
  // Arrange
  const unwrapped = order({ opened: true })

  // Act
  const decision = assessRefund(unwrapped, hoursAfterDelivery(24))

  // Assert
  expect(decision.outcome).toBe('partial')
})
```

**Given-When-Then** puts it in the titles, as nested describes:

```ts
describe('Given a delivered, opened standard order', () => {
  describe('When a refund is requested inside the 30-day window', () => {
    it('then a restocking fee is withheld', () => {
      expect(assessRefund(order({ opened: true }), hoursAfterDelivery(24)).outcome).toBe('partial')
    })
  })
})
```

They are the same three phases. The difference is who the structure is for: a
marker comment is for the person editing the body, and a nested describe is for
the person reading the failure report — Vitest prints the ancestry, so a broken
case reports as one sentence: `Given a delivered, opened standard order > When
a refund is requested inside the 30-day window > then a restocking fee is
withheld`.

## What each convention costs

The Given/When/Then suite states the eight behaviours in thirteen blocks: 5
`Given` blocks and 8 `When` blocks wrap 8 cases. All 8 of those `When` blocks
hold one case each, and 2 of the 5 `Given` blocks do. `conventions.test.ts`
counts them out of the parsed suite, so those numbers cannot drift.

That is the trade, stated honestly. The `Given` level pays for itself where a
context is genuinely shared — the unopened order is asked two different
questions, the perishable two more — and the `When` level, on this feature,
never does: it is one describe per case, existing to hold a clause. On a
feature with three acts against one arrangement the arithmetic reverses.

Arrange-Act-Assert has the opposite profile. It costs three comments per test
and never nests, so it scales flat, and it gives up the shared context
entirely: `aaa.test.ts` builds its order inline in all eight cases.

## Choosing between them

- **Reach for Given-When-Then** when the context is the hard part — a state
  machine, a permissions matrix, anything where the same arrangement is
  interrogated several ways, and where the audience for a failure includes
  somebody who will not open the file.
- **Reach for Arrange-Act-Assert** when the case is the hard part, when the
  suite is wide and shallow, or when the fixtures are cheap enough that
  repeating them beats hunting up two levels for what `sealed` means.
- **Do not mix them inside one file.** Both rules are configured per-file for
  that reason; a file with two conventions has none.
- The convention is not the point. A test that says what it does under either
  scheme beats a perfectly-shaped test that does three things.

## The lint rules

Two rules, in a local plugin at
[`eslint-plugin/`](./eslint-plugin/index.ts). It stays local on purpose — a
naming convention is house style, and the transferable part of this pattern is
that a checked convention survives while a documented one decays.

### `test-conventions/title-scheme`

The naming rule, and the one this repository runs over **every** test file.

Under its default `behaviour` scheme it does not prescribe a grammar; it
rejects a list of openers ([`vocabulary.ts`](./eslint-plugin/vocabulary.ts)) —
modals (`should`, `must`, `will`), the runner's own name (`it`, `test`), and
meta-verbs (`verify`, `ensure`, `expect`). Everything else is allowed, which is
what makes it safe to switch on across an existing suite: it never demands a
lowercase first letter, because this repository has honest titles opening with
`POST`, `Sulfuras` and `TypedTest.json()`.

Switching it on here cost zero renames. All 580 test titles in the repository
already stated what the system does — the convention existed and nothing was
holding it, which is exactly the condition in which a convention is one commit
from no longer being true.

Under `scheme: 'given-when-then'` the same rule checks structure instead, and
it can check much more, because the convention says much more:

- the outermost describe opens with `Given `
- the level inside a `Given` opens with `When `
- there is no third level of describe
- every case opens with `then ` and sits inside a `When`

It cannot decide whether the sentence is true — the rule reads `Given a
delivered order` as a well-formed clause, not as a fact about the fixture
underneath it.

### `test-conventions/aaa-structure`

The shaping rule, demonstrated on [`aaa.test.ts`](./aaa.test.ts). It checks
that:

- the `Act` and `Assert` markers are present
- no marker appears twice, and none appears out of order
- every marker has at least one statement under it
- no `expect(…)` runs before the `Assert` marker

The last one is the reason to have it. Three tidy comments are worth little on
their own; a rule that rejects act-assert-act-assert bodies catches the shape
where a failure tells you the test broke without telling you which step of it
did.

It cannot decide whether the statements under `// Act` are one action — a body
can put three unrelated calls under that marker and no rule reading the text
will know. The rule owns the shape; a reviewer still owns the substance.

### Wiring

```js
// eslint.config.js
import testConventions from './tdd/conventions/eslint-plugin/index.ts'

export default [
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    plugins: { 'test-conventions': testConventions },
    rules: { 'test-conventions/title-scheme': ['error', { scheme: 'behaviour' }] },
  },
  {
    files: ['test/refunds/**/*.test.ts'],
    rules: {
      'test-conventions/title-scheme': ['error', { scheme: 'given-when-then' }],
      'test-conventions/aaa-structure': 'error',
    },
  },
]
```

The `.ts` extension is required: Node resolves that import itself and strips
the types on the way in, so the rules can be written and type-checked as
TypeScript with no build step in front of the linter. That is why
`engines.node` starts at `^22.18.0` — the release where type stripping stopped
needing a flag.

`aaa-structure` is switched on for this folder only. Retrofitting marker
comments onto the other 40 test files in the repository would rewrite every
test body here to make a point about comments; adopting it is a per-directory
decision, and the snippet above is how to make it.

## What is deliberately not enforced

Both rules stay silent on titles the source does not spell out —
`` it(`${label}: returns 404`) `` is text the rule cannot see, and reporting on
it would make the rule a reason to stop parameterising tests. Neither rule
consults the type checker, because `pnpm lint` runs without type information
and because a convention you cannot check while typing is one nobody applies.

Both limits are tested rather than promised: the `valid` cases in
[`titleScheme.test.ts`](./eslint-plugin/titleScheme.test.ts) and
[`aaaStructure.test.ts`](./eslint-plugin/aaaStructure.test.ts) exist mostly to
pin down what the rules must **not** claim.

## Files

| File | What it is |
|------|------------|
| [`refundPolicy.ts`](./refundPolicy.ts) | the feature: eight behaviours, two return windows, one fee |
| [`behaviours.ts`](./behaviours.ts) | the eight behaviours and the title each convention gives them |
| [`aaa.test.ts`](./aaa.test.ts) | the suite in Arrange-Act-Assert |
| [`gwt.test.ts`](./gwt.test.ts) | the same suite in Given-When-Then |
| [`conventions.ts`](./conventions.ts) | what each rule decides and cannot decide, as data |
| [`conventions.test.ts`](./conventions.test.ts) | checks this README, both suites, and `eslint.config.js` against it |
| [`eslint-plugin/index.ts`](./eslint-plugin/index.ts) | the plugin object |
| [`eslint-plugin/titleScheme.ts`](./eslint-plugin/titleScheme.ts) | `test-conventions/title-scheme` |
| [`eslint-plugin/aaaStructure.ts`](./eslint-plugin/aaaStructure.ts) | `test-conventions/aaa-structure` |
| [`eslint-plugin/vocabulary.ts`](./eslint-plugin/vocabulary.ts) | the banned openers, the GWT prefixes, the phase markers |
| [`eslint-plugin/ast.ts`](./eslint-plugin/ast.ts) | what counts as a test call, and when a title is readable |
| [`eslint-plugin/titleScheme.test.ts`](./eslint-plugin/titleScheme.test.ts) | the naming rule under `RuleTester` |
| [`eslint-plugin/aaaStructure.test.ts`](./eslint-plugin/aaaStructure.test.ts) | the structure rule under `RuleTester` |
