// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { truncateAllTables, setupPrismaIsolation } from './isolation'
import type { PrismaLike, PrismaTransactionLike, IsolationHooks } from './isolation'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type MockPrisma = PrismaLike & { executed: string[]; disconnected: boolean }

function makeMockPrisma(tables: string[]): MockPrisma {
  const executed: string[] = []

  const tx: PrismaTransactionLike = {
    async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
      executed.push(`query: ${query}`)
      if (query.startsWith('SELECT tablename')) {
        return tables.map((tablename) => ({ tablename })) as T
      }
      return undefined as T
    },
    async $executeRawUnsafe(query: string, ..._values: unknown[]): Promise<number> {
      executed.push(`execute: ${query}`)
      return 0
    },
  }

  // Explicit MockPrisma annotation ensures `disconnected: boolean` (not `false`),
  // so $disconnect() can assign `true` without a type error.
  const mock: MockPrisma = {
    executed,
    disconnected: false,
    async $transaction<T>(fn: (tx: PrismaTransactionLike) => Promise<T>): Promise<T> {
      return fn(tx)
    },
    async $queryRawUnsafe<T>(_query: string, ..._values: unknown[]): Promise<T> {
      return undefined as T
    },
    async $executeRawUnsafe(_query: string, ..._values: unknown[]): Promise<number> {
      return 0
    },
    async $disconnect(): Promise<void> {
      mock.disconnected = true
    },
  }

  return mock
}

function makeTestHooks(): {
  hooks: IsolationHooks
  runBeforeEach(): Promise<void>
  runAfterAll(): Promise<void>
} {
  let beforeEachFn: (() => Promise<void> | void) | undefined
  let afterAllFn: (() => Promise<void> | void) | undefined

  return {
    hooks: {
      beforeEach(fn) {
        beforeEachFn = fn
      },
      afterAll(fn) {
        afterAllFn = fn
      },
    },
    runBeforeEach: async () => {
      await beforeEachFn?.()
    },
    runAfterAll: async () => {
      await afterAllFn?.()
    },
  }
}

// ---------------------------------------------------------------------------
// truncateAllTables
// ---------------------------------------------------------------------------

describe('truncateAllTables', () => {
  it('queries pg_tables with the correct schema', async () => {
    const prisma = makeMockPrisma([])
    await truncateAllTables(prisma, { schema: 'myschema' })
    expect(prisma.executed[0]).toBe(
      'query: SELECT tablename FROM pg_tables WHERE schemaname = $1',
    )
  })

  it('does nothing when there are no tables after exclusions', async () => {
    const prisma = makeMockPrisma([])
    await truncateAllTables(prisma)
    // Only the SELECT query runs — no TRUNCATE
    expect(prisma.executed).toHaveLength(1)
    expect(prisma.executed[0]).toContain('SELECT tablename')
  })

  it('truncates discovered tables with RESTART IDENTITY CASCADE', async () => {
    const prisma = makeMockPrisma(['users', 'posts'])
    await truncateAllTables(prisma)
    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toBe(
      'execute: TRUNCATE "public"."users", "public"."posts" RESTART IDENTITY CASCADE',
    )
  })

  it('excludes _prisma_migrations by default', async () => {
    const prisma = makeMockPrisma(['users', '_prisma_migrations'])
    await truncateAllTables(prisma)
    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toContain('"public"."users"')
    expect(truncateCall).not.toContain('_prisma_migrations')
  })

  it('skips TRUNCATE entirely when only excluded tables exist', async () => {
    const prisma = makeMockPrisma(['_prisma_migrations'])
    await truncateAllTables(prisma)
    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toBeUndefined()
  })

  it('respects a custom exclude list', async () => {
    const prisma = makeMockPrisma(['users', 'audit_log', '_prisma_migrations'])
    await truncateAllTables(prisma, { exclude: ['audit_log', '_prisma_migrations'] })
    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toBe(
      'execute: TRUNCATE "public"."users" RESTART IDENTITY CASCADE',
    )
  })

  it('uses the provided schema name in the TRUNCATE statement', async () => {
    const prisma = makeMockPrisma(['orders'])
    await truncateAllTables(prisma, { schema: 'tenant_1' })
    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toBe(
      'execute: TRUNCATE "tenant_1"."orders" RESTART IDENTITY CASCADE',
    )
  })

  it('wraps all SQL in a single $transaction call', async () => {
    let transactionCallCount = 0
    const tx: PrismaTransactionLike = {
      async $queryRawUnsafe<T>(): Promise<T> {
        return [{ tablename: 'users' }] as T
      },
      async $executeRawUnsafe(): Promise<number> {
        return 0
      },
    }
    const prisma: PrismaLike = {
      async $transaction<T>(fn: (tx: PrismaTransactionLike) => Promise<T>): Promise<T> {
        transactionCallCount++
        return fn(tx)
      },
      async $queryRawUnsafe<T>(): Promise<T> {
        return undefined as T
      },
      async $executeRawUnsafe(): Promise<number> {
        return 0
      },
      async $disconnect(): Promise<void> {
        // no-op
      },
    }

    await truncateAllTables(prisma)
    expect(transactionCallCount).toBe(1)
  })

  it('handles a large number of tables', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `table_${i}`)
    const prisma = makeMockPrisma(many)
    await truncateAllTables(prisma)
    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toContain('"public"."table_0"')
    expect(truncateCall).toContain('"public"."table_49"')
  })
})

