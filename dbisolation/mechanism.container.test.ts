/**
 * The five Postgres facts every miss in the matrices is downstream of.
 *
 * Each is asked of the running server rather than cited, because each is the
 * kind of claim that sounds settled and one of them was wrong in the first
 * draft of this directory — see `mechanism.ts`.
 */

import { describe, expect, it } from 'vitest'

import { applySchema } from './schema.ts'
import {
  concurrentIndex,
  deferredConstraintCheck,
  nestedBegin,
  sequenceAfterRollback,
  templateExclusivity,
} from './mechanism.ts'
import { connect, queryable } from './strategies.ts'
import { nonceFor, usePostgresServer } from './fixture.ts'

const server = usePostgresServer('mechanism')
const nonce = nonceFor('mech')

/** A database of its own per fact, so one fact cannot set another one up. */
async function withDatabase<T>(name: string, use: (database: string) => Promise<T>): Promise<T> {
  const database = `${nonce}_${name}`
  const admin = await connect(server().adminUri)

  await admin.client.query(`drop database if exists ${database} with (force)`)
  await admin.client.query(`create database ${database}`)

  try {
    return await use(database)
  } finally {
    await admin.client.query(`drop database if exists ${database} with (force)`)
    await admin.end()
  }
}

describe('what Postgres actually does', () => {
  it('has no nested BEGIN: the inner COMMIT commits the outer transaction', async () => {
    const observed = await withDatabase('nested', (database) => nestedBegin(server(), database))

    expect(observed.beginNotices).toContain('there is already a transaction in progress')
    expect(observed.rollbackNotices).toContain('there is no transaction in progress')
    // The row the harness believed it was rolling back.
    expect(observed.survivingRows).toBe(1)
  })

  it('does not check deferred constraints on RELEASE SAVEPOINT, and does on COMMIT', async () => {
    const observed = await withDatabase('deferred', (database) => deferredConstraintCheck(server(), database))

    expect(observed.onRelease.ok).toBe(true)
    expect(observed.onCommit.ok).toBe(false)
    expect(observed.onCommit.code).toBe('23503')
  })

  it('refuses CREATE INDEX CONCURRENTLY inside a transaction, IF NOT EXISTS included', async () => {
    const observed = await withDatabase('cic', (database) => concurrentIndex(server(), database))

    expect(observed.insideTransaction.code).toBe('25001')
    expect(observed.outsideTransaction.ok).toBe(true)
    // The interesting one: an index that already exists does not make the
    // statement a tolerable no-op.
    expect(observed.insideTransactionWhenPresent.code).toBe('25001')
  })

  it('does not give a sequence value back on ROLLBACK', async () => {
    const observed = await withDatabase('sequence', (database) => sequenceAfterRollback(server(), database))

    expect(observed.rolledBack).toBe(1)
    expect(observed.next).toBe(2)
  })

  it('needs a template with nothing connected to it, whichever STRATEGY is asked for', async () => {
    const observed = await withDatabase('template', async (database) => {
      const connection = await connect(server().uriFor(database))

      await applySchema(queryable(connection.client))
      await connection.end()

      return templateExclusivity(server(), database, `${nonce}_tpl`)
    })

    expect(observed.busyDefault.code).toBe('55006')
    expect(observed.busyFileCopy.code).toBe('55006')
    expect(observed.idleDefault.ok).toBe(true)
    // The claim is about a Postgres major, so the log says which one answered.
    console.info(`[dbisolation] template exclusivity measured on Postgres ${observed.serverVersion}`)
  })
})
