/**
 * The measurement: every wiring against every scenario, against a real broker.
 *
 * Named `*.broker.test.ts` for the same reason `containers/` names its suites
 * `*.container.test.ts` — it needs a service this repository must never
 * require of `pnpm test`. Without `PACT_BROKER_BASE_URL` the suite skips
 * itself and says why; CI always has one.
 *
 * The whole matrix is derived once in `beforeAll` because a cell costs a
 * verification and several broker round trips, and the assertions below are
 * questions about the finished table rather than about any one cell.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveBroker } from '../broker/resolve'
import type { PactBrokerClient } from '../broker/client'
import { contractsFor, runCell } from './run'
import { SCENARIOS, type Scenario } from './scenarios'
import { STRATEGIES, type Cell, type StrategyId } from './strategies'
import { formatCell, readmeMatrix, readmeStrategies, readmeTotals } from './readme'

const resolution = await resolveBroker()
const broker = resolution.kind === 'available' ? resolution.client : undefined

const cells: Cell[] = []

/** Looks one cell up. Throws rather than returning undefined: a missing cell
 * is a harness bug and must not read as a passing assertion. */
function cell(strategy: StrategyId, scenario: string): Cell {
  const found = cells.find((c) => c.strategy === strategy && c.scenario === scenario)
  if (!found) throw new Error(`No cell for ${strategy} × ${scenario}`)
  return found
}

/** The scenario with this id. Throws: a typo must not silently pass. */
function scenarioById(id: string): Scenario {
  const found = SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`No scenario ${id}`)
  return found
}

/** Every cell for one strategy. */
function column(strategy: StrategyId): readonly Cell[] {
  return cells.filter((c) => c.strategy === strategy)
}

function verdicts(strategy: StrategyId): Record<Cell['verdict'], number> {
  const tally: Record<Cell['verdict'], number> = {
    caught: 0,
    missed: 0,
    quiet: 0,
    'false-alarm': 0,
  }
  for (const c of column(strategy)) tally[c.verdict] += 1
  return tally
}

