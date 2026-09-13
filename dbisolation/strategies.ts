/**
 * The seven ways a suite can stop one test's writes from reaching the next.
 *
 * ---------------------------------------------------------------------------
 * What the columns are, and why there are two rollback columns
 * ---------------------------------------------------------------------------
 * The item this directory answers names three strategies — truncate,
 * transaction rollback, template database — and the three turn out not to be
 * comparable as stated, because "transaction rollback" is two different things
 * and only one of them works.
 *
 *   - `rollback` is the one people describe: `BEGIN` before the test, `ROLLBACK`
 *     after. It is correct for a subject that issues one statement and it is
 *     *not an isolation strategy at all* for a subject that opens its own
 *     transaction, because Postgres has no nested `BEGIN`: the subject's
 *     `BEGIN` warns and is a no-op, and its `COMMIT` commits the harness's
 *     transaction along with everything in it. Measured in
 *     `mechanism.container.test.ts`, where the wrapper's `ROLLBACK` gets
 *     `WARNING: there is no transaction in progress` and the rows survive.
 *   - `rollback-savepoint` is the one every framework actually ships — Rails'
 *     `use_transactional_tests`, Django's `TestCase`, `pytest-django` — where
 *     the connection adapter rewrites the subject's transaction control into
 *     savepoints. It isolates correctly. What it costs is the subject of the
 *     detection matrix.
 *
 * Collapsing those two into one row is the single most common error in
 * write-ups of this comparison, and it is not a pedantic distinction: the naive
 * version passes its own tests, because a suite whose isolation has silently
 * stopped working is green until two tests happen to collide.
 *
 * ---------------------------------------------------------------------------
 * Connection topology is the hidden axis
 * ---------------------------------------------------------------------------
 * Five of the seven give each test a fresh connection, which is what a pool
 * does and what production does. The two rollback strategies cannot: the
 * transaction they are holding open lives on one connection, and anything the
 * subject does on a second connection is outside it. That is not an
 * implementation detail of this directory — it is the constraint the strategy
 * places on every piece of code the suite will ever test, and
 * {@link Strategy.singleConnection} is where the matrix gets it from.
 *
 * Ending a connection rather than issuing a reset is also what makes
 * `NEVER_COMMITS` detectable rather than merely untidy: a connection closed
 * with a transaction open aborts it, which is exactly what a pool does with a
 * checked-in connection and exactly what happens in production when a request
 * dies half way through.
 */

import pg from 'pg'

import type { Queryable } from './orders.ts'
import { savepointRewriting } from './rewrite.ts'
import { applySchema, seed, tablesInSchema, truncateStatement, TRUNCATED_TABLES } from './schema.ts'

/** A Postgres server, addressed one database at a time. */
export interface Server {
  /** The database the container shipped, used for `CREATE DATABASE` and nothing else. */
  readonly adminUri: string
  /** The same server, a different database. */
  uriFor(database: string): string
}

/** Build a {@link Server} from a connection URI. */
export function serverAt(adminUri: string): Server {
  return {
    adminUri,
    uriFor(database) {
      const url = new URL(adminUri)

      url.pathname = `/${database}`

      return url.toString()
    },
  }
}

/**
 * Where a test's data lives, for anyone who wants to look at it from outside.
 *
 * The two fields are the two namespaces a strategy can put a test in, and they
 * are why `observe` is on the environment rather than a free function: under
 * `template-db` the answer is a different database and under `schema-per-test`
 * it is a different `search_path`, and a behaviour that had to know which would
 * be testing the harness.
 */
export interface Placement {
  readonly uri: string
  readonly searchPath: string | null
}

/** One test's world. */
export interface TestEnv {
  /** The connection the code under test is given. */
  readonly db: Queryable
  /** Where this test's data is, for {@link observe}. */
  readonly placement: Placement
  /**
   * Run something on an independent connection to the same database.
   *
   * Always a real second session, including under the rollback strategies where
   * it will not be able to see the test's uncommitted writes. Handing those
   * strategies the same connection would make the matrix green by definition
   * and delete the finding.
   */
  observe<T>(use: (client: pg.Client) => Promise<T>): Promise<T>
}

/** A strategy, opened against one database, ready to run tests. */
export interface StrategyRun {
  beginTest(): Promise<TestEnv>
  endTest(): Promise<void>
  close(): Promise<void>
}

export const FAMILIES = ['none', 'truncate', 'rollback', 'namespace', 'database'] as const

export type Family = (typeof FAMILIES)[number]

