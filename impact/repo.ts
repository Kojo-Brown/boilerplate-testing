/**
 * Pointing the selector at this repository.
 *
 * ---------------------------------------------------------------------------
 * Where the suite list comes from
 * ---------------------------------------------------------------------------
 * Not from a glob written here. `vitest.config.ts` exports `UNIT_TEST_CONFIG`
 * — including the forty lines of exclusions that decide which specs belong to
 * which runner — and this file applies that exclusion list to the tracked
 * files. One list, two readers, which is the same argument
 * `vitest/quarantine.config.ts` makes for importing it: a second copy of those
 * globs would be a second opinion about what `pnpm test` runs, and the two
 * would diverge within a month.
 *
 * `check.ts` cross-checks the result against `vitest list` — the runner's own
 * answer — because an agreement between two derivations is worth more than
 * either one.
 *
 * ---------------------------------------------------------------------------
 * Where the file list comes from
 * ---------------------------------------------------------------------------
 * `git ls-files`, not a directory walk. The tracked set is the set a diff can
 * talk about: a walk would pull in `coverage/`, `storybook-static/`, the
 * `.runs/` copies and whatever else a local run has left lying around, and
 * every one of those would be a node nothing can change.
 */

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UNIT_TEST_CONFIG } from '../vitest.config.ts'
import type { ChangedFile } from './diff.ts'
import { expandEdges, REPO_EDGES, snapshotEdges } from './edges.ts'
import { buildGraph, type AliasTable, type Graph } from './graph.ts'
import { select, type Selection } from './select.ts'
import type { StrategyId } from './strategies.ts'
import { matchesGlob, REPO_TRIGGERS } from './triggers.ts'

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** `@/x` resolves to `x` from the repository root, as `tsconfig.json` declares. */
export const REPO_ALIAS: AliasTable = { '@/': '' }

/**
 * Vitest's default include globs, which the root config does not override.
 *
 * Stated rather than imported because Vitest does not export its defaults.
 * `check.ts` compares the resulting list against `vitest list`, so a drift
 * here fails a gate rather than silently shrinking the suite.
 */
export const INCLUDE_PATTERNS: readonly string[] = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
]

const EXCLUDE_PATTERNS: readonly string[] = UNIT_TEST_CONFIG.exclude

/** Every tracked file, repository-relative and POSIX, sorted. */
export function trackedFiles(root: string = REPO_ROOT): readonly string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

  return output.split('\0').filter((path) => path !== '').sort()
}

/** The suites `pnpm test` would collect: the include globs, minus the config's exclusions. */
export function unitTestFiles(files: readonly string[]): readonly string[] {
  return files.filter(
    (file) =>
      INCLUDE_PATTERNS.some((pattern) => matchesGlob(file, pattern)) &&
      !EXCLUDE_PATTERNS.some((pattern) => matchesGlob(file, pattern)),
  )
}

export function repoGraph(files: readonly string[], root: string = REPO_ROOT): Graph {
  return buildGraph(root, files, REPO_ALIAS)
}

/**
 * Where `check.ts` writes its selection and `run.ts` reads it.
 *
 * One path in one place: the two halves are separate processes and a
 * disagreement about the filename would make the runner silently run the
 * previous selection.
 */
export const SELECTION_FILE = process.env['IMPACT_SELECTION'] ?? join(REPO_ROOT, 'impact/selection.txt')

/**
 * The token the selection file carries instead of a list of paths.
 *
 * It lives here rather than in `check.ts` because `run.ts` needs it too, and
 * importing it from a file that calls `process.exit` at module scope would run
 * the gate as a side effect of reading a constant.
 */
export const RUN_ALL = 'ALL'

/** The recommended strategy, unless a caller wants to compare. */
export const DEFAULT_STRATEGY: StrategyId = 'transitive-triggers-edges'

export function repoSelection(
  changed: readonly ChangedFile[],
  files: readonly string[],
  strategy: StrategyId = DEFAULT_STRATEGY,
  root: string = REPO_ROOT,
): Selection {
  return select(strategy, {
    graph: repoGraph(files, root),
    testFiles: unitTestFiles(files),
    changed,
    triggers: REPO_TRIGGERS,
    edges: REPO_EDGES,
  })
}

/** A way the selector's own configuration has stopped describing the repository. */
export interface ConfigurationProblem {
  readonly kind: 'stale-trigger' | 'stale-edge-importer' | 'stale-edge-dependency'
  readonly detail: string
}

/**
 * Audit the trigger patterns and the declared edges against the tree.
 *
 * Both failures are silent in exactly the way this directory is about. A
 * trigger whose pattern matches nothing looks like a trigger that is working
 * until the day the file it was written for changes under a new name; a
 * declared edge whose dependency glob matches nothing is a data file somebody
 * moved, and the suite that reads it stops being selected. Neither shows up in
 * a selection — they show up as a suite that was not run.
 *
 * What this cannot catch is the edge nobody ever declared. That is the
 * standing cost of the technique, and it is why `check.ts` prints the
 * selection rather than enforcing it as the only thing CI runs.
 */
export function auditConfiguration(files: readonly string[]): readonly ConfigurationProblem[] {
  const present = new Set(files)
  const problems: ConfigurationProblem[] = []

  for (const trigger of REPO_TRIGGERS) {
    if (files.some((file) => matchesGlob(file, trigger.pattern))) continue

    problems.push({
      kind: 'stale-trigger',
      detail: `trigger "${trigger.id}" (${trigger.pattern}) matches no tracked file. Either the file moved, or the trigger was written for one that never existed.`,
    })
  }

  for (const edge of REPO_EDGES) {
    if (!present.has(edge.importer)) {
      problems.push({
        kind: 'stale-edge-importer',
        detail: `declared edge from "${edge.importer}" names a file that is not tracked. Nothing will ever be selected through it.`,
      })
    }

    if (expandEdges([edge], files).length === 0) {
      problems.push({
        kind: 'stale-edge-dependency',
        detail: `declared edge "${edge.importer}" → "${edge.dependency}" matches no tracked file. The suite that reads it is no longer selected when it changes.`,
      })
    }
  }

  return problems
}

/** Every edge the recommended strategy adds to the import graph, for the report. */
export function derivedEdges(files: readonly string[]): { readonly snapshots: number; readonly declared: number } {
  return {
    snapshots: snapshotEdges(files).length,
    declared: expandEdges(REPO_EDGES, files).length,
  }
}
