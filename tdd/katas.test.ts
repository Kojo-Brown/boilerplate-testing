// @vitest-environment node
//
// The audit that keeps the step logs honest. Like the workflow-templates
// suites, this reads files off disk and resolves them relative to
// `import.meta.url`, which the project-default jsdom environment rewrites to
// an http: URL — hence the node environment above.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { KATAS } from './katas'
import { findStepProblems, formatStepProblem, parseTestTitles } from './steps'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function read(repoRelativePath: string): string {
  return readFileSync(join(repoRoot, repoRelativePath), 'utf8')
}

describe('kata step logs', () => {
  it('covers three katas', () => {
    expect(KATAS.map((kata) => kata.name)).toEqual([
      'FizzBuzz',
      'Bowling Game',
      'Gilded Rose',
    ])
  })

  it.each(KATAS.map((kata) => [kata.name, kata] as const))(
    '%s ships the files its log refers to',
    (_name, kata) => {
      expect(existsSync(join(repoRoot, kata.sourceFile))).toBe(true)
      expect(existsSync(join(repoRoot, kata.testFile))).toBe(true)
    },
  )

  it.each(KATAS.map((kata) => [kata.name, kata] as const))(
    '%s follows the cycle and matches its suite on disk',
    (_name, kata) => {
      const problems = findStepProblems(kata, read(kata.testFile)).map((found) =>
        formatStepProblem(kata, found),
      )

      expect(problems).toEqual([])
    },
  )

  it.each(KATAS.map((kata) => [kata.name, kata] as const))(
    '%s accounts for every test in its suite',
    (_name, kata) => {
      const claimed = kata.steps.flatMap((step) => step.tests)
      const onDisk = parseTestTitles(read(kata.testFile))

      // Ordering is not asserted — a step may add two tests, and a suite may
      // group them differently from the order they were written in — but the
      // counts must agree, which catches a test added without a step.
      expect(claimed).toHaveLength(onDisk.length)
      expect([...claimed].sort()).toEqual([...onDisk].sort())
    },
  )

  it('is written up in the README, step by step', () => {
    const readme = read('tdd/README.md')
    const missing = KATAS.flatMap((kata) =>
      kata.steps
        .filter((step) => !readme.includes(step.commit))
        .map((step) => `${kata.name}: ${step.commit}`),
    )

    expect(missing).toEqual([])
  })

  it('records every kata as a run of red/green pairs with pins only at the front', () => {
    // A summary assertion over the whole set, so that a log which passes the
    // per-rule checks but drifts into something structurally odd — say, a kata
    // that never refactors at all — is still visible here as a shape change.
    const shapes = KATAS.map((kata) => ({
      name: kata.name,
      phases: kata.steps.map((step) => step.phase).join(' '),
    }))

    expect(shapes).toEqual([
      {
        name: 'FizzBuzz',
        phases: 'red green red green red green red green red green refactor red green',
      },
      {
        name: 'Bowling Game',
        phases: 'red green red green red green red green refactor',
      },
      {
        name: 'Gilded Rose',
        phases: 'pin red green refactor red green refactor',
      },
    ])
  })
})
