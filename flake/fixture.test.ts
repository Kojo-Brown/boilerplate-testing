// @vitest-environment node

/**
 * The subject's two mechanisms: the plan parser and the attempt ledger.
 *
 * Both are tested here rather than inside `fixture/`, which `pnpm test`
 * excludes wholesale — the directory holds tests that fail on purpose, and the
 * exclusion is what keeps them out of the suite.
 *
 * The parser is strict and this file is mostly about that strictness. Every
 * cell of the published matrix is an answer to "what did this artifact record
 * about the flake", and a plan that silently parsed as `{ cases: [] }` would
 * make every one of them read "nothing recorded" for the one reason that must
 * never be confused with a finding.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { claimAttempt, fileAttempt, readLedger, runCase } from '@/flake/fixture/ledger'
import { loadPlan, parsePlan } from '@/flake/fixture/plan'

const plan = (cases: unknown): string => JSON.stringify({ cases })

describe('parsePlan', () => {
  it('reads a case with the attempts it fails on', () => {
    expect(parsePlan(plan([{ id: 'x', failOn: [1, 3] }])).cases).toEqual([{ id: 'x', failOn: [1, 3] }])
  })

  it('reads a case that never fails', () => {
    expect(parsePlan(plan([{ id: 'x', failOn: [] }])).cases).toHaveLength(1)
  })

  it('refuses a payload with no cases array', () => {
    expect(() => parsePlan('{}')).toThrow('cases')
  })

  it('refuses a case with no id', () => {
    expect(() => parsePlan(plan([{ failOn: [1] }]))).toThrow('case 0')
  })

  it('refuses an attempt number that is not a positive integer', () => {
    expect(() => parsePlan(plan([{ id: 'x', failOn: [0] }]))).toThrow('case 0')
    expect(() => parsePlan(plan([{ id: 'x', failOn: [1.5] }]))).toThrow('case 0')
  })

  it('names the offending case by index', () => {
    expect(() => parsePlan(plan([{ id: 'ok', failOn: [] }, { id: 'bad' }]))).toThrow('case 1')
  })

  it('refuses two cases with the same id, which the artifacts key on', () => {
    expect(() => parsePlan(plan([{ id: 'x', failOn: [] }, { id: 'x', failOn: [] }]))).toThrow('unique')
  })

  it('refuses a tag that is not a tag', () => {
    expect(() => parsePlan(plan([{ id: 'x', failOn: [], tag: 'flaky' }]))).toThrow('case 0')
  })

  it('refuses an error count below one', () => {
    expect(() => parsePlan(plan([{ id: 'x', failOn: [1], errorsPerAttempt: 0 }]))).toThrow('case 0')
  })

  it('accepts a tag given as an option and a tag given in the title', () => {
    expect(parsePlan(plan([{ id: 'x', failOn: [], tag: '@flaky', tagInTitle: true }])).cases).toHaveLength(1)
  })
})

describe('loadPlan', () => {
  let directory = ''

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'flake-plan-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    delete process.env['FLAKE_PLAN']
  })

  it('reads the file the environment names', () => {
    const path = join(directory, 'plan.json')

    writeFileSync(path, plan([{ id: 'x', failOn: [2] }]))
    process.env['FLAKE_PLAN'] = path

    expect(loadPlan().cases[0]?.failOn).toEqual([2])
  })

  it('refuses to run without a plan, rather than registering no tests', () => {
    delete process.env['FLAKE_PLAN']

    expect(() => loadPlan()).toThrow('never run on its own')
  })
})

describe('the attempt ledger', () => {
  let directory = ''

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'flake-ledger-'))
    process.env['FLAKE_LEDGER'] = directory
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    delete process.env['FLAKE_LEDGER']
  })

  it('counts attempts from one, per case', () => {
    expect([claimAttempt('a'), claimAttempt('a'), claimAttempt('b')]).toEqual([1, 2, 1])
  })

  it('counts across processes, which is what makes a rerun measurable', () => {
    // The count lives in the directory rather than in a variable: a Vitest
    // retry re-enters the same worker, but a rerun is a new process and a
    // second run half an hour later is another one again.
    claimAttempt('a')
    const continued = readFileSync(join(directory, 'a.attempt'), 'utf8')

    expect(continued).toBe('1')
    expect(claimAttempt('a')).toBe(2)
  })

  it('keeps a case id that is not a file name out of the file system', () => {
    expect(() => claimAttempt('journey > loads the list')).not.toThrow()
    expect(claimAttempt('journey > loads the list')).toBe(2)
  })

  it('files one record per attempt and reads them back in order', () => {
    fileAttempt({ id: 'a', attempt: 1, outcome: 'failed' })
    fileAttempt({ id: 'a', attempt: 2, outcome: 'passed' })

    expect(readLedger(directory)).toEqual([
      { id: 'a', attempt: 1, outcome: 'failed' },
      { id: 'a', attempt: 2, outcome: 'passed' },
    ])
  })

  it('reads a directory with no ledger in it as no attempts', () => {
    expect(readLedger(join(directory, 'empty'))).toEqual([])
  })

  it('refuses to file an attempt with no ledger directory set', () => {
    delete process.env['FLAKE_LEDGER']

    expect(() => claimAttempt('a')).toThrow('never run on its own')
  })

  describe('runCase', () => {
    it('throws on an attempt the plan names, and files it as failed', () => {
      expect(() => {
        runCase('a', [1])
      }).toThrow('attempt 1 fails by plan')
      expect(readLedger(directory)).toEqual([{ id: 'a', attempt: 1, outcome: 'failed' }])
    })

    it('passes on an attempt the plan does not name', () => {
      runCase('a', [2])

      expect(readLedger(directory)).toEqual([{ id: 'a', attempt: 1, outcome: 'passed' }])
    })

    it('files the attempt before throwing, so a failure is still recorded', () => {
      try {
        runCase('a', [1])
      } catch {
        // The throw is the subject of the next assertion, not of this one.
      }

      expect(readLedger(directory)).toHaveLength(1)
    })

    it('files one soft error per extra error asked for, and still throws', () => {
      const soft: string[] = []

      expect(() => {
        runCase('a', [1], 3, { soft: (message) => soft.push(message) })
      }).toThrow('fails by plan')
      expect(soft).toHaveLength(2)
    })

    it('files no soft errors on an attempt that passes', () => {
      const soft: string[] = []

      runCase('a', [2], 3, { soft: (message) => soft.push(message) })

      expect(soft).toEqual([])
    })

    it('names the attempt in the error, so an artifact can be asked which attempt it kept', () => {
      runCase('a', [2])

      expect(() => {
        runCase('a', [2])
      }).toThrow('attempt 2')
    })
  })
})
