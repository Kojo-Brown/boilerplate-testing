/**
 * What each strategy costs per test, measured rather than reasoned about.
 *
 * ---------------------------------------------------------------------------
 * What is being timed, and what is deliberately not
 * ---------------------------------------------------------------------------
 * Only `beginTest` and `endTest` — the isolating — with a body that is one
 * trivial statement. The body is there so the loop is a test rather than a
 * micro-benchmark of a hook, and it is trivial so it does not drown what is
 * being compared. A strategy's per-test cost is paid once per test forever, so
 * it is the number that decides between two strategies that are otherwise
 * equivalent, and it is the number most often asserted from folklore: "template
 * databases are too slow" and "rollback is free" are both claims about this
 * table and both are approximately right for reasons that are not the ones
 * usually given.
 *
 * The run is **serial**, unlike the detection and leakage matrices, and that is
 * the whole reason this is its own module. Those matrices measure booleans and
 * can overlap eight runs on one server; a millisecond figure taken while seven
 * other runs are competing for the same buffer cache is a measurement of the
 * harness.
 *
 * ---------------------------------------------------------------------------
 * Median, not mean
 * ---------------------------------------------------------------------------
 * The first iteration of every strategy is an outlier by construction — an
 * empty buffer cache, a cold plan cache, a connection whose TCP window has not
 * opened — and a mean over twenty iterations lets that one iteration move the
 * figure by more than the difference being measured. The median is reported and
 * the minimum and maximum go with it, so a reader can see the spread rather
 * than take the summary on trust.
 */

import type { Server, Strategy } from './strategies.ts'
import { connect, STRATEGIES } from './strategies.ts'

/** Iterations per strategy. */
export const ITERATIONS = 20

export interface Cost {
  readonly strategy: string
  /** Milliseconds in `beginTest` + `endTest`, one entry per iteration. */
  readonly perTestMs: readonly number[]
  readonly medianMs: number
  readonly minMs: number
  readonly maxMs: number
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    throw new Error('No values to take a median of')
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0)
}

/** Time one strategy's isolation, serially. */
export async function measureStrategy(
  server: Server,
  strategy: Strategy,
  nonce: string,
  iterations = ITERATIONS,
): Promise<Cost> {
  const database = `cost_${strategy.key}_${nonce}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const admin = await connect(server.adminUri)

  await admin.client.query(`create database ${database}`)

  const perTestMs: number[] = []

  try {
    const run = await strategy.open(server, database)

    try {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const startedAt = performance.now()
        const env = await run.beginTest()
        const afterBegin = performance.now()

        // The body. One statement, so the figure is the isolating.
        await env.db.query('select 1')

        const beforeEnd = performance.now()

        await run.endTest()

        perTestMs.push(afterBegin - startedAt + (performance.now() - beforeEnd))
      }
    } finally {
      await run.close()
    }
  } finally {
    await admin.client.query(`drop database if exists ${database} with (force)`)
    await admin.end()
  }

  return {
    strategy: strategy.key,
    perTestMs,
    medianMs: median(perTestMs),
    minMs: Math.min(...perTestMs),
    maxMs: Math.max(...perTestMs),
  }
}

/** Every strategy, one after another. */
export async function measureCosts(server: Server, nonce: string, iterations = ITERATIONS): Promise<readonly Cost[]> {
  const costs: Cost[] = []

  for (const strategy of STRATEGIES) {
    costs.push(await measureStrategy(server, strategy, nonce, iterations))
  }

  return costs
}

/**
 * The label for the baseline row: opening a connection and closing it, with no
 * isolating at all.
 *
 * This row is why the cost table is worth having rather than guessable. Five of
 * the seven strategies hand each test a fresh connection and the two rollback
 * strategies cannot, so the rollback column is not merely "the cheap reset" —
 * it is the only column that does not pay for a connection, and most of its
 * advantage is that rather than the rollback. Without this row the reader has
 * no way to separate the two, and "transaction rollback is ten times faster
 * than truncating" survives as a statement about `TRUNCATE`.
 */
export const CONNECT_ONLY = 'connect-only'

/** Time opening and closing a connection, and nothing else. */
export async function measureConnection(server: Server, nonce: string, iterations = ITERATIONS): Promise<Cost> {
  const database = `cost_baseline_${nonce}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const admin = await connect(server.adminUri)

  await admin.client.query(`create database ${database}`)

  const perTestMs: number[] = []

  try {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const startedAt = performance.now()
      const connection = await connect(server.uriFor(database))

      await connection.end()
      perTestMs.push(performance.now() - startedAt)
    }
  } finally {
    await admin.client.query(`drop database if exists ${database} with (force)`)
    await admin.end()
  }

  return {
    strategy: CONNECT_ONLY,
    perTestMs,
    medianMs: median(perTestMs),
    minMs: Math.min(...perTestMs),
    maxMs: Math.max(...perTestMs),
  }
}

/**
 * The cost claims, as orderings rather than milliseconds.
 *
 * A table of absolute figures is a screenshot: the numbers below were taken on
 * one machine, the CI runner is slower and somebody's laptop is faster, and a
 * test that pinned them would be red on arrival. What survives a change of
 * machine is the *ordering*, and only where the gap is large enough that a
 * slower machine scales both sides of it.
 *
 * So each claim names a pair with a multiple between them, not neighbours.
 * `truncate-restart` against `truncate` is deliberately absent: 15.2ms against
 * 13.0ms is a real difference and not a robust one, and a claim that flips on a
 * noisy runner teaches the next person to re-run the job rather than read it.
 */
export interface CostOrdering {
  readonly cheaper: string
  readonly dearer: string
  readonly why: string
}

export const COST_ORDERINGS: readonly CostOrdering[] = [
  {
    cheaper: 'rollback-savepoint',
    dearer: 'none',
    why: 'The rollback family holds one connection for the whole run. `none` does nothing at all between tests and is still dearer, because it reconnects.',
  },
  {
    cheaper: 'rollback',
    dearer: 'truncate',
    why: 'The comparison usually quoted, and the baseline row says most of the gap is the connection rather than the TRUNCATE.',
  },
  {
    cheaper: 'none',
    dearer: 'truncate',
    why: 'What the TRUNCATE itself costs, with the connection on both sides of the subtraction.',
  },
  {
    cheaper: 'truncate',
    dearer: 'truncate-derived',
    why: 'Asking `information_schema` which tables exist costs a catalogue query per test, which is the price of the list not going stale.',
  },
  {
    cheaper: 'truncate-derived',
    dearer: 'schema-per-test',
    why: 'A schema per test re-runs the whole DDL per test; the truncate columns run it once per database.',
  },
  {
    cheaper: 'schema-per-test',
    dearer: 'template-db',
    why: 'Cloning a database copies its files; creating a schema writes catalogue rows. Both restore the catalogue, and one is dearer for it.',
  },
]

export const costFor = (costs: readonly Cost[], strategy: string): Cost => {
  const cost = costs.find((candidate) => candidate.strategy === strategy)

  if (cost === undefined) {
    throw new Error(`No cost measurement for ${strategy}`)
  }

  return cost
}
