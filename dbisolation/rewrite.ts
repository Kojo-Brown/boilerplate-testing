/**
 * Rewriting a subject's transaction control into savepoints.
 *
 * Its own module, with no driver import, because it is the whole of
 * `rollback-savepoint` — eight lines that decide five cells of the detection
 * matrix — and because it is a pure function over {@link Queryable} that can be
 * tested against an in-memory double in `pnpm test`, rather than only inside the
 * container job. `rewriting.test.ts` is what that buys.
 */

import type { Queryable } from './orders.ts'

/**
 * Rewrite the subject's transaction control into savepoints.
 *
 * This is the whole of `rollback-savepoint`, and it is deliberately this
 * small — the framework implementations are the same substitution one layer
 * lower, in the connection adapter, where the application cannot see it. Doing
 * it here rather than teaching the subject about tests is the point: the
 * subject is unchanged and unaware, which is the property that makes the
 * strategy attractive and the property that makes its blind spots invisible.
 *
 * The depth counter exists because the substitution has to be re-entrant to be
 * faithful — a subject that nests transactions gets nested savepoints — and
 * because a `COMMIT` arriving at depth zero is a real bug in the subject that
 * the naive strategy would silently turn into a commit of the harness's
 * transaction. Here it is an error that names itself.
 */
export function savepointRewriting(inner: Queryable): Queryable {
  let depth = 0

  return {
    async query(text, values) {
      const keyword = text.trim().split(/\s+/)[0]?.toLowerCase()

      if (keyword === 'begin') {
        depth += 1

        return inner.query(`savepoint app_tx_${depth}`)
      }

      if (keyword === 'commit' || keyword === 'rollback') {
        if (depth === 0) {
          throw new Error(
            `The subject sent ${keyword.toUpperCase()} outside any transaction it opened. Under the naive ` +
              'rollback strategy this would have committed the harness transaction instead of failing.',
          )
        }

        const name = `app_tx_${depth}`

        depth -= 1

        return inner.query(keyword === 'commit' ? `release savepoint ${name}` : `rollback to savepoint ${name}`)
      }

      return inner.query(text, values)
    },
  }
}
