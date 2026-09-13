// @vitest-environment node
/**
 * The savepoint rewriting, on its own.
 *
 * This is eight lines of `strategies.ts` and it decides four cells of the
 * detection matrix, so it is worth testing where the answer is not a
 * container's. What it must get right is not the happy path — that shows up in
 * the matrix — but the two edges that would make the strategy *look* correct
 * while doing something else: nesting, and a `COMMIT` the subject sends without
 * a matching `BEGIN`.
 *
 * The second is the one that matters. Under the naive strategy an unmatched
 * `COMMIT` commits the harness's transaction and everything in it, and the
 * suite goes on passing; here it has to be an error that says so.
 */

import { describe, expect, it } from 'vitest'

import { recordingQueryable } from './double.ts'
import { savepointRewriting } from './rewrite.ts'

describe('savepointRewriting', () => {
  it('turns begin/commit into a savepoint and a release', async () => {
    const recorder = recordingQueryable()
    const { db } = recorder
    const rewritten = savepointRewriting(db)

    await rewritten.query('begin')
    await rewritten.query('insert into orders default values')
    await rewritten.query('commit')

    expect(recorder.sent()).toEqual(['savepoint app_tx_1', 'insert into orders default values', 'release savepoint app_tx_1'])
  })

  it('turns the subject’s rollback into a rollback to savepoint', async () => {
    const recorder = recordingQueryable()
    const { db } = recorder
    const rewritten = savepointRewriting(db)

    await rewritten.query('begin')
    await rewritten.query('rollback')

    expect(recorder.sent()).toEqual(['savepoint app_tx_1', 'rollback to savepoint app_tx_1'])
  })

  it('nests, so a subject with nested transactions gets nested savepoints', async () => {
    const recorder = recordingQueryable()
    const { db } = recorder
    const rewritten = savepointRewriting(db)

    await rewritten.query('begin')
    await rewritten.query('begin')
    await rewritten.query('commit')
    await rewritten.query('commit')

    expect(recorder.sent()).toEqual([
      'savepoint app_tx_1',
      'savepoint app_tx_2',
      'release savepoint app_tx_2',
      'release savepoint app_tx_1',
    ])
  })

  it('refuses a commit the subject never opened, rather than passing it through', async () => {
    const recorder = recordingQueryable()
    const { db } = recorder
    const rewritten = savepointRewriting(db)

    await expect(rewritten.query('commit')).rejects.toThrow(/outside any transaction it opened/)
    expect(recorder.sent()).toEqual([])
  })

  it('is case- and whitespace-insensitive about the keyword', async () => {
    const recorder = recordingQueryable()
    const { db } = recorder
    const rewritten = savepointRewriting(db)

    await rewritten.query('  BEGIN  ')
    await rewritten.query('\nCommit\n')

    expect(recorder.sent()).toEqual(['savepoint app_tx_1', 'release savepoint app_tx_1'])
  })

  it('passes everything else through with its values', async () => {
    const recorder = recordingQueryable()
    const rewritten = savepointRewriting(recorder.db)

    await rewritten.query('select $1::int', [7])

    expect(recorder.recorded).toEqual([{ text: 'select $1::int', values: [7] }])
  })

  it('does not mistake a statement that merely starts with a similar word', async () => {
    const recorder = recordingQueryable()
    const { db } = recorder
    const rewritten = savepointRewriting(db)

    // `beginning` is not `begin`, and a prefix match would rewrite it.
    await rewritten.query('select beginning from schedule')

    expect(recorder.sent()).toEqual(['select beginning from schedule'])
  })
})
