/**
 * A recording double for {@link Queryable}, and the one cast in this directory.
 *
 * ---------------------------------------------------------------------------
 * Why the cast is here and only here
 * ---------------------------------------------------------------------------
 * `Queryable.query` is generic in its row type: the caller says what shape it
 * expects and the implementation promises to produce it. A real driver can keep
 * that promise loosely because the rows come off a socket untyped. A *double*
 * cannot keep it at all — it has to invent rows, and rows it invents are of
 * whatever type it wrote them as, not of the caller's `R`.
 *
 * That is a genuine limitation of test doubles for generic methods rather than
 * a gap in the types, and there are three ways out. Declaring the parameter
 * `any` throws away every other check in the file. A `@ts-expect-error` hides
 * the line rather than the reason. Or one narrow, commented assertion, in one
 * place that both test files import, where a reader can see exactly what is
 * being asserted and why it is safe: the rows are supplied per call by the test
 * that also declares what it asked for.
 *
 * This file is that third option. `eslint.config.js` and `tsconfig.json` are
 * unchanged; nothing here is disabled.
 *
 * ---------------------------------------------------------------------------
 * What it is for
 * ---------------------------------------------------------------------------
 * Two things a container cannot answer quickly. Whether the subject sends its
 * transaction control as the bare keywords the savepoint rewriting matches on —
 * a subject that started writing `START TRANSACTION` would silently stop being
 * rewritten, and the detection matrix would report that as a property of the
 * strategy. And whether the rewriting itself nests, refuses an unmatched
 * `COMMIT`, and leaves everything else alone.
 */

import type { QueryResult, QueryResultRow } from 'pg'

import type { Queryable } from './orders.ts'

/** One statement, as the double saw it. */
export interface RecordedQuery {
  readonly text: string
  readonly values: readonly unknown[] | undefined
}

export interface RecordingQueryable {
  readonly db: Queryable
  /** Every statement, in order. */
  readonly recorded: readonly RecordedQuery[]
  /** Just the statement text, which is what most assertions want. */
  sent(): readonly string[]
}

/**
 * A `Queryable` that records what it is asked and answers with `rows`.
 *
 * `rows` is consulted per statement, so a test can hand back a row for the
 * insert the subject reads an id from and nothing for anything else.
 */
export function recordingQueryable(rows: (text: string) => readonly QueryResultRow[] = () => []): RecordingQueryable {
  const recorded: RecordedQuery[] = []

  return {
    recorded,
    sent: () => recorded.map((entry) => entry.text),
    db: {
      query<R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ): Promise<QueryResult<R>> {
        recorded.push({ text, values })

        return Promise.resolve({
          // The assertion this file exists for. The rows were supplied by the
          // caller of `recordingQueryable`, which is the same test that decides
          // what `R` is at the call site, so the two agree by construction and
          // by nothing the compiler can see.
          rows: rows(text) as R[],
          command: '',
          rowCount: rows(text).length,
          oid: 0,
          fields: [],
        })
      },
    },
  }
}
