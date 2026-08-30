/**
 * How big the diff is — the other half of whether a snapshot gets read.
 *
 * Detection says whether a probe goes red. It does not say whether the person
 * looking at the red will find the bug in it, and that is the step where
 * rubber-stamping actually happens: nobody approves a snapshot change they
 * understand to be wrong, they approve one they cannot evaluate. So the size
 * of the change a reviewer is asked to evaluate is a property of the technique
 * worth measuring, and `yield.test.ts` measures it.
 *
 * A longest-common-subsequence diff rather than a line-by-line comparison,
 * because they disagree by a lot on exactly the case that matters: inserting
 * one line into a 39-line document shifts every following line, so a
 * positional comparison calls it 30 changed lines where a real diff calls it
 * one insertion. Reporting the positional number would overstate the cost of
 * every noise edit in `edits.ts` and make the argument here look stronger than
 * it is.
 *
 * The corpus is small (four documents under 60 lines each), so the quadratic
 * table is a few thousand cells and needs no tuning.
 */

/** Lines added and removed to turn `before` into `after`. */
export interface LineDiff {
  readonly added: number
  readonly removed: number
}

/** Total lines a reviewer sees marked, added and removed together. */
export const changedLines = (diff: LineDiff): number => diff.added + diff.removed

/**
 * Length of the longest common subsequence of two line arrays.
 *
 * Iterative and row-at-a-time: the full table is not needed, only the previous
 * row, which keeps this linear in memory.
 */
function lcsLength(before: readonly string[], after: readonly string[]): number {
  let previous = new Array<number>(after.length + 1).fill(0)

  for (const line of before) {
    const current = new Array<number>(after.length + 1).fill(0)

    for (let j = 0; j < after.length; j += 1) {
      current[j + 1] =
        line === after[j]
          ? (previous[j] ?? 0) + 1
          : Math.max(current[j] ?? 0, previous[j + 1] ?? 0)
    }

    previous = current
  }

  return previous[after.length] ?? 0
}

export function diffLines(before: string, after: string): LineDiff {
  if (before === after) {
    return { added: 0, removed: 0 }
  }

  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const common = lcsLength(beforeLines, afterLines)

  return { added: afterLines.length - common, removed: beforeLines.length - common }
}

/** The sum of two diffs, for totalling a change across the whole corpus. */
export function addDiffs(a: LineDiff, b: LineDiff): LineDiff {
  return { added: a.added + b.added, removed: a.removed + b.removed }
}

export const EMPTY_DIFF: LineDiff = { added: 0, removed: 0 }

/** The median of a list of numbers, averaging the middle pair when even. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('median of no values')
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}
