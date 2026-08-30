/**
 * Finding every snapshot in the repository.
 *
 * A policy that is written in a README governs the snapshots somebody
 * remembered to read the README about. This module is the other half: it
 * enumerates what actually exists on disk, so `policy.ts` can hold *all* of it
 * to the registry rather than the subset anybody thought to declare.
 *
 * Two forms, found two ways:
 *
 *   - **File snapshots** live in `__snapshots__/*.snap`, which are JavaScript
 *     modules of `exports[key] = value` assignments. They are read as text and
 *     split on the assignment, not evaluated: a `.snap` file is generated code
 *     and importing generated code to audit it is a way to be lied to.
 *   - **Inline snapshots** are `toMatchInlineSnapshot(\`…\`)` calls in test
 *     sources, found with `@typescript-eslint/parser` — the same parser
 *     `shape/classify.ts` uses, and for the same reason. A regex over
 *     `toMatchInlineSnapshot` cannot tell where the template ends, and getting
 *     that wrong silently understates every snapshot's size, which is the one
 *     number the budget rule depends on.
 *
 * An inline snapshot is keyed by the title of the test that contains it rather
 * than by a line number, because a line number changes every time anything
 * above it does, and a registry keyed on line numbers is a registry nobody
 * keeps accurate.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseForESLint } from '@typescript-eslint/parser'

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Directories never worth walking: build output, vendored code, generated reports. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.stryker-tmp',
  'coverage',
  'dist',
  'storybook-static',
  'playwright-report',
  'playwright-results',
  'reports',
])

export type SnapshotKind = 'file' | 'inline'

/** One snapshot, wherever it was found. */
export interface FoundSnapshot {
  readonly kind: SnapshotKind
  /**
   * Repo-relative path of the *test file* the snapshot belongs to.
   *
   * For a file snapshot that is the test file, not the `.snap` — the registry
   * should read the way a person thinks about it, and nobody thinks of a
   * snapshot as belonging to `__snapshots__/x.test.ts.snap`.
   */
  readonly file: string
  /**
   * The snapshot's name: the full `describe > it` key with Vitest's trailing
   * counter for a file snapshot, and the enclosing test's title for an inline
   * one.
   */
  readonly name: string
  /** Lines of snapshot content, which is what a reviewer is asked to read. */
  readonly lines: number
  /** The content itself, so the volatility rules have something to scan. */
  readonly content: string
}

const toPosix = (path: string): string => path.split('\\').join('/')

/** Every file under `root` matching `predicate`, depth-first, skipping build output. */
export function walk(root: string, predicate: (path: string) => boolean): string[] {
  const found: string[] = []

  const recurse = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)

      if (statSync(path).isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry)) {
          recurse(path)
        }
      } else if (predicate(path)) {
        found.push(path)
      }
    }
  }

  recurse(root)

  return found.sort()
}

// ---------------------------------------------------------------------------
// File snapshots
// ---------------------------------------------------------------------------
/**
 * `exports[\`name\`] = \`content\`;` — Vitest's snapshot serialisation.
 *
 * The name is backtick-quoted and the content is a template literal, so the
 * terminator is the first `` `; `` at the start of a line. Matching lazily up
 * to that is what keeps a snapshot containing a backtick from truncating the
 * entry.
 */
