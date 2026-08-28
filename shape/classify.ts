/**
 * Deriving each test file's layer from what it can reach.
 *
 * The rule is stated in `boundaries.ts`; this module is the machinery that
 * applies it. Three steps, each of which has a way to fail loudly rather than
 * guess:
 *
 *   1. Parse a file and read its imports — with the real parser, not a regex.
 *   2. Follow every import that resolves to a file in this repository, and
 *      collect the external modules the whole reachable set imports.
 *   3. Look each one up in the closed table. Widest boundary wins; an
 *      unclassified module is a failure.
 *
 * Step 1 uses `typescript-eslint`'s parser rather than a regex, and that is not
 * fastidiousness. The first version of this file matched imports with a regex
 * and reported that `tdd/doubles/stub.ts` imports a module called
 * `guessed the number` — a phrase from a prose comment, matched because the
 * pattern was allowed to run across lines. A test census that invents a
 * dependency is worse than no census, and the parser is already a dependency
 * of this repository: `tdd/conventions/` lints with it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// `@typescript-eslint/parser` directly rather than `tseslint.parser`, which the
// rest of the repository uses. The `typescript-eslint` wrapper re-exports the
// parser through a `CompatibleParser` interface that declares
// `parseForESLint(text: string)` with no options parameter — enough for
// `tdd/conventions/`, which parses `.ts` only, and not enough here: without
// `ecmaFeatures.jsx` the two `.tsx` test files fail to parse, and a census that
// silently skips files is the thing this module exists to prevent. It is the
// same package at the same version, already in the tree as a transitive
// dependency of `typescript-eslint`; declaring it makes that explicit.
import { parseForESLint } from '@typescript-eslint/parser'
import {
  classifyModule,
  LAYER_RANK,
  moduleKey,
  type Layer,
  type UnclassifiedModule,
} from './boundaries.ts'

/** Absolute path of the repository root. */
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Directories the census never descends into.
 *
 * Build output and vendored code, mirroring `eslint.config.js`'s global
 * ignores. A test file inside `storybook-static/` would be a copy of one that
 * is already counted.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'coverage',
  'dist',
  'storybook-static',
  'playwright-report',
  'playwright-results',
  // Stryker copies the whole repository into `.stryker-tmp/sandbox-*` and
  // deletes it again when the run succeeds. A crashed or interrupted run
  // leaves it behind, and every test file in this repository is then in the
  // tree twice — which would silently double the census and, because the copy
  // has the same imports, leave the ratio looking unchanged while every count
  // in the report is wrong.
  '.stryker-tmp',
  'reports',
])

/** What the census counts as a test file: the two runners' own conventions. */
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/

/** Extensions tried, in order, when resolving a relative import to a file. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx']

/** One import, as written. */
export interface ImportRef {
  /** The module specifier exactly as it appears in the source. */
  readonly specifier: string
  /**
   * The imported name: a named import's name, `'default'`, `'*'` for a
   * namespace import, or `null` for a side-effect import (`import 'x'`). One
   * entry per binding, so `import { A, B } from 'm'` yields two refs.
   */
  readonly binding: string | null
}

/** Why a test file is in the layer it is in. */
export interface Evidence {
  readonly specifier: string
  readonly binding: string | null
  /** The real resource reached, from the table. */
  readonly resource: string
  /** The layer this single boundary forces. */
  readonly layer: Layer
  /**
   * How the test reaches it: repo-relative paths from the test file to the
   * file that does the importing. One entry long when the test imports it
   * directly.
   */
  readonly via: readonly string[]
}

/** A test file, classified. */
export interface FileClassification {
  /** Repo-relative path, with forward slashes. */
  readonly file: string
  readonly layer: Layer
  /**
   * Every boundary the file reaches, widest first. Empty for a unit test —
   * which is the point: a unit test is defined by the absence of evidence, not
   * by a label, and the report prints that absence rather than hiding it.
   */
  readonly evidence: readonly Evidence[]
}

/** The whole census, before any test counts are attached. */
export interface Classification {
  readonly files: readonly FileClassification[]
  /** Modules reached from a test file that the table does not classify. */
  readonly unclassified: readonly UnclassifiedModule[]
  /** Files the parser could not read, with the parser's message. */
  readonly unparsable: readonly { readonly file: string; readonly message: string }[]
}

const toPosix = (path: string): string => path.split('\\').join('/')

/**
 * Repo-relative, forward-slashed path — the form every key and report uses.
 *
 * `root` is a parameter rather than a constant so the classifier can be run
 * over a fixture tree in a temp directory. A census that could only ever be
 * pointed at this repository would be a hard thing to write tests for, which
 * is an odd property for a module in a repository about testing.
 */
