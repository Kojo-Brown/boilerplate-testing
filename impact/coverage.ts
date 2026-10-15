/**
 * The other way to build the map: record what ran, rather than read what is
 * written.
 *
 * ---------------------------------------------------------------------------
 * What a coverage map knows that a parser cannot
 * ---------------------------------------------------------------------------
 * A coverage report from a run of one test file is a list of the files that
 * test executed. It therefore includes the modules a parser cannot see —
 * `fixture/src/rules/registry.ts` loads its rules with `readdir` and a
 * computed specifier, and the coverage report for `registry.test.ts` names
 * both rule files. This is why the serious implementations of test-impact
 * analysis are coverage-based rather than graph-based.
 *
 * ---------------------------------------------------------------------------
 * And what it cannot
 * ---------------------------------------------------------------------------
 * Three things, all three measured in the matrix:
 *
 *   - **It is one run stale.** A test file added by the diff has no entry, so
 *     a lookup selects nothing for it. Every real tool fixes this by unioning
 *     the changed test files, which is what makes the fix visible rather than
 *     structural — the map did not help.
 *   - **It sees code, not data.** `rates.ts` reading `data/rates.json` leaves
 *     no trace in a coverage report, because a JSON file nobody imported is
 *     not instrumented. The `rate-table` fault is missed by the coverage
 *     column and caught by a declared edge.
 *   - **Its blind spots are its include list.** `setup.ts` runs before every
 *     test in the fixture and is outside `coverage.include`, so it appears in
 *     no map and a change to it selects nothing. Widening the list to cover
 *     setup files and configs is possible, and at that point the list is doing
 *     the same job as `triggers.ts` with less of the reasoning visible.
 *
 * Nothing here runs coverage: `runs.ts` does that, once per test file, and
 * this file is the parser for what it writes.
 */

import { readFileSync } from 'node:fs'

import { relativeTo } from './graph.ts'

/** test file → the files that executed when it ran. All repository-relative. */
export type CoverageMap = ReadonlyMap<string, ReadonlySet<string>>

/**
 * The shape of Istanbul's `coverage-final.json`, as far as this needs it: a
 * map keyed by absolute path. V8 coverage is converted into it by Vitest.
 */
interface CoverageFinal {
  readonly [absolutePath: string]: unknown
}

/** The files named by one `coverage-final.json`, relative to `root`. */
export function coveredFiles(reportPath: string, root: string): ReadonlySet<string> {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as CoverageFinal

  return new Set(Object.keys(report).map((absolute) => relativeTo(root, absolute)).sort())
}

/**
 * Which test files a change selects, by coverage alone.
 *
 * Deliberately without the union of changed test files that `select.ts` adds
 * to every graph strategy: the matrix splits the two so that the cell an added
 * test fails in names the mechanism responsible for it.
 */
export function selectByCoverage(map: CoverageMap, changed: readonly string[]): readonly string[] {
  const changedSet = new Set(changed)

  return [...map.entries()]
    .filter(([, covered]) => [...covered].some((file) => changedSet.has(file)))
    .map(([test]) => test)
    .sort()
}