export interface Strategy {
  readonly key: string
  readonly family: Family
  /** One line for the README table. */
  readonly summary: string
  /** Whether the code under test is pinned to a single connection for the run. */
  readonly singleConnection: boolean
  /** Prepare a run against a database the harness has already created. */
  open(server: Server, database: string): Promise<StrategyRun>
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * Connect, with the socket-level error listener attached before anything can
 * emit one.
 *
 * `pg.Client` is an `EventEmitter` and an `error` event with no listener is an
 * unhandled error that takes the process down. A connection this directory
 * drops on purpose — `template-db` ends a client so it can drop the database
 * underneath it — is exactly the case that emits one. The handler records
 * rather than swallows: a query that fails still rejects, so nothing is hidden,
 * and `lastSocketError` is there for a failure that would otherwise be reported
 * as a timeout with no cause.
 */
export interface Connection {
  readonly client: pg.Client
  lastSocketError(): Error | null
  end(): Promise<void>
}

export async function connect(uri: string, searchPath: string | null = null): Promise<Connection> {
  const client = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 10_000 })
  let socketError: Error | null = null

  client.on('error', (error: Error) => {
    socketError = error
  })

  await client.connect()

  if (searchPath !== null) {
    await client.query(`set search_path to ${searchPath}`)
  }

  return {
    client,
    lastSocketError: () => socketError,
    end: async () => {
      try {
        await client.end()
      } catch {
        // A client whose database has just been dropped, or whose transaction
        // was aborted by the server, rejects `end()`. There is nothing left to
        // clean up in either case and the test has already had its answer.
      }
    },
  }
}

/** A `pg.Client` as the narrow thing the subject takes. */
export const queryable = (client: pg.Client): Queryable => ({
  query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
})

const observeAt = (placement: Placement) =>
  async function observe<T>(use: (client: pg.Client) => Promise<T>): Promise<T> {
    const connection = await connect(placement.uri, placement.searchPath)

    try {
      return await use(connection.client)
    } finally {
      await connection.end()
    }
  }

// ---------------------------------------------------------------------------
// The connection-per-test family
// ---------------------------------------------------------------------------

/**
 * Everything that hands each test a fresh connection to one long-lived
 * database, parameterised by what it does to the data in between.
 *
 * `none`, both `truncate` columns and `truncate-derived` differ in that one
 * function and in nothing else, which is the only way the cost column means
 * anything: a difference of eight milliseconds between two rows here is the
 * `TRUNCATE`, because there is nothing else it could be.
 */
