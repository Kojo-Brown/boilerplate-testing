// @vitest-environment node
//
// Tests for the audit itself. The audit is the only thing standing between a
// step log and wishful thinking, so it is worth more than the assumption that
// it works: every rule below is checked by a log that breaks it, because a
// validator that never returns a problem passes katas.test.ts perfectly.

import { describe, it, expect } from 'vitest'
import {
  findPhaseProblems,
  findStepProblems,
  findTestProblems,
  formatStepProblem,
  parseTestTitles,
  type Kata,
  type Phase,
  type Step,
} from './steps'

let sequence = 0

/**
 * A step with only the fields a given assertion cares about spelled out.
 *
 * Commit subjects are made unique by a counter so that building a log out of
 * repeated `step('red')` calls does not trip the duplicate-commit rule and
 * pollute every other assertion — that rule has its own test below.
 */
function step(phase: Phase, overrides: Partial<Step> = {}): Step {
  sequence += 1

  return {
    phase,
    commit: `${phase} #${sequence}`,
    note: 'because',
    tests: phase === 'red' || phase === 'pin' ? [`a test #${sequence}`] : [],
    ...overrides,
  }
}

function rules(problems: ReturnType<typeof findPhaseProblems>): string[] {
  return problems.map((problem) => problem.rule)
}

// ---------------------------------------------------------------------------
// parseTestTitles
// ---------------------------------------------------------------------------

