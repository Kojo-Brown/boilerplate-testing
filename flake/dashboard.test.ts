/**
 * The dashboard, rendered against histories chosen to exercise each decision
 * it makes about what to show.
 *
 * A renderer is cheap to test and easy to leave untested, and the reason not to
 * here is that three of its choices are arguments: that a broken test is shown
 * differently from a flaky one, that the trend is drawn per run with three
 * states rather than two, and that a test which has never failed is left out
 * of the table altogether.
 */

import { describe, expect, it } from 'vitest'

import { renderDashboard, renderQuarantine, sparkline } from '@/flake/dashboard'
import type { Attempt } from '@/flake/attempts'
import { summarise } from '@/flake/history'
import type { Judgement, QuarantineEntry } from '@/flake/quarantine'

const attempts = (name: string, runs: readonly (readonly ('passed' | 'failed')[])[]): readonly Attempt[] =>
  runs.flatMap((outcomes, runIndex) =>
    outcomes.map((outcome, index) => ({
      run: `r${String(runIndex + 1)}`,
      runner: 'vitest' as const,
      module: 'm.test.ts',
      name,
      attempt: index + 1,
      outcome,
      ...(outcome === 'failed' ? { error: 'Error: timed out waiting for the stream' } : {}),
    })),
  )

const entry: QuarantineEntry = {
  module: 'm.test.ts',
  name: 'flaky one',
  runner: 'vitest',
  reason: 'races with the fixture poll',
  owner: '@someone',
  ticket: 'FLAKE-1',
  addedOn: '2026-10-01',
  expiresOn: '2026-11-01',
}

const judgement = (overrides: Partial<Judgement> = {}): Judgement => ({
  entry,
  decision: 'hold',
  because: 'flaky in 2 of 5 runs, expires 2026-11-01',
  classification: 'flaky',
  ...overrides,
})

const render = (input: {
  histories?: readonly Attempt[]
  judgements?: readonly Judgement[]
}): string =>
  renderDashboard({
    histories: summarise(input.histories ?? []),
    judgements: input.judgements ?? [],
    runs: 5,
    generatedOn: '2026-10-14',
  })

describe('renderDashboard', () => {
  it('leaves a test that has never failed out of the table', () => {
    const output = render({ histories: attempts('always green', [['passed'], ['passed']]) })

    expect(output).toContain('No test failed an attempt')
    expect(output).not.toContain('always green')
  })

  it('marks a flaky test and a broken test differently', () => {
    const output = render({
      histories: [
        ...attempts('flaky one', [['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']]),
        ...attempts('broken one', Array.from({ length: 6 }, () => ['failed' as const])),
      ],
    })

    expect(output).toContain('🟠 flaky')
    expect(output).toContain('🔴 broken')
  })

  it('puts the flaky test above the broken one, which has the higher rate', () => {
    const output = render({
      histories: [
        ...attempts('broken one', Array.from({ length: 6 }, () => ['failed' as const])),
        ...attempts('flaky one', [['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']]),
      ],
    })

    expect(output.indexOf('flaky one')).toBeLessThan(output.indexOf('broken one'))
  })

  it('counts flaked runs rather than attempts, because a reader thinks in builds', () => {
    const output = render({
      histories: attempts('flaky one', [['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']]),
    })

    expect(output).toContain('2/5')
  })

  it('shows the last failure, truncated, with its pipes escaped', () => {
    const output = render({
      histories: [
        {
          run: 'r1',
          runner: 'vitest',
          module: 'm.test.ts',
          name: 'flaky one',
          attempt: 1,
          outcome: 'failed',
          error: `a | b ${'long '.repeat(30)}`,
        },
        ...attempts('flaky one', [['passed']]),
      ],
    })

    expect(output).toContain('a \\| b')
    expect(output).toContain('…')
  })

  it('marks a test that is in the registry as quarantined', () => {
    const output = render({
      histories: attempts('flaky one', [['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']]),
      judgements: [judgement()],
    })

    expect(output).toContain('_(quarantined)_')
  })

  it('reports an empty registry as empty rather than omitting the section', () => {
    expect(render({})).toContain('The registry is empty.')
  })

  it('says how many runs the window covers', () => {
    expect(render({})).toContain('over 5 runs')
  })

  it('has no single headline percentage for the suite', () => {
    // A rate over a whole suite goes down when somebody adds a thousand
    // stable tests, which makes it a measure of suite size.
    const output = render({ histories: attempts('flaky one', [['failed', 'passed'], ['passed']]) })

    expect(output).not.toMatch(/suite.*\d+(\.\d+)?%/i)
  })
})

describe('renderQuarantine', () => {
  it('names every entry and what the automation says about it', () => {
    const output = renderQuarantine([judgement()]).join('\n')

    expect(output).toContain('flaky one')
    expect(output).toContain('⏳ hold')
    expect(output).toContain('@someone')
  })

  it('says how many entries need action when any do', () => {
    const output = renderQuarantine([judgement(), judgement({ decision: 'release', because: 'green for a month' })]).join('\n')

    expect(output).toContain('1 entry needs action')
  })

  it('says nothing about action when every entry is a hold', () => {
    expect(renderQuarantine([judgement()]).join('\n')).not.toContain('needs action')
  })

  it('has a mark for all six decisions', () => {
    const decisions: readonly Judgement['decision'][] = ['hold', 'release', 'escalate', 'expired', 'orphan', 'unevidenced']
    const output = renderQuarantine(decisions.map((decision) => judgement({ decision }))).join('\n')

    expect(output).not.toContain('undefined')
    expect(output.split('\n').filter((line) => line.startsWith('| `flaky one`'))).toHaveLength(6)
  })
})

describe('sparkline', () => {
  it('draws a run that passed outright, one that needed a retry, and one that failed differently', () => {
    expect(
      sparkline([
        { run: 'a', ended: 'passed', retried: false },
        { run: 'b', ended: 'passed', retried: true },
        { run: 'c', ended: 'failed', retried: true },
      ]),
    ).toBe('·!×')
  })

  it('draws nothing for a test with no runs', () => {
    expect(sparkline([])).toBe('')
  })
})