export const repoPath = (absolute: string, root: string = REPO_ROOT): string =>
  toPosix(relative(root, absolute))

/**
 * Every test file in the repository, sorted, as absolute paths.
 *
 * Deliberately not asked of either runner. Vitest's default project excludes
 * `pact/**` and `playwright/**`, and Playwright only knows its own `testDir` —
 * so asking a runner "what are the test files" would return the subset it
 * happens to own, and the ratio would be computed over part of the suite while
 * looking like it covered all of it.
 */
export function findTestFiles(root: string = REPO_ROOT): string[] {
  const found: string[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(entry)) {
        continue
      }

      const path = join(dir, entry)

      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (TEST_FILE.test(entry)) {
        found.push(path)
      }
    }
  }

  walk(root)

  return found
}

// ---------------------------------------------------------------------------
// Reading imports
// ---------------------------------------------------------------------------

/** The minimum an AST node has to have for the walk below to look at it. */
interface Node {
  readonly type: string
  readonly [key: string]: unknown
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string'

/**
 * Depth-first walk over every node in a tree.
 *
 * Written generically over the node's own keys rather than against a table of
 * node types, so a syntax the parser learns later cannot hide an import behind
 * it. `parent` is skipped because the parser adds it as a back-reference and
 * following it never terminates — the same trap `tdd/conventions/` documents.
 */
function visit(value: unknown, fn: (node: Node) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      visit(child, fn)
    }

    return
  }

  if (!isNode(value)) {
    return
  }

  fn(value)

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'parent') {
      visit(child, fn)
    }
  }
}

const literalString = (value: unknown): string | null =>
  isNode(value) && value.type === 'Literal' && typeof value.value === 'string' ? value.value : null

/**
 * True when an import is erased before anything runs.
 *
 * `import type { Rule } from 'eslint'` reaches nothing: TypeScript removes it,
 * and the module is never loaded. Counting it as a reach was this census's
 * first false positive — the two ESLint *rule* modules import ESLint's types
 * and nothing else from it, which would have dragged every test that lints
 * into the middle band for a type annotation.
 *
 * Both spellings are erased and both are checked: `import type { A }` marks
 * the declaration, `import { type A }` marks the specifier.
 */
const isTypeOnly = (node: Node): boolean =>
  node['importKind'] === 'type' || node['exportKind'] === 'type'

/**
 * Bindings introduced by an `import` declaration's specifier list.
 *
 * An empty list means a side-effect import, which the caller records as a
 * single `null` binding — `import 'x'` still reaches whatever `x` reaches.
 * Type-only specifiers are dropped; a declaration whose specifiers are *all*
 * type-only yields nothing at all.
 */
function bindingsOf(node: Node): (string | null)[] {
  const specifiers = node['specifiers']

  if (!Array.isArray(specifiers) || specifiers.length === 0) {
    return [null]
  }

  const bindings: (string | null)[] = []

  for (const specifier of specifiers) {
    if (!isNode(specifier) || isTypeOnly(specifier)) {
      continue
    }

    if (specifier.type === 'ImportDefaultSpecifier') {
      bindings.push('default')

      continue
    }

    if (specifier.type === 'ImportNamespaceSpecifier') {
      bindings.push('*')

      continue
    }

    const imported = specifier['imported']

    if (isNode(imported) && imported.type === 'Identifier' && typeof imported.name === 'string') {
      bindings.push(imported.name)

      continue
    }

    // A string-literal import name (`import { 'a-b' as ab }`) or a shape the
    // parser reports differently. Fall back to the bare specifier lookup.
    bindings.push(null)
  }

  return bindings
}

