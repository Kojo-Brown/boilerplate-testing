/**
 * The five facts about Postgres that the rest of this directory is downstream
 * of, each asked of a real server rather than cited.
 *
 * ---------------------------------------------------------------------------
 * Why these are measured and not simply documented
 * ---------------------------------------------------------------------------
 * The first draft of this directory got fact 5 backwards, from a plausible
 * inference about a real change — Postgres 15 made `WAL_LOG` the default copy
 * strategy for `CREATE DATABASE` — and a shell probe whose background session
 * had already exited. The measurement that replaced it disagrees with the
 * inference and is stable over three rounds. That is the argument for the whole
 * file: every one of these is the kind of claim that sounds settled, and four
 * of the five are load-bearing for a cell in a matrix.
 *
 * They are also the explanation for every miss in the matrices. A reader who
 * does not believe that `RELEASE SAVEPOINT` skips a deferred constraint check
 * has no reason to believe the four misses in the `rollback-savepoint` column,
 * and the honest answer to that is a test that demonstrates it in eight lines
 * rather than a paragraph asserting it.
 */

import type { Client } from 'pg'

import { connect, queryable, type Server } from './strategies.ts'
import { applySchema } from './schema.ts'

/** What a statement did. */
export interface Attempt {
  readonly ok: boolean
  /** The SQLSTATE, when it failed. */
  readonly code: string | null
  readonly message: string | null
}

