/**
 * Reading a diff: `git diff --name-status` into something a selector can use.
 *
 * ---------------------------------------------------------------------------
 * Why the status matters and not just the path
 * ---------------------------------------------------------------------------
 * Every description of test-impact analysis talks about "the changed files",
 * and three of git's five statuses do not behave like a change at all:
 *
 *   - **A deletion** removes the node its importers were reachable through, so
 *     a graph built from the working tree — the only tree you have — cannot
 *     find them. The importers are exactly the files that now fail to compile.
 *   - **A rename** is a deletion and an addition, and git reports it as one
 *     line with two paths. Both paths matter: the old one for the importers
 *     that still name it, the new one for the graph.
 *   - **An addition** of a test file has no history to select it by, which is
 *     the blind spot of every coverage-based selector (see `select.ts`).
 *
 * So the status is kept, and `select.ts` is written against it rather than
 * against a list of strings.
 *
 * ---------------------------------------------------------------------------
 * Why parsing rather than `--name-only`
 * ---------------------------------------------------------------------------
 * `--name-only` is the command everyone reaches for and it throws the status
 * away. `-z` is also deliberate in `repo.ts`: a path with a space in it is
 * quoted by git's default output and unquoting that correctly is more code
 * than splitting on NUL.
 */

/** What happened to one path. */
export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'other'

export interface ChangedFile {
  /** Repository-relative POSIX path, as git prints it. */
  readonly path: string
  readonly status: ChangeStatus
  /** For a rename or a copy, the path it came from. */
  readonly from?: string
}

const STATUS_LETTERS: Readonly<Record<string, ChangeStatus>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'modified',
}

function statusOf(letter: string): ChangeStatus {
  // Rename and copy letters carry a similarity score: `R100`, `C085`.
  return STATUS_LETTERS[letter.charAt(0)] ?? 'other'
}

/**
 * Parse the NUL-separated form: `git diff --name-status -z`.
 *
 * The encoding is not one record per NUL — a rename is three fields
 * (`R100`, old, new) and everything else is two — so the fields are read as a
 * stream rather than chunked.
 */
export function parseNameStatusZ(output: string): readonly ChangedFile[] {
  const fields = output.split('\0').filter((field) => field !== '')
  const changes: ChangedFile[] = []

  for (let index = 0; index < fields.length; index += 1) {
    const letter = fields[index]

    if (letter === undefined) break

    const status = statusOf(letter)

    if (status === 'renamed' || status === 'copied') {
      const from = fields[index + 1]
      const to = fields[index + 2]

      index += 2

      if (from === undefined || to === undefined) break

      changes.push({ path: to, status, from })

      continue
    }

    const path = fields[index + 1]

    index += 1

    if (path === undefined) break

    changes.push({ path, status })
  }

  return changes
}

/**
 * Parse the tab-separated form, for a diff that arrives as text rather than
 * from a process — a pull request body, a fixture, a paste.
 */
export function parseNameStatus(output: string): readonly ChangedFile[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .flatMap((line) => {
      const [letter, first, second] = line.split(/\t+/)

      if (letter === undefined || first === undefined) return []

      const status = statusOf(letter)

      if ((status === 'renamed' || status === 'copied') && second !== undefined) {
        return [{ path: second, status, from: first }]
      }

      return [{ path: first, status }]
    })
}

/** The paths a selector should seed its walk with: where the file is *now*. */
export function changedPaths(changes: readonly ChangedFile[]): readonly string[] {
  return [...new Set(changes.filter((change) => change.status !== 'deleted').map((change) => change.path))].sort()
}

/**
 * Paths that no longer exist, including the source side of every rename.
 *
 * These are the ones a working-tree graph cannot resolve, and the reason
 * `select.ts` treats them as a reason to run everything.
 */
export function vanishedPaths(changes: readonly ChangedFile[]): readonly string[] {
  const vanished = changes.flatMap((change) =>
    change.status === 'deleted'
      ? [change.path]
      : change.status === 'renamed' && change.from !== undefined
        ? [change.from]
        : [],
  )

  return [...new Set(vanished)].sort()
}