describe.skipIf(!broker)('Contract-testing wirings — pipeline matrix', () => {
  beforeAll(async () => {
    const client = broker as PactBrokerClient
    const dir = mkdtempSync(join(tmpdir(), 'pact-pipeline-'))

    for (const scenario of SCENARIOS) {
      const contracts = contractsFor(scenario)

      // The two file strategies read documents, not a broker. `stale` is the
      // baseline — what the provider's repository holds from before the
      // consumer changed anything — and `fresh` is the contract the consumer
      // publishes in this scenario. For the nine provider-side scenarios the
      // two are the same document, which is the point rather than an
      // oversight.
      const files = {
        stale: join(dir, `${scenario.id}-stale.json`),
        fresh: join(dir, `${scenario.id}-fresh.json`),
      }
      writeFileSync(files.stale, JSON.stringify(contracts.baseline))
      writeFileSync(files.fresh, JSON.stringify(contracts.changed))

      for (const strategy of STRATEGIES) {
        cells.push(await runCell(client, strategy, scenario, files, contracts))
      }
    }
  }, 600_000)

  it('runs every wiring against every scenario', () => {
    expect(cells).toHaveLength(STRATEGIES.length * SCENARIOS.length)
  })

  it('prints the matrix', () => {
    const symbol: Record<Cell['verdict'], string> = {
      caught: 'C',
      missed: 'M',
      quiet: '.',
      'false-alarm': 'F',
    }
    const width = Math.max(...SCENARIOS.map((s) => s.id.length))
    const header = ['SCENARIO'.padEnd(width), ...STRATEGIES.map((s) => s.id.padEnd(14))].join(' ')
    const rows = SCENARIOS.map((scenario) =>
      [
        scenario.id.padEnd(width),
        ...STRATEGIES.map((strategy) => {
          const c = cell(strategy.id, scenario.id)
          return `${symbol[c.verdict]} ${c.stage}`.padEnd(14)
        }),
      ].join(' '),
    )
    // Every cell that is not the answer a person would want, with the
    // broker's or the verifier's own sentence. A matrix of letters says which
    // cells to argue about; this says what to argue about them with.
    const notable = cells
      .filter((c) => c.verdict === 'missed' || c.verdict === 'false-alarm')
      .map((c) => `  ${c.verdict.padEnd(11)} ${c.strategy.padEnd(14)} ${c.scenario}: ${c.detail}`)

    // The table is the artefact this suite produces: the assertions below
    // check it, and the log is what a person reads when one of them fails.
    console.log(['', header, ...rows, '', ...notable, ''].join('\n'))
    expect(rows).toHaveLength(SCENARIOS.length)
  })

  // -------------------------------------------------------------------------
  // The control
  // -------------------------------------------------------------------------

  it('leaves every wiring quiet when nothing changed', () => {
    for (const strategy of STRATEGIES) {
      expect(cell(strategy.id, 'NOTHING_CHANGED')).toMatchObject({
        verdict: 'quiet',
        stage: 'none',
      })
    }
  })

  it('lets a provider add a field without any wiring objecting', () => {
    for (const strategy of STRATEGIES) {
      expect(cell(strategy.id, 'EXTRA_FIELD_ADDED').verdict).toBe('quiet')
    }
  })

  // -------------------------------------------------------------------------
  // The findings
  // -------------------------------------------------------------------------

  it('scores every provider-side change identically across all four wirings', () => {
    // The seven scenarios where the provider edits its service and the
    // contract does not move. If a broker ever starts catching one of these
    // that a current pact file does not, the README's first finding is wrong.
    const providerSide = SCENARIOS.filter(
      (scenario) => scenario.contract === 'baseline' && scenario.id !== 'NOTHING_CHANGED',
    )
    expect(providerSide).toHaveLength(8)

    for (const scenario of providerSide) {
      const verdictsAcross = STRATEGIES.map((s) => cell(s.id, scenario.id).verdict)
      expect(new Set(verdictsAcross).size, `${scenario.id} is scored differently by wiring`).toBe(1)
    }
  })

  it('misses a stringified id under every wiring', () => {
    for (const strategy of STRATEGIES) {
      expect(cell(strategy.id, 'USER_ID_STRINGIFIED').verdict).toBe('missed')
    }
  })

  it('catches as many breaking changes with a stale file as with a fresh one', () => {
    // Equal totals, different cells. The point of the pair is that copying the
    // file more often trades one error for another rather than removing one.
    expect(verdicts('files-stale').caught).toBe(verdicts('files-fresh').caught)
    expect(cell('files-stale', 'CONSUMER_ADDED_EXPECTATION').verdict).toBe('missed')
    expect(cell('files-fresh', 'CONSUMER_ADDED_EXPECTATION').verdict).toBe('caught')
    expect(cell('files-stale', 'LOGOUT_RETIRED_EARLY').verdict).toBe('caught')
    expect(cell('files-fresh', 'LOGOUT_RETIRED_EARLY').verdict).toBe('missed')
  })

  it('raises a false alarm on a completed retirement only with a stale file', () => {
    expect(cell('files-stale', 'LOGOUT_RETIRED').verdict).toBe('false-alarm')
    for (const strategy of STRATEGIES.filter((s) => s.id !== 'files-stale')) {
      expect(cell(strategy.id, 'LOGOUT_RETIRED').verdict).toBe('quiet')
    }
  })

  it('separates the two retirement orderings only in the broker columns', () => {
    // The two scenarios differ in one field — which consumer version is
    // deployed — so a wiring that scores them the same cannot read it.
    for (const strategy of STRATEGIES.filter((s) => s.usesBroker)) {
      expect(cell(strategy.id, 'LOGOUT_RETIRED').verdict).toBe('quiet')
      expect(cell(strategy.id, 'LOGOUT_RETIRED_EARLY').verdict).toBe('caught')
    }
    // Each file column gets exactly one of the pair right, and a different one.
    expect(cell('files-stale', 'LOGOUT_RETIRED_EARLY').verdict).toBe('caught')
    expect(cell('files-stale', 'LOGOUT_RETIRED').verdict).toBe('false-alarm')
    expect(cell('files-fresh', 'LOGOUT_RETIRED_EARLY').verdict).toBe('missed')
    expect(cell('files-fresh', 'LOGOUT_RETIRED').verdict).toBe('quiet')
  })

  it('moves one cell from the provider build to the deploy gate when pending is on', () => {
    const differing = SCENARIOS.filter(
      (s) => cell('broker', s.id).stage !== cell('broker-pending', s.id).stage,
    ).map((s) => s.id)

    expect(differing).toEqual(['CONSUMER_ADDED_EXPECTATION'])
    expect(cell('broker', 'CONSUMER_ADDED_EXPECTATION').stage).toBe('provider-ci')
    expect(cell('broker-pending', 'CONSUMER_ADDED_EXPECTATION').stage).toBe('deploy-gate')
    // Detection is unchanged: it is the same finding, reported to the team
    // that caused it.
    expect(cell('broker-pending', 'CONSUMER_ADDED_EXPECTATION').verdict).toBe('caught')
  })

  it('reaches the deploy gate only where a deploy gate exists', () => {
    for (const strategy of STRATEGIES.filter((s) => !s.hasDeployGate)) {
      for (const c of column(strategy.id)) expect(c.stage).not.toBe('deploy-gate')
    }
  })

  // -------------------------------------------------------------------------
  // The README
  // -------------------------------------------------------------------------

  it('agrees with the matrix written down in pact/README.md', () => {
    const documented = readmeMatrix()
    expect(readmeStrategies()).toEqual(STRATEGIES.map((s) => s.id))
    expect(documented.map((row) => row.scenario)).toEqual(SCENARIOS.map((s) => s.id))

    for (const row of documented) {
      expect(row.truth, `${row.scenario} ground truth`).toBe(scenarioById(row.scenario).truth)
      for (const strategy of STRATEGIES) {
        expect(row.cells[strategy.id], `${row.scenario} × ${strategy.id}`).toBe(
          formatCell(cell(strategy.id, row.scenario)),
        )
      }
    }
  })

  it('agrees with the totals written down in pact/README.md', () => {
    const documented = readmeTotals()
    expect(documented.map((row) => row.strategy)).toEqual(STRATEGIES.map((s) => s.id))

    for (const row of documented) {
      const tally = verdicts(row.strategy as StrategyId)
      expect(
        { caught: row.caught, missed: row.missed, falseAlarms: row.falseAlarms },
        `totals for ${row.strategy}`,
      ).toEqual({
        caught: tally.caught,
        missed: tally.missed,
        falseAlarms: tally['false-alarm'],
      })
    }
  })
})
