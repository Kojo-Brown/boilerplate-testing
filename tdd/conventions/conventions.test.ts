// @vitest-environment node
/**
 * The audit that keeps this folder's claims true.
 *
 * Three of them, in rising order of how badly they would rot on their own:
 *
 *   1. **The two suites are the same suite.** `aaa.test.ts` and `gwt.test.ts`
 *      only compare two shapes if they state the same eight behaviours, and
 *      nothing about running them both green would notice a ninth case on one
 *      side. So both files are parsed and checked against `behaviours.ts`.
 *   2. **The README describes the rules that exist.** Including — especially —
 *      the sentences about what each rule *cannot* decide, which is the part a
 *      reader would otherwise stop checking by hand.
 *   3. **`eslint.config.js` actually switches them on.** A plugin can be
 *      perfect and wired to nothing. The last block here runs the repository's
 *      real ESLint configuration over deliberately bad snippets at the paths
 *      the config is supposed to cover, so the answer comes from ESLint rather
 *      than from reading the config file and hoping.
 *
 * The parse uses `typescript-eslint`'s parser and the plugin's own `ast.ts`
 * helpers, so the audit reads test calls exactly the way the rules do.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import tseslint from 'typescript-eslint'

import { BEHAVIOURS } from './behaviours'
import type { GwtTitle } from './behaviours'
import { CONVENTIONS, REPO_WIDE_RULE, RULE_IDS, SHAPE_COUNTS } from './conventions'
import { isCallExpression, staticTitle, testCallKind } from './eslint-plugin/ast'
import type { EsNode, TestCallKind } from './eslint-plugin/ast'
import { GWT_PREFIXES } from './eslint-plugin/vocabulary'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(here, '..', '..')
const readme = readFileSync(join(here, 'README.md'), 'utf8')
/**
 * The README with its line wrapping flattened. Every prose claim below is
 * checked against this rather than the raw text, so re-wrapping a paragraph is
 * an edit to the prose and not a test failure.
 */
const readmeText = readme.replace(/\s+/gu, ' ')

// ---------------------------------------------------------------------------
// Reading a suite the way the rules read it
// ---------------------------------------------------------------------------

interface Block {
  readonly kind: TestCallKind
  readonly title: string | null
  readonly children: Block[]
}

/**
 * Walk `value`, collecting the test calls *directly* inside it — descending
 * through ordinary syntax and stopping the moment a test call is found, so a
 * case nested in a describe is that describe's child and nobody else's.
 *
 * A generic walk rather than a visitor keyed by node type: the audit only ever
 * asks "is this a test call", so anything that recurses honestly will do, and
 * a generic one cannot fall behind a syntax node the parser learns later.
 */
function collectInto(value: unknown, out: Block[], root: unknown): void {
  if (Array.isArray(value)) {
    for (const element of value) {
      collectInto(element, out, root)
    }

    return
  }

  if (typeof value !== 'object' || value === null) {
    return
  }

  const node = value as EsNode

  if (typeof node.type === 'string' && value !== root && isCallExpression(node)) {
    const kind = testCallKind(node)

    if (kind !== null) {
      out.push({ kind, title: staticTitle(node), children: blocksIn(node) })

      return
    }
  }

  for (const [key, child] of Object.entries(value)) {
    // `parent` is a back-reference the parser adds; following it never ends.
    if (key !== 'parent') {
      collectInto(child, out, root)
    }
  }
}

function blocksIn(node: unknown): Block[] {
  const blocks: Block[] = []

  collectInto(node, blocks, node)

  return blocks
}

function parseSuite(fileName: string): Block[] {
  const source = readFileSync(join(here, fileName), 'utf8')
  // `parseForESLint`, not `parse`: the flat-config parser object exposes only
  // the former, and it is the entry point ESLint itself calls. No options are
  // needed because nothing below reads a position — the audit asks which call
  // this is and what its title says, and both are in the tree by default.
  const { ast } = tseslint.parser.parseForESLint(source)

  return blocksIn(ast)
}

function stripPrefix(title: string | null, prefix: string): string {
  if (title === null || !title.startsWith(prefix)) {
    throw new Error(`expected a title starting with ${JSON.stringify(prefix)}, got ${title}`)
  }

  return title.slice(prefix.length)
}

// ---------------------------------------------------------------------------
// 1. The two suites are the same suite
// ---------------------------------------------------------------------------