function perConnectionStrategy(
  key: string,
  family: Family,
  summary: string,
  reset: (db: Queryable) => Promise<void>,
): Strategy {
  return {
    key,
    family,
    summary,
    singleConnection: false,
    async open(server, database) {
      const placement: Placement = { uri: server.uriFor(database), searchPath: null }
      const setup = await connect(placement.uri)

      await applySchema(queryable(setup.client))
      await setup.end()

      let current: Connection | null = null

      return {
        async beginTest() {
          const connection = await connect(placement.uri)

          current = connection

          const db = queryable(connection.client)

          await reset(db)
          await seed(db)

          return { db, placement, observe: observeAt(placement) }
        },
        async endTest() {
          const connection = current

          current = null

          // Ending the connection is the reset. A transaction the subject left
          // open is aborted by the server when the socket closes, which is what
          // a pool does on check-in and what a dead request does in production.
          await connection?.end()
        },
        async close() {
          await current?.end()
          current = null
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// The rollback family
// ---------------------------------------------------------------------------
// The substitution itself is `rewrite.ts`, which is a pure function over a
// `Queryable` and imports no driver. That is not tidiness: it is eight lines
// deciding five cells of the detection matrix, and a module that needs a
// Postgres to test is a module tested once per CI run in the job most
// contributors cannot run.

function rollbackStrategy(key: string, summary: string, rewrite: boolean): Strategy {
  return {
    key,
    family: 'rollback',
    summary,
    singleConnection: true,
    async open(server, database) {
      const placement: Placement = { uri: server.uriFor(database), searchPath: null }
      const held = await connect(placement.uri)

      await applySchema(queryable(held.client))

      return {
        async beginTest() {
          await held.client.query('begin')

          const db = rewrite ? savepointRewriting(queryable(held.client)) : queryable(held.client)

          // Seeded inside the wrapper transaction, like everything else the
          // test does, so the reference rows are rolled back with it.
          await seed(db)

          return { db, placement, observe: observeAt(placement) }
        },
        async endTest() {
          // `rollback` unconditionally, including when the subject has already
          // ended the wrapper transaction on us. Postgres answers a rollback
          // outside a transaction with a warning and success, which is exactly
          // how the naive strategy manages to look like it is working.
          await held.client.query('rollback')
        },
        async close() {
          await held.end()
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// The namespace family
// ---------------------------------------------------------------------------

const schemaPerTest: Strategy = {
  key: 'schema-per-test',
  family: 'namespace',
  summary: 'A schema per test, created with the full DDL and dropped after. The namespace `containers/` recommends.',
  singleConnection: false,
  async open(server, database) {
    const uri = server.uriFor(database)
    let counter = 0
    let current: { readonly connection: Connection; readonly schema: string } | null = null

    return {
      async beginTest() {
        counter += 1

        const schema = `t_${counter}`
        const connection = await connect(uri)

        await connection.client.query(`create schema ${schema}`)
        await connection.client.query(`set search_path to ${schema}`)

        const db = queryable(connection.client)

        await applySchema(db)
        await seed(db)

        current = { connection, schema }

        return { db, placement: { uri, searchPath: schema }, observe: observeAt({ uri, searchPath: schema }) }
      },
      async endTest() {
        const held = current

        current = null

        if (held === null) {
          return
        }

        try {
          await held.connection.client.query('rollback')
          await held.connection.client.query(`drop schema if exists ${held.schema} cascade`)
        } catch {
          // A subject that left an aborted transaction behind cannot run the
          // drop. Ending the connection below releases the schema; the next
          // run's database is new, so nothing accumulates across runs.
        }

        await held.connection.end()
      },
      async close() {
        await current?.connection.end()
        current = null
      },
    }
  },
}

// ---------------------------------------------------------------------------
// The database family
// ---------------------------------------------------------------------------

/**
 * A database per test, cloned from a template.
 *
 * The database the harness handed this strategy becomes the *template*: the DDL
 * is applied to it once and it is never written to again, so every test starts
 * from a byte-for-byte copy of a known database rather than from a reset of a
 * used one. That is the property nothing else in this file has — it restores
 * the catalogue, not just the rows — and the reason the cost column matters.
 *
 * `STRATEGY` is deliberately left at the server's default. It is `WAL_LOG` from
 * Postgres 15 on, and that default is the reason the famous template-database
 * error — 55006, "source database is being accessed by other users" — no longer
 * fires for a template a suite is also connected to. `mechanism.container.test.ts`
 * measures both halves, because a directory that repeated the folklore here
 * would be repeating something that stopped being true three majors ago.
 */
const templateDb: Strategy = {
  key: 'template-db',
  family: 'database',
  summary: 'A database per test, cloned with `CREATE DATABASE … TEMPLATE`, dropped after.',
  singleConnection: false,
  async open(server, database) {
    const setup = await connect(server.uriFor(database))

    await applySchema(queryable(setup.client))
    await setup.end()

    const admin = await connect(server.adminUri)
    let counter = 0
    let current: { readonly connection: Connection; readonly database: string } | null = null

    return {
      async beginTest() {
        counter += 1

        const clone = `${database}_c${counter}`

        await admin.client.query(`create database ${clone} template ${database}`)

        const uri = server.uriFor(clone)
        const connection = await connect(uri)
        const db = queryable(connection.client)

        await seed(db)

        current = { connection, database: clone }

        return { db, placement: { uri, searchPath: null }, observe: observeAt({ uri, searchPath: null }) }
      },
      async endTest() {
        const held = current

        current = null

        if (held === null) {
          return
        }

        await held.connection.end()
        await admin.client.query(`drop database if exists ${held.database} with (force)`)
      },
      async close() {
        if (current !== null) {
          await current.connection.end()
          await admin.client.query(`drop database if exists ${current.database} with (force)`)
          current = null
        }

        await admin.end()
      },
    }
  },
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const STRATEGIES: readonly Strategy[] = [
  perConnectionStrategy(
    'none',
    'none',
    'Nothing between tests. The control, and the row every other column has to beat.',
    async () => {},
  ),
  perConnectionStrategy(
    'truncate',
    'truncate',
    '`TRUNCATE` the tables somebody listed, from a list written once and not since.',
    async (db) => void (await db.query(truncateStatement([...TRUNCATED_TABLES], false))),
  ),
  perConnectionStrategy(
    'truncate-restart',
    'truncate',
    'The same statement plus `RESTART IDENTITY`, which is the half people leave off.',
    async (db) => void (await db.query(truncateStatement([...TRUNCATED_TABLES], true))),
  ),
  perConnectionStrategy(
    'truncate-derived',
    'truncate',
    'The same statement again, over the tables `information_schema` says exist right now.',
    async (db) => {
      const tables = await tablesInSchema(db)

      if (tables.length > 0) {
        await db.query(truncateStatement(tables, true))
      }
    },
  ),
  rollbackStrategy(
    'rollback',
    '`BEGIN` before the test, `ROLLBACK` after, and nothing between the subject and the connection.',
    false,
  ),
  rollbackStrategy(
    'rollback-savepoint',
    'The same wrapper, with the subject’s own `BEGIN`/`COMMIT` rewritten into savepoints.',
    true,
  ),
  schemaPerTest,
  templateDb,
]

export const strategyFor = (key: string): Strategy => {
  const strategy = STRATEGIES.find((candidate) => candidate.key === key)

  if (strategy === undefined) {
    throw new Error(`No strategy named ${key}`)
  }

  return strategy
}

export const STRATEGY_KEYS: readonly string[] = STRATEGIES.map((strategy) => strategy.key)
