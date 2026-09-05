// @vitest-environment node
/**
 * The README, derived rather than trusted.
 *
 * Every number in `concurrency/README.md` comes from a live run of the matrix
 * or from a table in this directory, and this file reads the prose back and
 * checks it against them — the same move `determinism/readme.test.ts`,
 * `fuzz/readme.test.ts` and `snapshot/readme.test.ts` make. A rate nobody
 * re-derives goes on sounding right long after it stops being true, and a
 * README about the difference between "catches it" and "catches it 15% of the
 * time" is a poor place for a stale number.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { FAULT_IDS, type FaultId } from './faults.ts'
import { loadControl, loadFaulted } from './load.ts'
import {
  caughtBy,
  cellFor,
  controlFor,
  measure,
  rateOf,
  reliable,
  type Matrix,
} from './matrix.ts'
import { scenarioNamed, type ScenarioId } from './scenarios.ts'
import { explore, STRATEGIES, STRATEGY_IDS, type StrategyId } from './strategies.ts'

const here = new URL('.', import.meta.url)
const readme = readFileSync(fileURLToPath(new URL('./README.md', here)), 'utf8')

/** Every markdown table row, split into trimmed cells. */
const rows: readonly (readonly string[])[] = readme
  .split('\n')
  .filter((line) => line.startsWith('| '))
  .map((line) =>
    line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim()),
  )

const bare = (cell: string): string => cell.replaceAll('`', '').replaceAll('*', '')

const rowFor = (label: string): readonly string[] => {
  const found = rows.find((cells) => bare(cells[0] ?? '') === label)

  if (found === undefined) {
    throw new Error(`README has no table row for ${label}`)
  }

  return found
}

let matrix: Matrix

beforeAll(async () => {
  matrix = await measure()
}, 300_000)

describe('the strategy table', () => {
  it('lists every strategy the code defines, in order', () => {
    const listed = rows
      .map((cells) => bare(cells[0] ?? ''))
      .filter((label): label is StrategyId => (STRATEGY_IDS as readonly string[]).includes(label))

    expect(listed).toEqual([...STRATEGY_IDS])
  })

  it('quotes the trial count each strategy actually runs', () => {
    for (const strategy of STRATEGIES) {
      expect({ strategy: strategy.id, trials: rowFor(strategy.id)[3] }).toEqual({
        strategy: strategy.id,
        trials: String(strategy.trials),
      })
    }
  })

  it('quotes the executions each strategy actually pays per trial', () => {
    for (const strategy of STRATEGIES) {
      const cell = controlFor(matrix, strategy.id)

      expect({ strategy: strategy.id, executions: rowFor(strategy.id)[4] }).toEqual({
        strategy: strategy.id,
        executions: String(cell.executions / cell.trials),
      })
    }
  })

  it('says which strategies overlap their tasks', () => {
    for (const strategy of STRATEGIES) {
      expect({ strategy: strategy.id, overlap: rowFor(strategy.id)[1] }).toEqual({
        strategy: strategy.id,
        overlap: strategy.overlapping ? 'yes' : 'no',
      })
    }
  })
})

describe('the detection matrix', () => {
  it('lists every fault the corpus defines, in order', () => {
    const listed = rows
      .map((cells) => bare(cells[0] ?? ''))
      .filter((label): label is FaultId => (FAULT_IDS as readonly string[]).includes(label))

    expect(listed).toEqual([...FAULT_IDS])
  })

  it('prints the rate every strategy measured, to three decimals', () => {
    for (const fault of FAULT_IDS) {
      const printed = rowFor(fault).slice(1)
      const measured = STRATEGY_IDS.map((strategy) => rateOf(matrix, strategy, fault).toFixed(3))

      expect({ fault, printed }).toEqual({ fault, printed: measured })
    }
  })

  it('totals what each strategy reached', () => {
    expect(rowFor('reached').slice(1).map(bare)).toEqual(
      STRATEGY_IDS.map((strategy) => String(caughtBy(matrix, strategy).length)),
    )
  })

  it('totals what each strategy reached in every trial', () => {
    expect(rowFor('reached in every trial').slice(1).map(bare)).toEqual(
      STRATEGY_IDS.map((strategy) =>
        String(FAULT_IDS.filter((fault) => reliable(matrix, strategy, fault)).length),
      ),
    )
  })
})

describe('the interleaving-space table', () => {
  const columns: readonly (FaultId | null)[] = [
    null,
    'MUTEX_RELEASE_ALWAYS_CLEARS_HELD',
    'DEPOSIT_NOT_LOCKED',
    'MUTEX_NEVER_MARKED_HELD',
  ]

  const listed: readonly ScenarioId[] = [
    'two-deposits',
    'race-to-empty',
    'queued-writers',
    'late-arrival',
  ]

  it('counts the tree of every scenario it prints, for every variant it prints', async () => {
    for (const [column, fault] of columns.entries()) {
      const subject = fault === null ? await loadControl() : await loadFaulted(fault)

      for (const scenario of listed) {
        const attempt = await explore(subject, scenarioNamed(scenario))

        expect({ fault, scenario, printed: rowFor(scenario)[column + 1] }).toEqual({
          fault,
          scenario,
          printed: String(attempt.executions),
        })
      }
    }
  }, 120_000)

  it('totals the whole scenario set in the row that claims to', () => {
    const printed = rowFor('all eight').slice(1).map(bare)

    expect(printed[0]).toBe(String(controlFor(matrix, 'systematic').executions))

    for (const [index, fault] of columns.slice(1).entries()) {
      const cell = matrix.faulted.find(
        (entry) => entry.strategy === 'systematic' && entry.fault === fault,
      )

      expect({ fault, printed: printed[index + 1] }).toEqual({
        fault,
        printed: String(cell?.executions),
      })
    }
  })
})

describe('the prose', () => {
  it('names the two faults a Promise.all test misses', () => {
    for (const fault of FAULT_IDS.filter((id) => rateOf(matrix, 'concurrent', id) === 0)) {
      expect(readme).toContain(fault)
    }
  })

  it('quotes the runs a stress loop would need for the narrowest fault', () => {
    const rate = rateOf(matrix, 'jittered', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')

    expect(readme).toContain(`**${Math.ceil(Math.log(0.01) / Math.log(1 - rate))}** runs`)
  })

  // The schedule printed as an example of what a controlled run hands back. It
  // is a real one, and this is what keeps it real.
  it('quotes a schedule the run actually recorded', () => {
    const witness = cellFor(matrix, 'schedule', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD').witness

    expect(readme).toContain(`choices: [${(witness?.choices ?? []).join(', ')}]`)
  })

  it('quotes the size of the correct ledger interleaving space', () => {
    expect(readme).toContain(`**${controlFor(matrix, 'systematic').executions} runs**`)
  })

  it('lists every module in the directory that is not a test', () => {
    const modules = readdirSync(fileURLToPath(here))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort()

    for (const module of modules) {
      expect(readme).toContain(`| \`${module}\` |`)
    }
  })
})
