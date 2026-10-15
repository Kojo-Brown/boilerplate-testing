/**
 * The import graph, and walking it backwards.
 *
 * ---------------------------------------------------------------------------
 * Why the TypeScript parser and not a regular expression
 * ---------------------------------------------------------------------------
 * The specifiers in a file are not findable with a pattern. `import` appears
 * in strings, in comments, in template literals and in documentation blocks
 * like this one — which is a working example of the problem: a regular
 * expression over this file finds the word a dozen times and not one of them
 * is an edge. Going the other way, `export { x } from './y.ts'` *is* an edge
 * and does not contain the word at all.
 *
 * `ts.preProcessFile` is the compiler's own scanner for exactly this job. It
 * is the pass `tsc` uses to decide which files to load before it has built a
 * program, so it is fast — the whole of this repository parses in under two
 * seconds — and it reports static imports, re-exports, `require()` calls and
 * `import()` with a literal argument, while ignoring the same words in a
 * comment or a string.
 *
 * What it cannot report is the one thing no parser can: `import(variable)`.
 * `fixture/src/rules/registry.ts` is that case, and the matrix measures what
 * it costs.
 *
 * ---------------------------------------------------------------------------
 * Why not `shape/classify.ts`
 * ---------------------------------------------------------------------------
 * That file already reads imports with a real parser, and reusing it was the
 * first plan. It asks a different question, and two of its answers are wrong
 * for this one:
 *
 *   - **It drops type-only imports**, correctly: a census of what a test
 *     *reaches at run time* must not count an erased import. A selector cannot
 *     drop them, because `pnpm typecheck` is a gate and a type-only edge is the
 *     whole of its graph.
 *   - **It resolves `.ts` and `.tsx` only**, which is all a boundary census
 *     needs. A selector that cannot resolve a `.json` is a selector that
 *     cannot see a data file, which is one of the faults measured here.
 *
 * It also walks forwards, from a test to what it imports, where selection needs
 * the reverse index. So the two live side by side, and the one line they would
 * have shared — "parse, do not pattern-match" — is the only thing this borrows.
 *
 * ---------------------------------------------------------------------------
 * Why type-only imports are kept
 * ---------------------------------------------------------------------------
 * `import type { Line } from './money.ts'` emits nothing, so it cannot change
 * what a test *does* at run time — and a selector that dropped those edges
 * would still be wrong, because `pnpm typecheck` is a gate too and a type-only
 * edge is the whole of its dependency graph. Keeping them over-selects in the
 * safe direction: a few extra suites, never a missed failure.
 */

import { readFileSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'

import ts from 'typescript'

/** Files whose text is parsed for specifiers. Everything else is a leaf node. */
const PARSED_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Extensions tried, in order, when a specifier names no file directly.
 *
 * `.js` before `.ts` is deliberate for the bare case, but the pair at the end
 * is the one that matters: TypeScript's own convention under `NodeNext` is to
 * write `./x.js` and mean `./x.ts`, and this repository writes `./x.ts` and
 * means it. Both forms resolve.
 */
const EXTENSION_CANDIDATES: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']

const INDEX_CANDIDATES: readonly string[] = EXTENSION_CANDIDATES.map((extension) => `/index${extension}`)

export interface Graph {
  /** Every node, repository-relative and POSIX, sorted. */
  readonly files: readonly string[]
  /** file → the in-tree files it depends on. */
  readonly imports: ReadonlyMap<string, ReadonlySet<string>>
  /** file → the in-tree files that depend on it. The reverse index. */
  readonly importers: ReadonlyMap<string, ReadonlySet<string>>
  /** file → specifiers that resolved to nothing in the tree (packages, `node:` builtins, missing paths). */
  readonly external: ReadonlyMap<string, readonly string[]>
}

/** An alias table: `{ '@/': 'src/' }` maps `@/lib/x` to `src/lib/x`. */
export type AliasTable = Readonly<Record<string, string>>

export function isParsed(path: string): boolean {
  return PARSED_EXTENSIONS.some((extension) => path.endsWith(extension))
}

function toPosix(path: string): string {
  return path.split('\\').join('/')
}

/** Specifiers found in one file's text. Exported because it is the part worth unit-testing. */
export function parseSpecifiers(source: string): readonly string[] {
  const preprocessed = ts.preProcessFile(source, true, true)
  const seen = new Set<string>()

  for (const reference of preprocessed.importedFiles) seen.add(reference.fileName)

  // `/// <reference path="…" />`. Rare, and a real edge for `tsc`.
  for (const reference of preprocessed.referencedFiles) seen.add(reference.fileName)

  return [...seen]
}

/**
 * Resolve one specifier against a known set of files.
 *
 * Returns the repository-relative path, or `null` when the specifier names
 * something outside the tree — a package, a `node:` builtin, or a path that
 * does not exist, which is what a deletion leaves behind.
 */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  files: ReadonlySet<string>,
  alias: AliasTable = {},
): string | null {
  if (specifier.startsWith('node:') || specifier.startsWith('data:')) return null

  let base: string | null = null

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = posix.normalize(posix.join(posix.dirname(fromFile), specifier))
  } else {
    for (const [prefix, target] of Object.entries(alias)) {
      if (!specifier.startsWith(prefix)) continue

      base = posix.normalize(posix.join(target, specifier.slice(prefix.length)))
      break
    }
  }

  if (base === null) return null
  if (base.startsWith('..')) return null

  const candidates = [
    base,
    ...EXTENSION_CANDIDATES.map((extension) => `${base}${extension}`),
    ...INDEX_CANDIDATES.map((suffix) => `${base}${suffix}`),
    // The `./x.js` form that means `./x.ts`.
    ...(base.endsWith('.js')
      ? ['.ts', '.tsx'].map((extension) => `${base.slice(0, -'.js'.length)}${extension}`)
      : []),
  ]

  return candidates.find((candidate) => files.has(candidate)) ?? null
}

