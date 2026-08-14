/**
 * The step log — a machine-checked record of how each kata was actually built.
 *
 * A TDD kata's value is in its history, not its final state: the finished
 * FizzBuzz is four lines that teach nobody anything. The history lives in the
 * commits on the pull request branch, but this repository squash-merges, so a
 * copy that survives the merge lives in `katas.ts` as data.
 *
 * A copy of a history is a comment, and comments rot. What stops this one from
 * rotting is that `katas.test.ts` checks the log against the test files on
 * disk — every test title claimed by a step must exist, every test on disk
 * must be claimed by exactly one step — and against the rules of the cycle
 * itself, so a log describing an undisciplined sequence fails `pnpm test`
 * rather than being quietly believed.
 */

export const PHASES = ['pin', 'red', 'green', 'refactor'] as const

export type Phase = (typeof PHASES)[number]

export type Step = {
  /**
   * `red` writes a failing test, `green` makes it pass, `refactor` improves
   * the design without changing behaviour.
   *
   * `pin` is the one addition to the classic three, and it exists for the
   * Gilded Rose: characterisation tests written against inherited code pass on
   * their first run, so calling them `red` would be a lie and calling them
   * `green` would imply production code was written to satisfy them. A `pin`
   * step may only appear before the first `red`, which is the whole point —
   * you pin behaviour before you change it, never after.
   */
  readonly phase: Phase
  /** Subject line of the commit that made this step, on the PR branch. */
  readonly commit: string
  /** Why the step is shaped this way. The commit body carries the long form. */
  readonly note: string
  /**
   * `it(...)` titles introduced by this step. Only `red` and `pin` steps add
   * tests: a `green` step writes production code to satisfy a test that
   * already exists, and a `refactor` step changes no behaviour, so neither has
   * anything to add.
   */
  readonly tests: readonly string[]
}

export type Kata = {
  readonly name: string
  /** Repo-relative path to the suite whose titles the log is checked against. */
  readonly testFile: string
  /** Repo-relative path to the implementation the kata builds. */
  readonly sourceFile: string
  /** One-line statement of what the kata is for. */
  readonly teaches: string
  readonly steps: readonly Step[]
}

export type StepProblem = {
  /** Which rule was broken, for grouping in failure output. */
  readonly rule: string
  /** 1-based step number, or null for whole-kata problems. */
  readonly step: number | null
  readonly detail: string
}

// ---------------------------------------------------------------------------
// Reading test titles off disk
// ---------------------------------------------------------------------------

/**
 * Matches the title argument of a top-level `it(...)` call.
 *
 * Deliberately a regex and not the TypeScript compiler: this runs on every
 * `pnpm test`, and pulling a parser in to read string literals out of two
 * files would cost more than it is worth. The narrowness is the safeguard —
 * the title must be a plain literal at the start of a line, so a computed or
 * concatenated title fails to match and shows up as an undocumented test
 * rather than being silently skipped.
 */
const IT_TITLE = /^[ \t]*it\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm

/** Every `it(...)` title in a test file, in source order. */
export function parseTestTitles(source: string): string[] {
  const titles: string[] = []

  for (const match of source.matchAll(IT_TITLE)) {
    const raw = match[2]

    if (raw !== undefined) {
      titles.push(raw.replace(/\\(.)/g, '$1'))
    }
  }

  return titles
}

// ---------------------------------------------------------------------------
// Rules of the cycle
// ---------------------------------------------------------------------------

/** Phases that may introduce tests. */
const TEST_WRITING_PHASES: readonly Phase[] = ['pin', 'red']

function problem(rule: string, step: number | null, detail: string): StepProblem {
  return { rule, step, detail }
}

/**
 * Check the phase sequence against the rules of the cycle.
 *
 * The rules are stricter than "these three words in some order" on purpose. A
 * red with no green after it is an unfinished step; a green with no red before
 * it is production code nobody asked for; a refactor straight after a red is a
 * refactor performed on a failing suite, which is exactly the move that turns
 * a broken test into a debugging session.
 */