export async function attempt(client: Client, text: string): Promise<Attempt> {
  try {
    await client.query(text)

    return { ok: true, code: null, message: null }
  } catch (error) {
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null

    return { ok: false, code, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Collect the server's notices while something runs. */
export async function withNotices<T>(client: Client, use: () => Promise<T>): Promise<{ value: T; notices: string[] }> {
  const notices: string[] = []
  // Inferred rather than annotated: `pg`'s `NoticeMessage` declares `message`
  // as optional, and under `exactOptionalPropertyTypes` a hand-written
  // `{ message?: string }` is not the same type.
  const listener = (notice: { readonly message: string | undefined }): void => {
    if (notice.message !== undefined) {
      notices.push(notice.message)
    }
  }

  client.on('notice', listener)

  try {
    return { value: await use(), notices }
  } finally {
    client.off('notice', listener)
  }
}

export interface NestedBegin {
  /** What the server said about the second `BEGIN`. */
  readonly beginNotices: readonly string[]
  /** What it said about the harness's `ROLLBACK` afterwards. */
  readonly rollbackNotices: readonly string[]
  /** Rows still there after the harness rolled back. */
  readonly survivingRows: number
}

/**
 * Fact 1: there is no nested `BEGIN`, and the inner `COMMIT` is the outer one.
 *
 * This is the entire failure of the naive rollback strategy, and it is quiet:
 * two warnings on a channel most drivers do not surface, and a suite that goes
 * on passing.
 */
export async function nestedBegin(server: Server, database: string): Promise<NestedBegin> {
  const connection = await connect(server.uriFor(database))
  const { client } = connection

  try {
    await client.query('create table nested_probe (id integer)')

    // The harness opens its wrapper transaction.
    await client.query('begin')

    const opening = await withNotices(client, async () => {
      // The subject opens what it believes is its own.
      await client.query('begin')
      await client.query('insert into nested_probe values (1)')
      // And commits it.
      await client.query('commit')
    })

    const closing = await withNotices(client, async () => {
      await client.query('rollback')
    })

    const remaining = await client.query<{ count: string }>('select count(*) as count from nested_probe')

    return {
      beginNotices: opening.notices,
      rollbackNotices: closing.notices,
      survivingRows: Number(remaining.rows[0]?.count ?? 0),
    }
  } finally {
    await connection.end()
  }
}

export interface DeferredCheck {
  /** Releasing a savepoint over a deferred violation. */
  readonly onRelease: Attempt
  /** Committing the same violation. */
  readonly onCommit: Attempt
}

/**
 * Fact 2: `RELEASE SAVEPOINT` does not check deferred constraints. `COMMIT`
 * does.
 *
 * Both halves are needed. That the release succeeds is only interesting next to
 * a commit of the same rows failing, otherwise the reasonable reading is that
 * the constraint was never violated.
 */
export async function deferredConstraintCheck(server: Server, database: string): Promise<DeferredCheck> {
  const connection = await connect(server.uriFor(database))
  const { client } = connection

  try {
    await applySchema(queryable(client))

    const orphan = `insert into order_lines (order_id, sku, cents) values (999999, 'GHOST', 0)`

    await client.query('begin')
    await client.query('savepoint app_tx')
    await client.query(orphan)

    const onRelease = await attempt(client, 'release savepoint app_tx')

    await client.query('rollback')

    await client.query('begin')
    await client.query(orphan)

    const onCommit = await attempt(client, 'commit')

    await client.query('rollback')

    return { onRelease, onCommit }
  } finally {
    await connection.end()
  }
}

export interface ConcurrentIndex {
  readonly insideTransaction: Attempt
  readonly outsideTransaction: Attempt
  /** The same statement, in a transaction, when the index already exists. */
  readonly insideTransactionWhenPresent: Attempt
}

/**
 * Fact 3: `CREATE INDEX CONCURRENTLY` is rejected inside a transaction block,
 * and `IF NOT EXISTS` does not spare it.
 *
 * The third attempt is the one worth having. A reader can reasonably guess that
 * an existing index makes the statement a no-op that a transaction would
 * tolerate; it does not, because the transaction-block test happens first.
 */
export async function concurrentIndex(server: Server, database: string): Promise<ConcurrentIndex> {
  const connection = await connect(server.uriFor(database))
  const { client } = connection

  try {
    await client.query('create table cic_probe (ref text)')
    await client.query('begin')

    const insideTransaction = await attempt(client, 'create index concurrently cic_probe_ref on cic_probe (ref)')

    await client.query('rollback')

    const outsideTransaction = await attempt(client, 'create index concurrently cic_probe_ref on cic_probe (ref)')

    await client.query('begin')

    const insideTransactionWhenPresent = await attempt(
      client,
      'create index concurrently if not exists cic_probe_ref on cic_probe (ref)',
    )

    await client.query('rollback')

    return { insideTransaction, outsideTransaction, insideTransactionWhenPresent }
  } finally {
    await connection.end()
  }
}

export interface SequenceAfterRollback {
  /** The id the rolled-back insert got. */
  readonly rolledBack: number
  /** The id the next insert got. */
  readonly next: number
}

/**
 * Fact 4: a sequence is not transactional, so `ROLLBACK` does not give the
 * number back.
 *
 * The one blind spot `truncate` (without `RESTART IDENTITY`) and
 * `rollback-savepoint` genuinely share, and the reason the `ids` row in the
 * leakage matrix has failures in both families.
 */
export async function sequenceAfterRollback(server: Server, database: string): Promise<SequenceAfterRollback> {
  const connection = await connect(server.uriFor(database))
  const { client } = connection

  try {
    await client.query('create table seq_probe (id bigserial primary key, note text)')
    await client.query('begin')

    const first = await client.query<{ id: string }>(`insert into seq_probe (note) values ('a') returning id`)

    await client.query('rollback')

    const second = await client.query<{ id: string }>(`insert into seq_probe (note) values ('b') returning id`)

    return { rolledBack: Number(first.rows[0]?.id), next: Number(second.rows[0]?.id) }
  } finally {
    await connection.end()
  }
}

export interface TemplateExclusivity {
  /** Default strategy, one session connected to the template. */
  readonly busyDefault: Attempt
  /** `STRATEGY FILE_COPY`, same session connected. */
  readonly busyFileCopy: Attempt
  /** Default strategy again, with nothing connected. */
  readonly idleDefault: Attempt
  readonly serverVersion: string
}

/**
 * Fact 5: a template must have no other sessions connected, and `STRATEGY` does
 * not change that.
 *
 * This one is in the file because the first draft of this directory claimed the
 * opposite. Postgres 15 made `WAL_LOG` the default copy strategy, `FILE_COPY`
 * is the older block-level copy, and it is an easy and attractive inference
 * that the strategy which goes through WAL does not need the source quiescent.
 * It does. Both raise 55006 with a session attached and both succeed without
 * one, on the same server in the same second — which is why the function asks
 * all three questions rather than the two that would have confirmed the guess.
 *
 * It is also the one fact here with an operational consequence for the harness
 * rather than for the subject: `template-db` in `strategies.ts` applies the DDL
 * to its template and then **ends that connection**, and must. A harness that
 * kept a pooled connection to its own template — the obvious thing to do, and
 * what every other strategy in the file does — would fail on the first clone
 * and the error would name the template rather than the pool.
 */
export async function templateExclusivity(
  server: Server,
  template: string,
  prefix: string,
): Promise<TemplateExclusivity> {
  const admin = await connect(server.adminUri)
  const version = await admin.client.query<{ server_version: string }>('show server_version')
  const holder = await connect(server.uriFor(template))
  let busyDefault: Attempt
  let busyFileCopy: Attempt

  try {
    // The holder is connected to the template for both of these.
    busyDefault = await attempt(admin.client, `create database ${prefix}_wal template ${template}`)
    busyFileCopy = await attempt(admin.client, `create database ${prefix}_file template ${template} strategy file_copy`)
  } finally {
    await holder.end()
  }

  try {
    const idleDefault = await attempt(admin.client, `create database ${prefix}_idle template ${template}`)

    for (const suffix of ['wal', 'file', 'idle']) {
      await admin.client.query(`drop database if exists ${prefix}_${suffix} with (force)`)
    }

    return { busyDefault, busyFileCopy, idleDefault, serverVersion: version.rows[0]?.server_version ?? 'unknown' }
  } finally {
    await admin.end()
  }
}