/**
 * Build the graph for a set of files, reading each parsable one from disk.
 *
 * `root` is the directory the paths are relative to. A file that cannot be
 * read is a node with no edges rather than an error: the graph is built from a
 * working tree, and a working tree is allowed to be mid-change.
 */
export function buildGraph(root: string, files: readonly string[], alias: AliasTable = {}): Graph {
  const sorted = [...new Set(files.map(toPosix))].sort()
  const present = new Set(sorted)
  const imports = new Map<string, ReadonlySet<string>>()
  const importers = new Map<string, Set<string>>()
  const external = new Map<string, readonly string[]>()

  for (const file of sorted) {
    importers.set(file, new Set())
  }

  for (const file of sorted) {
    if (!isParsed(file)) {
      imports.set(file, new Set())
      continue
    }

    let source: string

    try {
      source = readFileSync(join(root, file), 'utf8')
    } catch {
      imports.set(file, new Set())
      continue
    }

    const resolved = new Set<string>()
    const unresolved: string[] = []

    for (const specifier of parseSpecifiers(source)) {
      const target = resolveSpecifier(specifier, file, present, alias)

      if (target === null) {
        unresolved.push(specifier)
        continue
      }

      if (target === file) continue

      resolved.add(target)
    }

    imports.set(file, resolved)

    if (unresolved.length > 0) external.set(file, unresolved.sort())

    for (const target of resolved) {
      importers.get(target)?.add(file)
    }
  }

  return { files: sorted, imports, importers, external }
}

/**
 * Every file that reaches a seed by importing it, directly or through others,
 * plus the seeds themselves.
 *
 * The seeds are included because a changed test file is affected by its own
 * change — which is what makes an added test select itself without any special
 * case, and is exactly what a coverage map cannot do.
 *
 * `maxDepth` limits the walk: 1 is "the files that import a changed file", the
 * depth-1 strategy in the matrix, and it is unsafe for a reason the matrix
 * shows twice.
 */
export function reverseReachable(
  graph: Graph,
  seeds: Iterable<string>,
  maxDepth = Number.POSITIVE_INFINITY,
): ReadonlySet<string> {
  const present = new Set(graph.files)
  const reached = new Set<string>()
  let frontier = [...new Set(seeds)].filter((seed) => present.has(seed))

  for (const seed of frontier) reached.add(seed)

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []

    for (const file of frontier) {
      for (const importer of graph.importers.get(file) ?? []) {
        if (reached.has(importer)) continue

        reached.add(importer)
        next.push(importer)
      }
    }

    frontier = next
  }

  return reached
}

/** `root`-relative POSIX path of an absolute one. */
export function relativeTo(root: string, absolute: string): string {
  return toPosix(relative(resolve(root), resolve(absolute)))
}

/** The directory of a repository-relative path, POSIX, `''` at the root. */
export function directoryOf(path: string): string {
  const directory = posix.dirname(path)

  return directory === '.' ? '' : directory
}