// ---------------------------------------------------------------------------
// setupPrismaIsolation
// ---------------------------------------------------------------------------

describe('setupPrismaIsolation', () => {
  it('registers a beforeEach hook that truncates tables', async () => {
    const prisma = makeMockPrisma(['users', 'sessions'])
    const { hooks, runBeforeEach } = makeTestHooks()

    setupPrismaIsolation(prisma, {}, hooks)
    await runBeforeEach()

    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toContain('"public"."users"')
    expect(truncateCall).toContain('"public"."sessions"')
  })

  it('disconnects in afterAll by default', async () => {
    const prisma = makeMockPrisma([])
    const { hooks, runAfterAll } = makeTestHooks()

    setupPrismaIsolation(prisma, {}, hooks)
    await runAfterAll()

    expect(prisma.disconnected).toBe(true)
  })

  it('skips afterAll registration when afterAllDisconnect is false', () => {
    const prisma = makeMockPrisma([])
    const afterAllSpy = vi.fn()
    const hooks: IsolationHooks = { beforeEach: vi.fn(), afterAll: afterAllSpy }

    setupPrismaIsolation(prisma, { afterAllDisconnect: false }, hooks)

    expect(afterAllSpy).not.toHaveBeenCalled()
  })

  it('forwards schema and exclude options to truncateAllTables', async () => {
    const prisma = makeMockPrisma(['users', 'audit'])
    const { hooks, runBeforeEach } = makeTestHooks()

    setupPrismaIsolation(
      prisma,
      { schema: 'app', exclude: ['_prisma_migrations', 'audit'] },
      hooks,
    )
    await runBeforeEach()

    const truncateCall = prisma.executed.find((e) => e.startsWith('execute:'))
    expect(truncateCall).toBe('execute: TRUNCATE "app"."users" RESTART IDENTITY CASCADE')
  })

  it('calls beforeEach exactly once', () => {
    const prisma = makeMockPrisma([])
    const beforeEachSpy = vi.fn()
    const hooks: IsolationHooks = { beforeEach: beforeEachSpy, afterAll: vi.fn() }

    setupPrismaIsolation(prisma, {}, hooks)

    expect(beforeEachSpy).toHaveBeenCalledOnce()
  })

  it('calls afterAll exactly once when afterAllDisconnect is true', () => {
    const prisma = makeMockPrisma([])
    const afterAllSpy = vi.fn()
    const hooks: IsolationHooks = { beforeEach: vi.fn(), afterAll: afterAllSpy }

    setupPrismaIsolation(prisma, { afterAllDisconnect: true }, hooks)

    expect(afterAllSpy).toHaveBeenCalledOnce()
  })
})