describe('parseTestTitles', () => {
  it('reads titles in source order', () => {
    const source = [
      "describe('thing', () => {",
      "  it('does one', () => {})",
      "  it('does two', () => {})",
      '})',
    ].join('\n')

    expect(parseTestTitles(source)).toEqual(['does one', 'does two'])
  })

  it('reads single, double and backtick quoted titles', () => {
    const source = ["it('single', () => {})", 'it("double", () => {})', 'it(`backtick`, () => {})'].join(
      '\n',
    )

    expect(parseTestTitles(source)).toEqual(['single', 'double', 'backtick'])
  })

  it('keeps quotes that appear inside a title', () => {
    expect(parseTestTitles(`it('returns "1" for 1', () => {})`)).toEqual(['returns "1" for 1'])
  })

  it('unescapes an escaped quote', () => {
    expect(parseTestTitles("it('it\\'s fine', () => {})")).toEqual(["it's fine"])
  })

  it('reads a computed title as its raw source text, so it surfaces as undocumented', () => {
    // Neither of these is a stable test name, and neither can be claimed by a
    // step. Reading them verbatim rather than skipping them is the friendlier
    // failure: findTestProblems then reports the exact text it could not
    // account for, instead of the title silently not existing.
    expect(parseTestTitles('it(`counts ${n} things`, () => {})')).toEqual([
      'counts ${n} things',
    ])
    expect(parseTestTitles("it('a' + 'b', () => {})")).toEqual(['a'])
  })

  it('does not mistake describe or it.each for a test title', () => {
    const source = ["describe('a group', () => {", "  it.each([1])('each %i', () => {})", '})'].join(
      '\n',
    )

    expect(parseTestTitles(source)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findPhaseProblems
// ---------------------------------------------------------------------------

describe('findPhaseProblems', () => {
  it('accepts a plain red/green run', () => {
    expect(findPhaseProblems([step('red'), step('green')])).toEqual([])
  })

  it('accepts pins before the first red, and a trailing refactor', () => {
    expect(
      findPhaseProblems([step('pin'), step('red'), step('green'), step('refactor')]),
    ).toEqual([])
  })

  it('accepts consecutive refactor steps', () => {
    expect(
      findPhaseProblems([step('red'), step('green'), step('refactor'), step('refactor')]),
    ).toEqual([])
  })

  it('rejects an empty log', () => {
    expect(rules(findPhaseProblems([]))).toEqual(['empty'])
  })

  it('rejects a pin after work has started', () => {
    const problems = findPhaseProblems([step('red'), step('green'), step('pin')])

    expect(rules(problems)).toContain('pin-after-work')
  })

  it('rejects a green that answers no red', () => {
    const problems = findPhaseProblems([step('red'), step('green'), step('green')])

    expect(rules(problems)).toEqual(['green-without-red'])
  })

  it('rejects a refactor performed on a red suite', () => {
    const problems = findPhaseProblems([step('red'), step('refactor'), step('green')])

    expect(rules(problems)).toContain('refactor-on-red')
  })

  it('rejects a log that opens on a green', () => {
    const problems = findPhaseProblems([step('green'), step('red'), step('green')])

    expect(rules(problems)).toContain('bad-opening')
  })

  it('rejects a log that ends on an unanswered red', () => {
    const problems = findPhaseProblems([step('red'), step('green'), step('red')])

    expect(rules(problems)).toEqual(['unresolved-red'])
  })

  it('rejects tests introduced by a green or a refactor', () => {
    const problems = findPhaseProblems([
      step('red'),
      step('green', { tests: ['a smuggled test'] }),
    ])

    expect(rules(problems)).toEqual(['tests-outside-red'])
  })

  it('rejects a red that adds no test', () => {
    const problems = findPhaseProblems([step('red', { tests: [] }), step('green')])

    expect(rules(problems)).toEqual(['red-without-test'])
  })

  it('rejects a step with no commit or no note', () => {
    const problems = findPhaseProblems([
      step('red', { commit: '  ' }),
      step('green', { note: '' }),
    ])

    expect(rules(problems)).toEqual(['empty-commit', 'empty-note'])
  })

  it('rejects two steps claiming the same commit', () => {
    const problems = findPhaseProblems([
      step('red', { commit: 'same' }),
      step('green', { commit: 'same' }),
    ])

    expect(rules(problems)).toEqual(['duplicate-commit'])
  })

  it('numbers problems from one', () => {
    const [problem] = findPhaseProblems([step('red'), step('green'), step('red')])

    expect(problem?.step).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// findTestProblems
// ---------------------------------------------------------------------------

describe('findTestProblems', () => {
  const steps = [step('red', { tests: ['one', 'two'] }), step('green')]

  it('accepts a log whose claims match the suite exactly', () => {
    expect(findTestProblems(steps, ['one', 'two'])).toEqual([])
  })

  it('does not care about ordering', () => {
    expect(findTestProblems(steps, ['two', 'one'])).toEqual([])
  })

  it('reports a claimed test that is not on disk', () => {
    const problems = findTestProblems(steps, ['one'])

    expect(rules(problems)).toEqual(['missing-test'])
    expect(problems[0]?.detail).toContain('"two"')
  })

  it('reports a test on disk that no step claims', () => {
    const problems = findTestProblems(steps, ['one', 'two', 'three'])

    expect(rules(problems)).toEqual(['undocumented-test'])
    expect(problems[0]?.detail).toContain('"three"')
  })

  it('reports the same test claimed by two steps', () => {
    const problems = findTestProblems(
      [step('red', { tests: ['one'] }), step('green'), step('red', { tests: ['one'] }), step('green')],
      ['one'],
    )

    expect(rules(problems)).toEqual(['duplicate-claim'])
  })

  it('reports two tests on disk sharing a title', () => {
    const problems = findTestProblems([step('red', { tests: ['one'] }), step('green')], [
      'one',
      'one',
    ])

    expect(rules(problems)).toEqual(['duplicate-on-disk'])
  })
})

// ---------------------------------------------------------------------------
// findStepProblems / formatStepProblem
// ---------------------------------------------------------------------------

describe('findStepProblems', () => {
  const kata: Kata = {
    name: 'Example',
    testFile: 'tdd/example/example.test.ts',
    sourceFile: 'tdd/example/example.ts',
    teaches: 'nothing in particular',
    steps: [step('red', { tests: ['works'] }), step('green')],
  }

  it('finds nothing wrong with a matching log and suite', () => {
    expect(findStepProblems(kata, "it('works', () => {})")).toEqual([])
  })

  it('reports phase and test problems together', () => {
    const broken: Kata = {
      ...kata,
      steps: [step('green'), step('red', { tests: ['works'] })],
    }

    expect(rules(findStepProblems(broken, "it('works', () => {})")).sort()).toEqual([
      'bad-opening',
      'green-without-red',
      'unresolved-red',
    ])
  })
})

describe('formatStepProblem', () => {
  const kata: Kata = {
    name: 'Example',
    testFile: 'tdd/example/example.test.ts',
    sourceFile: 'tdd/example/example.ts',
    teaches: 'nothing in particular',
    steps: [],
  }

  it('names the kata and the step', () => {
    expect(formatStepProblem(kata, { rule: 'unresolved-red', step: 3, detail: 'ends red' })).toBe(
      'Example step 3 [unresolved-red]: ends red',
    )
  })

  it('names only the kata for a whole-log problem', () => {
    expect(
      formatStepProblem(kata, { rule: 'undocumented-test', step: null, detail: 'stray test' }),
    ).toBe('Example [undocumented-test]: stray test')
  })
})
