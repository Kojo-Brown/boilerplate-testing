/**
 * Which test files can reach a module, and therefore which suites a mutation
 * run has to load before it is entitled to call a mutant "survived".
 *
 * ---------------------------------------------------------------------------
 * Why this is the same walk the ratio policy does
 * ---------------------------------------------------------------------------
 * `shape/classify.ts` already answers "what can this test file reach?" — it
 * walks the local import graph transitively to decide whether a test crosses a
 * boundary. This module asks the same question backwards: given a module,
 * which test files reach *it*. Rather than write a second import-graph walker
 * that could disagree with the first, it is built out of the same exported
 * primitives — `findTestFiles`, `readImports`, `resolveLocal`, `repoPath`. Two
 * walkers is one walker plus a bug.
 *
 * Transitivity is not decoration here either. `property/detection.test.ts`
 * reaches `property/availability.ts` through `probes.ts` and `faults.ts` and
 * never names it; a direct-import scan would leave it out of the run, and
 * every mutant only that suite kills would be reported as a survivor. The
 * report would then say the property suites are weaker than they are, which is
 * the exact failure a scoped mutation run is prone to and the reason nothing
 * here is written down by hand.
 *
 * ---------------------------------------------------------------------------
 * Type-only imports
 * ---------------------------------------------------------------------------
 * `readImports` already drops `import type` declarations, which is the right
 * answer for this question as well as for the ratio: a suite that imports only
 * a module's types is erased at run time and cannot kill one of its mutants.
 * Counting it would inflate the dry run and leave a suite in the report that
 * can never appear in an attribution row.
 */

import { join } from 'node:path'

import {
  findTestFiles,
  readImports,
  repoPath,
  REPO_ROOT,
  resolveLocal,
  type ImportRef,
} from '../shape/classify.ts'

/**
 * A memoised `readImports`, so a graph walked once per target module reads
 * each file once in total rather than once per module.
 */
function memoisedImports(): (file: string) => readonly ImportRef[] {
  const cache = new Map<string, readonly ImportRef[]>()

  return (file: string): readonly ImportRef[] => {
    const cached = cache.get(file)

    if (cached !== undefined) {
      return cached
    }

    const refs = readImports(file)

    cache.set(file, refs)

    return refs
  }
}

/**
 * Every local file reachable from `entry`, transitively, as repo-relative
 * paths. The entry itself is not included: a test file does not cover itself.
 */
function reachableFrom(
  entry: string,
  root: string,
  imports: (file: string) => readonly ImportRef[],
): Set<string> {
  const seen = new Set<string>([entry])
  const reached = new Set<string>()
  const queue: string[] = [entry]

  while (queue.length > 0) {
    // Shift rather than pop: breadth-first, so the walk stays cheap on the
    // wide-and-shallow graphs this repository actually has.
    const current = queue.shift() as string

    for (const ref of imports(current)) {
      const local = resolveLocal(current, ref.specifier, root)

      if (local === null || seen.has(local)) {
        continue
      }

      seen.add(local)
      reached.add(repoPath(local, root))
      queue.push(local)
    }
  }

  return reached
}

/**
 * For each module, the test files that reach it — sorted, repo-relative.
 *
 * Every requested module gets an entry, including one nothing reaches: an
 * empty array is a finding (a module in scope with no suite behind it scores
 * 0% and should say so) rather than a missing key the caller has to guess at.
 *
 * `root` and `testFiles` are parameters so the walk can be pointed at a
 * fixture tree in a temp directory. `mutation/reach.test.ts` does exactly
 * that: a reachability function that could only ever be run against this
 * repository would have to be tested by asserting facts about this
 * repository, and those assertions go stale every time a suite is added.
 */
export function suitesReaching(
  modules: readonly string[],
  root: string = REPO_ROOT,
  testFiles: readonly string[] = findTestFiles(root),
): ReadonlyMap<string, readonly string[]> {
  const imports = memoisedImports()
  const wanted = new Set(modules)
  const found = new Map<string, string[]>(modules.map((module) => [module, []]))

  for (const testFile of testFiles) {
    const reached = reachableFrom(testFile, root, imports)

    for (const module of reached) {
      if (wanted.has(module)) {
        ;(found.get(module) as string[]).push(repoPath(testFile, root))
      }
    }
  }

  for (const suites of found.values()) {
    suites.sort()
  }

  return found
}

/**
 * Every external module reachable from `testFiles`, transitively.
 *
 * The mutation run declares `environment: 'node'`, and that declaration is a
 * claim about these: a suite that reaches `@testing-library/react` needs a DOM
 * and will fail three minutes into a run, in a job whose output is about
 * mutation scores, for a reason that has nothing to do with mutants.
 * `scope.test.ts` checks the claim in `pnpm test` instead.
 *
 * Specifiers are returned exactly as written, so `msw` and `msw/node` stay
 * distinct — the same rule `shape/boundaries.ts` keys its table on.
 */
export function externalsReachedBy(
  testFiles: readonly string[],
  root: string = REPO_ROOT,
): ReadonlySet<string> {
  const imports = memoisedImports()
  const externals = new Set<string>()

  for (const testFile of testFiles) {
    const local = [testFile, ...[...reachableFrom(testFile, root, imports)].map((file) => join(root, file))]

    for (const file of local) {
      for (const ref of imports(file)) {
        if (resolveLocal(file, ref.specifier, root) === null) {
          externals.add(ref.specifier)
        }
      }
    }
  }

  return externals
}

/**
 * The union of every suite reaching any of `modules` — the `include` list a
 * mutation run's Vitest config needs.
 *
 * Sorted and de-duplicated, because it is written into a config file that
 * `scope.test.ts` compares against: an unstable order would make a
 * no-op change look like a scope change.
 */
export function coveringSuites(
  modules: readonly string[],
  root: string = REPO_ROOT,
  testFiles: readonly string[] = findTestFiles(root),
): readonly string[] {
  const union = new Set<string>()

  for (const suites of suitesReaching(modules, root, testFiles).values()) {
    for (const suite of suites) {
      union.add(suite)
    }
  }

  return [...union].sort()
}