/** Parse a file and return every module it imports, with bindings. */
export function readImports(absolutePath: string): ImportRef[] {
  const source = readFileSync(absolutePath, 'utf8')
  const { ast } = parseForESLint(source, {
    filePath: absolutePath,
    ecmaFeatures: { jsx: absolutePath.endsWith('.tsx') },
  })

  const refs: ImportRef[] = []
  const add = (specifier: string | null, binding: string | null): void => {
    if (specifier !== null) {
      refs.push({ specifier, binding })
    }
  }

  visit(ast, (node) => {
    switch (node.type) {
      case 'ImportDeclaration': {
        if (isTypeOnly(node)) {
          return
        }

        const specifier = literalString(node['source'])

        for (const binding of bindingsOf(node)) {
          add(specifier, binding)
        }

        return
      }

      // `export { x } from 'm'` and `export * from 'm'` pull the module in as
      // surely as an import does. `playwright/fixtures/index.ts` is nothing
      // but re-exports, and dropping them would make four Playwright specs
      // look like unit tests.
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration': {
        if (isTypeOnly(node)) {
          return
        }

        add(literalString(node['source']), null)

        return
      }

      // `await import('m')`. The specifier has to be a literal to be readable;
      // a computed one is a genuine blind spot and there are none here.
      case 'ImportExpression': {
        add(literalString(node['source']), null)

        return
      }

      // `typeof import('m')` in a type annotation is erased like any other
      // type import, so it is deliberately *not* a reach and not handled here.

      case 'CallExpression': {
        const callee = node['callee']

        if (isNode(callee) && callee.type === 'Identifier' && callee.name === 'require') {
          const args = node['arguments']

          if (Array.isArray(args)) {
            add(literalString(args[0]), null)
          }
        }

        return
      }

      default:
    }
  })

  return refs
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an import to a file in this repository, or `null` if it is external.
 *
 * Handles the two local forms this repository uses: relative paths and the
 * `@/` alias that `vitest.config.ts` and `tsconfig.json` both map to the root.
 * `.ts` is tried with and without the extension already present, because
 * `tsconfig.json` sets `allowImportingTsExtensions` and the ESLint plugin's
 * modules import each other with the extension spelled out.
 */
export function resolveLocal(
  fromFile: string,
  specifier: string,
  root: string = REPO_ROOT,
): string | null {
  let base: string

  if (specifier.startsWith('@/')) {
    base = join(root, specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier)
  } else {
    return null
  }

  const withoutExtension = base.replace(/\.(ts|tsx|js|jsx)$/, '')
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => withoutExtension + extension),
    ...RESOLVE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify one test file by walking everything it can reach.
 *
 * Breadth-first so that `via` records the *shortest* import chain to each
 * boundary, which is the one a reader can follow fastest when the report says
 * a file is an integration test and they disagree.
 */
function classifyFile(
  testFile: string,
  root: string,
  cache: Map<string, ImportRef[]>,
  unclassified: UnclassifiedModule[],
  unparsable: { file: string; message: string }[],
): FileClassification {
  const relativeTestFile = repoPath(testFile, root)
  const seen = new Set<string>([testFile])
  const queue: { file: string; via: string[] }[] = [{ file: testFile, via: [] }]
  const evidence: Evidence[] = []
  const recorded = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()

    if (current === undefined) {
      break
    }

    let refs = cache.get(current.file)

    if (refs === undefined) {
      try {
        refs = readImports(current.file)
      } catch (error) {
        unparsable.push({
          file: repoPath(current.file, root),
          message: error instanceof Error ? error.message : String(error),
        })
        refs = []
      }

      cache.set(current.file, refs)
    }

    for (const ref of refs) {
      const local = resolveLocal(current.file, ref.specifier, root)

      if (local !== null) {
        if (!seen.has(local)) {
          seen.add(local)
          queue.push({ file: local, via: [...current.via, repoPath(local, root)] })
        }

        continue
      }

      const classified = classifyModule(ref.specifier, ref.binding)

      if (classified === null) {
        unclassified.push({
          specifier: ref.specifier,
          binding: ref.binding,
          file: repoPath(current.file, root),
        })

        continue
      }

      if (classified.kind !== 'boundary') {
        continue
      }

      // One entry per distinct boundary reached. Keyed on the table entry that
      // matched rather than on the import: a Playwright spec destructuring
      // `test`, `expect`, `Page` and `Browser` reaches one browser, not four.
      const key = moduleKey(ref.specifier, ref.binding)

      if (key === null || recorded.has(key)) {
        continue
      }

      recorded.add(key)
      evidence.push({
        specifier: ref.specifier,
        binding: key === ref.specifier ? null : ref.binding,
        resource: classified.resource,
        layer: classified.layer,
        via: [relativeTestFile, ...current.via],
      })
    }
  }

  evidence.sort(
    (a, b) => LAYER_RANK[b.layer] - LAYER_RANK[a.layer] || a.specifier.localeCompare(b.specifier),
  )

  const layer = evidence.reduce<Layer>(
    (widest, found) => (LAYER_RANK[found.layer] > LAYER_RANK[widest] ? found.layer : widest),
    'unit',
  )

  return { file: relativeTestFile, layer, evidence }
}

/** Classify every test file under `root`. */
export function classifyRepository(
  root: string = REPO_ROOT,
  files: readonly string[] = findTestFiles(root),
): Classification {
  const cache = new Map<string, ImportRef[]>()
  const unclassified: UnclassifiedModule[] = []
  const unparsable: { file: string; message: string }[] = []
  const classified = files.map((file) => classifyFile(file, root, cache, unclassified, unparsable))

  return { files: classified, unclassified, unparsable }
}
