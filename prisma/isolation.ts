/**
 * Prisma test isolation — truncates every application table before each test
 * via `$transaction` so foreign-key constraints are resolved by PostgreSQL's
 * CASCADE and sequences restart with RESTART IDENTITY.
 *
 * Usage (Vitest / Jest with globals enabled):
 *
 *   import { PrismaClient } from '@prisma/client'
 *   import { setupPrismaIsolation } from '@/prisma/isolation'
 *
 *   const prisma = new PrismaClient()
 *   setupPrismaIsolation(prisma)
 *
 *   it('starts with an empty database', async () => {
 *     const count = await prisma.user.count()
 *     expect(count).toBe(0)
 *   })
 *
 * The real PrismaClient satisfies `PrismaLike` — no extra imports needed.
 * Tables are discovered via `pg_tables` at runtime; `_prisma_migrations` is
 * excluded by default so Prisma state is preserved across the test suite.
 */

/** Methods used by the interactive transaction callback. */
export type PrismaTransactionLike = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

/** Minimal interface satisfied by PrismaClient. */
export interface PrismaLike extends PrismaTransactionLike {
  $transaction<T>(fn: (tx: PrismaTransactionLike) => Promise<T>): Promise<T>
  $disconnect(): Promise<void>
}

export interface IsolationOptions {
  /** PostgreSQL schema to inspect for tables. Defaults to `'public'`. */
  schema?: string
  /**
   * Table names to exclude from truncation.
   * Defaults to `['_prisma_migrations']`.
   */
  exclude?: string[]
  /** Call `prisma.$disconnect()` in `afterAll`. Defaults to `true`. */
  afterAllDisconnect?: boolean
}

/** Injectable test-framework hooks — defaults to vitest/jest globals. */
export interface IsolationHooks {
  beforeEach(fn: () => Promise<void> | void): void
  afterAll(fn: () => Promise<void> | void): void
}

interface PgTableRow {
  tablename: string
}

/**
 * Truncates every table in `schema` except those in `exclude` using a single
 * `TRUNCATE … RESTART IDENTITY CASCADE` statement inside a `$transaction`.
 * Sequences reset so auto-increment IDs restart from 1 after each call.
 */
export async function truncateAllTables(
  prisma: PrismaLike,
  {
    schema = 'public',
    exclude = ['_prisma_migrations'],
  }: Pick<IsolationOptions, 'schema' | 'exclude'> = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<PgTableRow[]>(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1',
      schema,
    )

    const tables = rows
      .map((r) => r.tablename)
      .filter((name) => !exclude.includes(name))

    if (tables.length === 0) return

    const tableList = tables.map((t) => `"${schema}"."${t}"`).join(', ')
    await tx.$executeRawUnsafe(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`)
  })
}

/**
 * Registers `beforeEach` and (optionally) `afterAll` hooks for the current
 * test suite. Each `beforeEach` call truncates all tables; `afterAll`
 * disconnects Prisma if `afterAllDisconnect` is not `false`.
 *
 * @param prisma  PrismaClient instance (or anything satisfying `PrismaLike`).
 * @param options Isolation options — schema, exclusions, disconnect flag.
 * @param hooks   Override test-framework hooks (useful for unit-testing this
 *                utility itself); defaults to the framework's global functions.
 */
export function setupPrismaIsolation(
  prisma: PrismaLike,
  options: IsolationOptions = {},
  // Wrap globals so the signature matches IsolationHooks exactly, avoiding
  // inference conflicts between vitest's overloaded beforeEach/afterAll types.
  hooks: IsolationHooks = {
    beforeEach: (fn) => beforeEach(fn),
    afterAll: (fn) => afterAll(fn),
  },
): void {
  const { afterAllDisconnect = true, ...truncateOptions } = options

  hooks.beforeEach(async () => {
    await truncateAllTables(prisma, truncateOptions)
  })

  if (afterAllDisconnect) {
    hooks.afterAll(async () => {
      await prisma.$disconnect()
    })
  }
}