export function findPhaseProblems(steps: readonly Step[]): StepProblem[] {
  const problems: StepProblem[] = []

  if (steps.length === 0) {
    return [problem('empty', null, 'a kata must have at least one step')]
  }

  let seenNonPin = false

  steps.forEach((step, index) => {
    const number = index + 1
    const previous = index === 0 ? null : steps[index - 1]?.phase

    switch (step.phase) {
      case 'pin':
        if (seenNonPin) {
          problems.push(
            problem(
              'pin-after-work',
              number,
              'a pin step characterises code before it is changed, so it cannot follow a red, green or refactor step',
            ),
          )
        }
        break

      case 'red':
        break

      case 'green':
        if (previous !== 'red') {
          problems.push(
            problem(
              'green-without-red',
              number,
              `a green step must answer a failing test, but the previous step is ${previous ?? 'nothing'}`,
            ),
          )
        }
        break

      case 'refactor':
        if (previous !== 'green' && previous !== 'refactor') {
          problems.push(
            problem(
              'refactor-on-red',
              number,
              `a refactor step needs a green suite to protect it, but the previous step is ${previous ?? 'nothing'}`,
            ),
          )
        }
        break
    }

    if (step.phase !== 'pin') {
      seenNonPin = true
    }

    const declaresTests = step.tests.length > 0
    const mayDeclareTests = TEST_WRITING_PHASES.includes(step.phase)

    if (declaresTests && !mayDeclareTests) {
      problems.push(
        problem(
          'tests-outside-red',
          number,
          `a ${step.phase} step must not introduce tests, but it claims ${step.tests.length}`,
        ),
      )
    }

    if (!declaresTests && mayDeclareTests) {
      problems.push(
        problem(
          'red-without-test',
          number,
          `a ${step.phase} step exists to add a test, but it claims none`,
        ),
      )
    }

    if (step.commit.trim() === '') {
      problems.push(problem('empty-commit', number, 'a step must name its commit'))
    }

    if (step.note.trim() === '') {
      problems.push(problem('empty-note', number, 'a step must explain itself'))
    }
  })

  const first = steps[0]

  if (first !== undefined && first.phase !== 'red' && first.phase !== 'pin') {
    problems.push(
      problem(
        'bad-opening',
        1,
        `a kata opens on a red or a pin, not a ${first.phase}`,
      ),
    )
  }

  const last = steps[steps.length - 1]

  if (last !== undefined && last.phase === 'red') {
    problems.push(
      problem(
        'unresolved-red',
        steps.length,
        'the log ends on a red step, so the suite it describes never went green',
      ),
    )
  }

  const commits = new Map<string, number>()

  steps.forEach((step, index) => {
    const seenAt = commits.get(step.commit)

    if (seenAt !== undefined) {
      problems.push(
        problem(
          'duplicate-commit',
          index + 1,
          `commit subject is already used by step ${seenAt}: ${step.commit}`,
        ),
      )
    } else {
      commits.set(step.commit, index + 1)
    }
  })

  return problems
}

/**
 * Check the log's claims about tests against the titles actually on disk.
 *
 * This is the half that keeps the log honest as the code moves. Renaming a
 * test, deleting one, or adding one without recording which step introduced it
 * all fail here.
 */
export function findTestProblems(
  steps: readonly Step[],
  titlesOnDisk: readonly string[],
): StepProblem[] {
  const problems: StepProblem[] = []
  const declaredAt = new Map<string, number>()

  steps.forEach((step, index) => {
    for (const title of step.tests) {
      const seenAt = declaredAt.get(title)

      if (seenAt !== undefined) {
        problems.push(
          problem(
            'duplicate-claim',
            index + 1,
            `test is already claimed by step ${seenAt}: "${title}"`,
          ),
        )
      } else {
        declaredAt.set(title, index + 1)
      }
    }
  })

  const onDisk = new Set(titlesOnDisk)

  for (const [title, step] of declaredAt) {
    if (!onDisk.has(title)) {
      problems.push(
        problem('missing-test', step, `no test on disk is titled "${title}"`),
      )
    }
  }

  for (const title of onDisk) {
    if (!declaredAt.has(title)) {
      problems.push(
        problem(
          'undocumented-test',
          null,
          `no step claims to have introduced "${title}"`,
        ),
      )
    }
  }

  const duplicatesOnDisk = titlesOnDisk.filter(
    (title, index) => titlesOnDisk.indexOf(title) !== index,
  )

  for (const title of new Set(duplicatesOnDisk)) {
    problems.push(
      problem(
        'duplicate-on-disk',
        null,
        `two tests share the title "${title}", so neither can be traced to a step`,
      ),
    )
  }

  return problems
}

/** Every problem with one kata's log, given its test file's contents. */
export function findStepProblems(kata: Kata, testSource: string): StepProblem[] {
  return [
    ...findPhaseProblems(kata.steps),
    ...findTestProblems(kata.steps, parseTestTitles(testSource)),
  ]
}

export function formatStepProblem(kata: Kata, found: StepProblem): string {
  const where = found.step === null ? kata.name : `${kata.name} step ${found.step}`

  return `${where} [${found.rule}]: ${found.detail}`
}