const SNAP_ENTRY = /^exports\[`((?:[^`\\]|\\.)*)`\]\s*=\s*`([\s\S]*?)`;$/gm

/** The test file a `.snap` belongs to: `__snapshots__/x.test.ts.snap` → `x.test.ts`. */
export function testFileFor(snapPath: string): string {
  const posix = toPosix(snapPath)
  const withoutSuffix = posix.replace(/\.snap$/, '')

  return withoutSuffix.replace(/__snapshots__\//, '')
}

/**
 * Strip the delimiters a serialiser adds around a template's content.
 *
 * The trailing pattern allows indentation before the closing backtick, which
 * an inline snapshot always has — it sits at the test's indent level. Without
 * that, every inline snapshot measures one line longer than it is, and a
 * budget rule built on an inflated count is a rule that fires on the wrong
 * snapshots.
 */
const trim = (raw: string): string => raw.replace(/^\n/, '').replace(/\n[ \t]*$/, '')

export function readSnapFile(absolutePath: string, root: string = REPO_ROOT): FoundSnapshot[] {
  const source = readFileSync(absolutePath, 'utf8')
  const file = testFileFor(relative(root, absolutePath))

  return [...source.matchAll(SNAP_ENTRY)].map((match) => {
    // Vitest wraps a string snapshot in its own quotes inside the template.
    // They are content as far as a reviewer is concerned, so the line count
    // keeps them; the delimiters the serialiser adds are not, so they go.
    const content = trim(match[2] ?? '')

    return {
      kind: 'file' as const,
      file,
      name: match[1] ?? '',
      lines: content === '' ? 0 : content.split('\n').length,
      content,
    }
  })
}

// ---------------------------------------------------------------------------
// Inline snapshots
// ---------------------------------------------------------------------------
interface Node {
  readonly type: string
  readonly [key: string]: unknown
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'

const TEST_CALLEES = new Set(['it', 'test'])

/** The snapshot matchers this repository knows how to audit. */
export const INLINE_MATCHERS = new Set(['toMatchInlineSnapshot', 'toThrowErrorMatchingInlineSnapshot'])

/**
 * Walk a test file, tracking the enclosing `it`/`test` title.
 *
 * `parent` is skipped for the reason `shape/classify.ts` documents: the parser
 * adds it as a back-reference and following it never terminates.
 */
function visitWithTitle(value: unknown, title: string, fn: (node: Node, title: string) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      visitWithTitle(child, title, fn)
    }

    return
  }

  if (!isNode(value)) {
    return
  }

  fn(value, title)

  const nested = titleOf(value) ?? title

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'parent') {
      visitWithTitle(child, nested, fn)
    }
  }
}

/**
 * The identifier a call chain starts from: `it` for all of `it(…)`,
 * `it.skip(…)`, `it.each(rows)(…)` and `it.each(rows).skip(…)`.
 */
function rootCalleeName(callee: unknown): string | null {
  if (!isNode(callee)) {
    return null
  }

  if (callee.type === 'Identifier') {
    return typeof callee.name === 'string' ? callee.name : null
  }

  if (callee.type === 'MemberExpression') {
    return rootCalleeName(callee.object)
  }

  if (callee.type === 'CallExpression') {
    return rootCalleeName(callee.callee)
  }

  return null
}

/** The literal title of an `it('…', …)` call, or `null` for anything else. */
function titleOf(node: Node): string | null {
  if (node.type !== 'CallExpression') {
    return null
  }

  // `it(…)`, `it.skip(…)`, `it.each(rows)(…)` — the name is whatever the call
  // chain starts from, so unwrap a callee that is itself a call before looking
  // at it. `it.each` is the form that would otherwise be missed, and missing a
  // form means its snapshots are invisible to the registry.
  const name = rootCalleeName(node.callee)

  if (name === null || !TEST_CALLEES.has(name)) {
    return null
  }

  const first = Array.isArray(node.arguments) ? node.arguments[0] : undefined

  return isNode(first) && first.type === 'Literal' && typeof first.value === 'string'
    ? first.value
    : null
}

/** The string a template literal spells out, or `null` when it interpolates. */
function templateText(node: unknown): string | null {
  if (!isNode(node) || node.type !== 'TemplateLiteral') {
    return null
  }

  const quasis = node.quasis

  if (!Array.isArray(quasis) || quasis.length !== 1) {
    // An interpolated snapshot is not a snapshot — its expected value is
    // computed at run time. `policy.ts` reports it rather than measuring it.
    return null
  }

  const cooked = isNode(quasis[0]) ? (quasis[0].value as { raw?: unknown })?.raw : undefined

  return typeof cooked === 'string' ? cooked : null
}

/**
 * A snapshot call with no argument at all.
 *
 * `toMatchInlineSnapshot()` is valid and means "fill me in on the next run".
 * Committed, it is a test that asserts nothing until someone runs `-u`, so the
 * inventory records it with an empty body and `policy.ts` fails it.
 */
export interface FoundInline extends FoundSnapshot {
  readonly matcher: string
  /** False when the call has no argument, or an argument that is not a plain template. */
  readonly literal: boolean
}

export function readInlineSnapshots(absolutePath: string, root: string = REPO_ROOT): FoundInline[] {
  const source = readFileSync(absolutePath, 'utf8')
  const file = toPosix(relative(root, absolutePath))
  const { ast } = parseForESLint(source, {
    filePath: absolutePath,
    ecmaFeatures: { jsx: absolutePath.endsWith('.tsx') },
  })

  const found: FoundInline[] = []

  visitWithTitle(ast, '', (node, title) => {
    if (node.type !== 'CallExpression' || !isNode(node.callee)) {
      return
    }

    const callee = node.callee

    if (callee.type !== 'MemberExpression' || !isNode(callee.property)) {
      return
    }

    const matcher = callee.property.name

    if (typeof matcher !== 'string' || !INLINE_MATCHERS.has(matcher)) {
      return
    }

    const args = Array.isArray(node.arguments) ? node.arguments : []
    const text = args.length === 0 ? null : templateText(args[0])
    const content = trim(text ?? '')

    found.push({
      kind: 'inline',
      file,
      name: title,
      matcher,
      literal: text !== null,
      lines: content.trim() === '' ? 0 : content.split('\n').length,
      content,
    })
  })

  return found
}

// ---------------------------------------------------------------------------
// The whole repository
// ---------------------------------------------------------------------------
const isSnapFile = (path: string): boolean => path.endsWith('.snap')

const isTestFile = (path: string): boolean =>
  /\.(test|spec)\.tsx?$/.test(path) && !path.includes('__snapshots__')

export interface Inventory {
  readonly snapshots: readonly FoundSnapshot[]
  readonly inline: readonly FoundInline[]
  /** Repo-relative paths of every `.snap` file found, for the report. */
  readonly snapFiles: readonly string[]
}

export function takeInventory(root: string = REPO_ROOT): Inventory {
  const snapFiles = walk(root, isSnapFile)
  const fileSnapshots = snapFiles.flatMap((path) => readSnapFile(path, root))
  const inline = walk(root, isTestFile).flatMap((path) => readInlineSnapshots(path, root))

  return {
    snapshots: [...fileSnapshots, ...inline],
    inline,
    snapFiles: snapFiles.map((path) => toPosix(relative(root, path))),
  }
}
