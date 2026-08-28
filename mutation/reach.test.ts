// @vitest-environment node
//
// Reads and writes a fixture tree on disk, and resolves paths relative to
// `import.meta.url`. Under the project-default jsdom environment that URL is
// rewritten to an http: one and `fileURLToPath` throws, so this file opts back
// into the node environment — the same reason `workflow-templates/` does.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { coveringSuites, suitesReaching } from './reach'
import { SCOPE } from './scope'

/**
 * A fixture repository, written to a temp directory.
 *
 * Pointing the walk at a tree built for the case is what makes the interesting
 * situations statable at all: a suite that reaches the target through two
 * hops, a suite that imports only its types, a module nothing reaches. Every
 * one of those exists in this repository too, but asserting on them there
 * means writing down facts about `property/` that go stale the next time
 * somebody adds a suite.
 */
const FIXTURE: Readonly<Record<string, string>> = {
  'lib/target.ts': 'export const target = (): number => 1\n',
  'lib/middle.ts': "export { target } from './target'\n",
  'lib/other.ts': 'export const other = (): number => 2\n',

  'direct.test.ts': "import { target } from './lib/target'\nconst _ = target\n",
  'transitive.test.ts': "import { target } from './lib/middle'\nconst _ = target\n",
  'aliased.test.ts': "import { target } from '@/lib/target'\nconst _ = target\n",
  'typeonly.test.ts': "import type { target } from './lib/target'\nexport type T = typeof target\n",
  'elsewhere.test.ts': "import { other } from './lib/other'\nconst _ = other\n",
  'nested/deep.spec.ts': "import { target } from '../lib/middle'\nconst _ = target\n",
}

let root = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mutation-reach-'))

  for (const [path, source] of Object.entries(FIXTURE)) {
    const file = join(root, path)

    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, source)
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const reaching = (module: string): readonly string[] =>
  suitesReaching([module], root).get(module) ?? []

describe('suitesReaching', () => {
  it('finds a suite that imports the module directly', () => {
    expect(reaching('lib/target.ts')).toContain('direct.test.ts')
  })

  it('finds a suite that reaches the module through another module', () => {
    // The case a direct-import scan gets wrong, and the reason the walk is
    // transitive: `property/detection.test.ts` reaches `availability.ts`
    // through two hops and never names it.
    expect(reaching('lib/target.ts')).toContain('transitive.test.ts')
  })

  it('follows a re-export as an import, because it pulls the module in', () => {
    expect(reaching('lib/target.ts')).toContain('nested/deep.spec.ts')
  })

  it('resolves the `@/` alias the same way the runner does', () => {
    expect(reaching('lib/target.ts')).toContain('aliased.test.ts')
  })

  it('leaves out a suite that imports only the module’s types', () => {
    // A type-only import is erased before the tests run, so that suite cannot
    // kill one of the module's mutants. Loading it would cost dry-run time and
    // put a row in the attribution that can never have a number in it.
    expect(reaching('lib/target.ts')).not.toContain('typeonly.test.ts')
  })

  it('leaves out a suite that reaches a different module', () => {
    expect(reaching('lib/target.ts')).not.toContain('elsewhere.test.ts')
  })

  it('returns an empty list rather than no entry for a module nothing reaches', () => {
    // An empty list is a finding — a scoped module with no suite behind it
    // scores zero — so it has to be representable rather than missing.
    expect(suitesReaching(['lib/unreached.ts'], root).get('lib/unreached.ts')).toEqual([])
  })

  it('answers for several modules in one walk', () => {
    const found = suitesReaching(['lib/target.ts', 'lib/other.ts'], root)

    expect(found.get('lib/other.ts')).toEqual(['elsewhere.test.ts'])
    expect(found.get('lib/target.ts')).toHaveLength(4)
  })

  it('sorts each module’s suites, so a config built from them is stable', () => {
    const suites = reaching('lib/target.ts')

    expect([...suites]).toEqual([...suites].sort())
  })
})

describe('coveringSuites', () => {
  it('unions the suites of every module without repeating one', () => {
    const union = coveringSuites(['lib/target.ts', 'lib/middle.ts'], root)

    expect(union).toEqual([...new Set(union)])
    expect(union).toContain('transitive.test.ts')
  })

  it('returns nothing for an empty scope', () => {
    expect(coveringSuites([], root)).toEqual([])
  })
})

describe('the repository’s own scope', () => {
  it('has at least one suite behind every scoped module', () => {
    // The assertion that would have caught a scope entry pointing at a module
    // nobody tests: the run would report 0% for it and the floor would be the
    // only thing standing between that and a green build.
    const found = suitesReaching(SCOPE.map((entry) => entry.module))

    for (const entry of SCOPE) {
      expect(found.get(entry.module) ?? []).not.toHaveLength(0)
    }
  })
})