describe('the two demonstrations', () => {
  const aaaTopLevel = parseSuite('aaa.test.ts')
  const gwtTopLevel = parseSuite('gwt.test.ts')

  it('states every behaviour once in aaa.test.ts, in order', () => {
    const suites = aaaTopLevel.filter((block) => block.kind === 'suite')
    const cases = suites.flatMap((suite) => suite.children).filter((block) => block.kind === 'case')

    expect(cases.map((block) => block.title)).toEqual(BEHAVIOURS.map((entry) => entry.aaaTitle))
  })

  it('states every behaviour once in gwt.test.ts, in order', () => {
    const stated: GwtTitle[] = []

    for (const given of gwtTopLevel) {
      for (const when of given.children) {
        for (const then of when.children) {
          stated.push({
            given: stripPrefix(given.title, GWT_PREFIXES.given),
            when: stripPrefix(when.title, GWT_PREFIXES.when),
            then: stripPrefix(then.title, GWT_PREFIXES.then),
          })
        }
      }
    }

    expect(stated).toEqual(BEHAVIOURS.map((entry) => entry.gwt))
  })

  it('has the block counts the README reports', () => {
    const whenBlocks = gwtTopLevel.flatMap((given) => given.children)

    expect({
      givenBlocks: gwtTopLevel.length,
      whenBlocks: whenBlocks.length,
      cases: whenBlocks.flatMap((when) => when.children).length,
    }).toEqual({
      givenBlocks: SHAPE_COUNTS.givenBlocks,
      whenBlocks: SHAPE_COUNTS.whenBlocks,
      cases: SHAPE_COUNTS.behaviours,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. The README describes the rules that exist
// ---------------------------------------------------------------------------

describe('the README', () => {
  it('quotes what each rule decides, and what it does not', () => {
    const missing = CONVENTIONS.flatMap((entry) =>
      [...entry.decides, entry.cannotDecide, entry.ruleId, entry.demonstration].filter(
        (claim) => !readmeText.includes(claim),
      ),
    )

    expect(missing).toEqual([])
  })

  it('reports the block counts this folder actually has', () => {
    const sentence = `${SHAPE_COUNTS.givenBlocks} \`Given\` blocks and ${SHAPE_COUNTS.whenBlocks} \`When\` blocks wrap ${SHAPE_COUNTS.behaviours} cases`

    expect(readmeText).toContain(sentence)
    expect(readmeText).toContain(
      `${SHAPE_COUNTS.soleOccupantWhenBlocks} of those \`When\` blocks hold one case each`,
    )
  })

  it('lists every file in the folder', () => {
    function walk(directory: string, prefix: string): string[] {
      return readdirSync(join(here, directory), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(directory, entry.name), `${prefix}${entry.name}/`)
          : [`${prefix}${entry.name}`],
      )
    }

    const undocumented = walk('.', '')
      .filter((name) => name !== 'README.md')
      .filter((name) => !readme.includes(name))

    expect(undocumented).toEqual([])
  })

  it('names every rule the plugin publishes', () => {
    expect(RULE_IDS.filter((ruleId) => !readmeText.includes(ruleId))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. `eslint.config.js` actually switches them on
// ---------------------------------------------------------------------------

describe('the repository lint configuration', () => {
  const eslint = new ESLint({ cwd: repoRoot })

  /**
   * The plugin's rule ids ESLint reports for `code`, as if it lived at `path`.
   *
   * Filtered to this plugin so the assertions stay about the wiring under test
   * rather than about whatever else the shared config has an opinion on.
   */
  async function ruleIdsFor(code: string, path: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, {
      filePath: join(repoRoot, path),
      warnIgnored: false,
    })

    return (result?.messages ?? [])
      .flatMap((message) => (typeof message.ruleId === 'string' ? [message.ruleId] : []))
      .filter((ruleId) => ruleId.startsWith('test-conventions/'))
  }

  it('rejects a modal title anywhere in the repository', async () => {
    const ruleIds = await ruleIdsFor(
      "it('should return 404', () => { expect(1).toBe(1) })",
      'supertest/somewhere.test.ts',
    )

    expect(ruleIds).toContain(REPO_WIDE_RULE)
  })

  it('leaves titles alone in files that are not tests', async () => {
    const ruleIds = await ruleIdsFor(
      "export const label = 'should return 404'",
      'tdd/conventions/notATest.ts',
    )

    expect(ruleIds).not.toContain(REPO_WIDE_RULE)
  })

  it('holds gwt.test.ts to the Given/When/Then scheme', async () => {
    const ruleIds = await ruleIdsFor(
      "describe('assessRefund', () => { it('then it is denied', () => {}) })",
      'tdd/conventions/gwt.test.ts',
    )

    expect(ruleIds).toEqual([REPO_WIDE_RULE])
  })

  it('holds aaa.test.ts to the Arrange-Act-Assert structure', async () => {
    const ruleIds = await ruleIdsFor(
      "it('returns the total', () => { expect(sum([])).toBe(0) })",
      'tdd/conventions/aaa.test.ts',
    )

    expect(ruleIds).toContain('test-conventions/aaa-structure')
  })

  it('passes both demonstrations as they are committed', async () => {
    const results = await eslint.lintFiles([
      join(here, 'aaa.test.ts'),
      join(here, 'gwt.test.ts'),
    ])

    expect(results.flatMap((result) => result.messages)).toEqual([])
  })
})
