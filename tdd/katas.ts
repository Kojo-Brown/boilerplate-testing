/**
 * The step logs for the three katas.
 *
 * Each entry records one commit on the pull request branch that introduced
 * these files. `katas.test.ts` checks the logs against the rules of the cycle
 * and against the test files on disk, so this is a checked record rather than
 * a description of good intentions. See `steps.ts` for the rules and
 * `README.md` for what each kata is for.
 */

import type { Kata } from './steps'

const FIZZBUZZ: Kata = {
  name: 'FizzBuzz',
  testFile: 'tdd/fizzbuzz/fizzBuzz.test.ts',
  sourceFile: 'tdd/fizzbuzz/fizzBuzz.ts',
  teaches: 'Triangulation, and refactoring when a branch ladder stops paying for itself.',
  steps: [
    {
      phase: 'red',
      commit: 'test(tdd): red — fizzBuzz returns "1" for 1',
      note: 'The first test buys the API, not the algorithm. Red because the module does not exist.',
      tests: ['returns "1" for 1'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — return the literal "1"',
      note: 'Faking it. A constant is the smallest thing that passes, and it makes the next test do real work.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — fizzBuzz returns "2" for 2',
      note: 'Triangulation: a second example is what forces the constant to become a rule.',
      tests: ['returns "2" for 2'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — stringify the number',
      note: 'The constant collapses into the general rule under the weight of two examples.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — fizzBuzz returns "Fizz" for 3',
      note: 'First rule that is not the identity. Asserting on 3, not 6, keeps the failure unambiguous.',
      tests: ['returns "Fizz" for 3'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — Fizz on multiples of three',
      note: 'One branch. Writing the Buzz branch here would be speculation with nothing to check it.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — fizzBuzz returns "Buzz" for 5',
      note: 'The symmetric rule, failing for the expected reason.',
      tests: ['returns "Buzz" for 5'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — Buzz on multiples of five',
      note: 'Repetition twice is not yet duplication worth naming; the refactor waits for a third case.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — fizzBuzz returns "FizzBuzz" for 15',
      note: 'The case the early-return shape gets wrong: 15 matches the first branch and returns "Fizz".',
      tests: ['returns "FizzBuzz" for 15'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — FizzBuzz on multiples of both',
      note: 'Green by the cheapest route, and the least satisfying design in the kata — which is the pressure for the next step.',
      tests: [],
    },
    {
      phase: 'refactor',
      commit: 'refactor(tdd): replace the branch ladder with a rules table',
      note: 'Four branches become a table plus a fold. The combination case disappears rather than being handled.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — fizzBuzzUpTo lists the first fifteen answers',
      note: 'The sequence is a separate responsibility. The expected array is written out rather than generated.',
      tests: ['lists the first fifteen answers in order'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — fizzBuzzUpTo maps the range',
      note: 'Composition, not a second algorithm: no new branches, because the mapping was already covered.',
      tests: [],
    },
  ],
}

const BOWLING: Kata = {
  name: 'Bowling Game',
  testFile: 'tdd/bowling/bowlingGame.test.ts',
  sourceFile: 'tdd/bowling/bowlingGame.ts',
  teaches: 'Choosing examples so that a failure has exactly one explanation.',
  steps: [
    {
      phase: 'red',
      commit: 'test(tdd): red — a gutter game scores 0',
      note: 'The degenerate case, where roll()/score() gets chosen over score(rolls).',
      tests: ['a gutter game scores 0'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — an empty game that always scores 0',
      note: 'roll() discards its argument and score() returns a constant. Honest for one example.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — a game of all ones scores 20',
      note: 'The most behaviour that can be described without mentioning frames at all.',
      tests: ['a game of all ones scores 20'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — remember the rolls and sum them',
      note: 'The constant becomes a sum. Inventing the frame loop here would be untested code on a hunch.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — a spare adds the next roll as a bonus',
      note: 'One spare in a known position, the rest gutters: the failure can only be about spares.',
      tests: ['a spare adds the next roll as a bonus'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — walk ten frames and pay the spare bonus',
      note: 'The sum becomes a frame walk, still assuming frames are two rolls wide.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — a strike takes one roll and pays two',
      note: 'Two tests in one step: they fail for the same single reason, and 120-instead-of-300 is what makes the frame drift obvious.',
      tests: [
        'a strike adds the next two rolls as a bonus',
        'a perfect game scores 300',
      ],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — a strike consumes one roll, not two',
      note: 'Advancing the cursor by one fixes the bonus and the frame boundaries together. The tenth frame needs no special case.',
      tests: [],
    },
    {
      phase: 'refactor',
      commit: 'refactor(tdd): name the frame rules',
      note: 'Five arithmetic expressions become named predicates, and score() reads as the scoring rules.',
      tests: [],
    },
  ],
}

const GILDED_ROSE: Kata = {
  name: 'Gilded Rose',
  testFile: 'tdd/gilded-rose/gildedRose.test.ts',
  sourceFile: 'tdd/gilded-rose/gildedRose.ts',
  teaches: 'Pinning inherited behaviour before changing it, and refactoring only once a green suite makes it safe.',
  steps: [
    {
      phase: 'pin',
      commit: 'test(tdd): pin — characterise the legacy Gilded Rose',
      note: 'Green on the first run by construction: a survey of inherited behaviour, not a specification. Everything after this is only safe because of it.',
      tests: [
        'a normal item loses one quality and one day',
        'a normal item loses two quality once the sell-by date has passed',
        'quality never goes negative',
        'Aged Brie gains quality as it ages',
        'Aged Brie stops at fifty quality',
        'Sulfuras never moves',
        'a backstage pass gains two within ten days and three within five',
        'a backstage pass is worthless once the concert has passed',
      ],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — a conjured item degrades twice as fast',
      note: 'The new requirement, and the first test here allowed to fail: conjured items fall through to the normal branch.',
      tests: ['a conjured item degrades twice as fast'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — conjured items lose two a day',
      note: 'A guard clause in front of the legacy ladder — the smallest edit that touches no line the pin tests are watching.',
      tests: [],
    },
    {
      phase: 'refactor',
      commit: 'refactor(tdd): look the ageing rule up by name',
      note: 'The ladder becomes a table, equivalent only because of details the pin tests fixed: the 11/6 thresholds, Sulfuras above the cap, clamping at the end rather than per increment.',
      tests: [],
    },
    {
      phase: 'red',
      commit: 'test(tdd): red — a conjured item degrades by four past its date',
      note: 'Twice as perishable as a normal item, which already doubles past its date. The step-3 guard never modelled that.',
      tests: ['a conjured item degrades by four once the sell-by date has passed'],
    },
    {
      phase: 'green',
      commit: 'feat(tdd): green — conjured decay doubles past the sell-by date',
      note: 'One ternary in the one place that owns conjured items — what the previous refactor bought.',
      tests: [],
    },
    {
      phase: 'refactor',
      commit: 'refactor(tdd): three ageing rules are one rule with a rate',
      note: 'The duplication was not extractable in step 4; it only became true once step 6 gave conjured the same doubling the others had.',
      tests: [],
    },
  ],
}

export const KATAS: readonly Kata[] = [FIZZBUZZ, BOWLING, GILDED_ROSE]
