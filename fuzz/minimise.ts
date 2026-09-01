/**
 * Shrinking a raw string, when there is no generation tree to shrink.
 *
 * ---------------------------------------------------------------------------
 * Why this is not `fast-check`'s shrinker
 * ---------------------------------------------------------------------------
 * `property/shrinking.ts` measures a reduction from 734 characters to 8 in 62
 * steps, and it gets that for free: fast-check knows the *derivation* of the
 * value it produced — which arbitrary made which choice — so shrinking is a
 * walk back up a tree it kept.
 *
 * A mutation fuzzer keeps no such tree. It has a string that came from four
 * random edits to a seed, and the only handle on it is the string itself. So
 * minimisation here is a search: propose a smaller candidate, ask whether it
 * still fails, keep it if it does. That difference is the reason a fuzzer's
 * find lands in the issue tracker as 200 bytes of line noise and a property
 * test's lands as `[[0, 3), [1, 2)]`, and it is worth knowing which of the two
 * tools you are holding before you complain about the report.
 *
 * ---------------------------------------------------------------------------
 * The algorithm
 * ---------------------------------------------------------------------------
 * Zeller and Hildebrandt's ddmin, then a single-character sweep.
 *
 * ddmin removes contiguous chunks: cut the input into `n` pieces, try each
 * piece alone, then try each complement; on success restart at the new size,
 * on failure double `n` and try again, until `n` exceeds the length. It is
 * O(n²) in the worst case and nowhere near it in practice, because the first
 * few halvings do most of the work.
 *
 * The sweep afterwards is not decoration. ddmin's chunks are contiguous, so it
 * cannot delete the third and the ninth character while keeping the sixth, and
 * a JSON document's essential characters are exactly that scattered — a brace
 * here, a quote there. On this corpus the sweep is worth another 30% off a
 * result ddmin has already called minimal, which `minimise.test.ts` measures
 * rather than asserts.
 *
 * ---------------------------------------------------------------------------
 * The thing everyone gets bitten by
 * ---------------------------------------------------------------------------
 * A minimiser reduces towards whatever the predicate says, and the predicate
 * is usually "still fails". If the predicate is "throws an exception", the
 * minimal input is frequently one that throws a *different* exception from the
 * one that was interesting — the empty string, say, which fails for the most
 * boring reason available. `minimiseFinding` therefore holds the *reason*
 * fixed, not merely the failure, and `minimise.test.ts` shows what the loose
 * predicate reduces the same input to.
 */

export interface MinimiseResult {
  readonly input: string
  /** How many candidates the predicate was asked about. */
  readonly evaluations: number
}

/**
 * The smallest input this search can reach that still satisfies `fails`.
 *
 * `fails` must be a pure function of the candidate. A predicate that carries
 * state between calls — a counter, a cache keyed on the wrong thing — makes
 * the search wander, and the failure mode is a "minimal" input that does not
 * reproduce.
 */
export function minimise(input: string, fails: (candidate: string) => boolean): MinimiseResult {
  let evaluations = 0

  const check = (candidate: string): boolean => {
    evaluations += 1

    return fails(candidate)
  }

  let current = input
  let granularity = 2

  while (current.length > 1) {
    const size = Math.floor(current.length / granularity)

    if (size < 1) {
      break
    }

    let reduced = false

    // Each chunk on its own, then each complement. Chunks first because when
    // one of them reproduces the failure the input collapses by a factor of
    // `granularity` in a single step.
    for (let start = 0; start < current.length; start += size) {
      const chunk = current.slice(start, start + size)

      if (chunk.length > 0 && chunk.length < current.length && check(chunk)) {
        current = chunk
        granularity = 2
        reduced = true

        break
      }
    }

    if (reduced) {
      continue
    }

    for (let start = 0; start < current.length; start += size) {
      const complement = current.slice(0, start) + current.slice(start + size)

      if (complement.length < current.length && check(complement)) {
        current = complement
        granularity = Math.max(granularity - 1, 2)
        reduced = true

        break
      }
    }

    if (reduced) {
      continue
    }

    if (granularity >= current.length) {
      break
    }

    granularity = Math.min(granularity * 2, current.length)
  }

  // The scattered-character pass ddmin cannot do.
  let position = 0

  while (position < current.length) {
    const candidate = current.slice(0, position) + current.slice(position + 1)

    if (check(candidate)) {
      current = candidate

      continue
    }

    position += 1
  }

  return { input: current, evaluations }
}
