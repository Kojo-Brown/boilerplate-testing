/**
 * Every place in the repository that reads the clock, draws a random number,
 * mints an identifier or schedules work — found by parsing, not by grepping.
 *
 * ---------------------------------------------------------------------------
 * Why a gate and not just a README
 * ---------------------------------------------------------------------------
 * The measurement in `README.md` says which strategies see which faults. It
 * says nothing about whether this repository is using any of them, and a
 * pattern library that documents determinism while quietly reading
 * `Date.now()` in nine places is worse than one that says nothing — the
 * document becomes the evidence.
 *
 * So the same move `mutation/scope.ts` and `snapshot/registry.ts` make: the
 * uses are a closed table. Every site the parser finds must have a row in
 * `registry.ts` giving its disposition and a sentence of reason, and every row
 * must match a site. A new `Math.random()` fails `pnpm test` with the file and
 * line; a row whose site has gone fails too, so the table cannot accumulate
 * entries for code that no longer exists.
 *
 * The failure mode of *not* having this is the one an open table always has:
 * silent and one-directional. Nothing goes red the day somebody reaches for
 * the wall clock in a test. It goes red three months later, on an unrelated
 * pull request, at 2am UTC.
 *
 * ---------------------------------------------------------------------------
 * Why the AST and not a regular expression
 * ---------------------------------------------------------------------------
 * A regular expression over this repository finds nineteen sites outside
 * `determinism/`. Four of them are not uses at all: two string literals in
 * `tdd/characterisation/characterisation.ts` naming the calls it removed, a
 * sentence in a comment in `legacy/renewal.ts`, and a *test title* in
 * `seams.test.ts` — `'reads the wall clock, as the inlined `new Date()` did'`.
 * A gate with a 21% false-positive rate is a gate somebody switches off, and
 * the fix is not a cleverer pattern: it is to ask the parser, which already
 * knows the difference between a call and a sentence about a call.
 *
 * `@typescript-eslint/parser` is already a dependency and already used this
 * way by `shape/classify.ts`, and it reaches no further than turning text into
 * a tree — which is why `shape/boundaries.ts` classifies it as pure.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parseForESLint } from '@typescript-eslint/parser'

import { REPO_ROOT, repoPath } from '../shape/classify.ts'

/** The five sources, as they appear in source text. */
export const SOURCE_KINDS = [
  'wall-clock',
  'monotonic-clock',
  'randomness',
  'identity',
  'scheduler',
] as const

export type SourceKind = (typeof SOURCE_KINDS)[number]

/** One ambient read, located. */
export interface Site {
  /** Repository-relative path. */
  readonly file: string
  readonly line: number
  readonly kind: SourceKind
  /** The call as the parser saw it, e.g. `Date.now`. */
  readonly callee: string
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'coverage',
  'dist',
  'storybook-static',
  'playwright-report',
  'playwright-results',
  '.stryker-tmp',
  'reports',
])

const SOURCE_FILE = /\.(ts|tsx)$/

/**
 * Which call expressions count, keyed by the text of the callee.
 *
 * `new Date()` is handled separately below because it is a `NewExpression`
 * rather than a call, and `new Date(value)` — a timestamp being parsed — is
 * not a clock read at all. That distinction is only available from the tree.
 */
const CALLS: Readonly<Record<string, SourceKind>> = {
  'Date.now': 'wall-clock',
  'performance.now': 'monotonic-clock',
  'process.hrtime': 'monotonic-clock',
  'process.hrtime.bigint': 'monotonic-clock',
  'Math.random': 'randomness',
  'crypto.randomUUID': 'identity',
  'crypto.getRandomValues': 'randomness',
  'randomUUID': 'identity',
  'randomBytes': 'randomness',
  'setTimeout': 'scheduler',
  'setInterval': 'scheduler',
  'globalThis.setTimeout': 'scheduler',
  'globalThis.setInterval': 'scheduler',
}

interface Node {
  readonly type: string
  readonly loc?: { readonly start: { readonly line: number } }
  readonly [key: string]: unknown
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'

/**
 * The dotted name of a callee, or `null` for anything computed.
 *
 * `timers[name]()` and `obj[key]()` deliberately return `null`: a computed
 * member is not something this audit can name, and guessing would be worse
 * than the honest gap recorded in README.md.
 */
function calleeName(node: unknown): string | null {
  if (!isNode(node)) {
    return null
  }

  if (node.type === 'Identifier' && typeof node.name === 'string') {
    return node.name
  }

  if (node.type === 'MemberExpression' && node.computed !== true) {
    const object = calleeName(node.object)
    const property = calleeName(node.property)

    return object === null || property === null ? null : `${object}.${property}`
  }

  return null
}

/** Every site in one already-read source text. */
export function findSites(file: string, source: string): Site[] {
  const { ast } = parseForESLint(source, {
    filePath: file,
    loc: true,
    ecmaFeatures: { jsx: file.endsWith('.tsx') },
  })

  const sites: Site[] = []

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child)
      }

      return
    }

    if (!isNode(node)) {
      return
    }

    if (node.type === 'CallExpression') {
      const name = calleeName(node.callee)
      const kind = name === null ? undefined : CALLS[name]

      if (name !== null && kind !== undefined) {
        sites.push({ file, line: node.loc?.start.line ?? 0, kind, callee: name })
      }
    }

    // `new Date()` with no argument reads the clock. `new Date(ms)` parses a
    // value somebody already has and is not a source of anything.
    if (
      node.type === 'NewExpression' &&
      calleeName(node.callee) === 'Date' &&
      Array.isArray(node.arguments) &&
      node.arguments.length === 0
    ) {
      sites.push({ file, line: node.loc?.start.line ?? 0, kind: 'wall-clock', callee: 'new Date' })
    }

    for (const key of Object.keys(node)) {
      if (key !== 'parent') {
        visit(node[key])
      }
    }
  }

  visit(ast)

  return sites
}

/** Every TypeScript file in the repository, sorted, repo-relative. */
export function findSourceFiles(root: string = REPO_ROOT): string[] {
  const found: string[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(entry)) {
        continue
      }

      const path = join(dir, entry)

      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (SOURCE_FILE.test(entry)) {
        found.push(repoPath(path, root))
      }
    }
  }

  walk(root)

  return found
}

/** Every site in the repository, in file then line order. */
export function scanRepository(root: string = REPO_ROOT): Site[] {
  return findSourceFiles(root).flatMap((file) =>
    findSites(file, readFileSync(join(root, file), 'utf8')),
  )
}
