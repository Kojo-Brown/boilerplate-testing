// @vitest-environment node
//
// Parses and walks real files, so it needs a filesystem rather than a DOM.

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildGraph,
  directoryOf,
  isParsed,
  parseSpecifiers,
  relativeTo,
  resolveSpecifier,
  reverseReachable,
} from './graph.ts'
import { FIXTURE_ROOT, treeFiles } from './runs.ts'

const fixture = () => {
  const files = treeFiles(FIXTURE_ROOT)

  return { files, graph: buildGraph(FIXTURE_ROOT, files) }
}

describe('reading the specifiers in a file', () => {
  it('finds a static import', () => {
    expect(parseSpecifiers("import { a } from './a.ts'")).toEqual(['./a.ts'])
  })

  // The case a pattern match gets wrong in the other direction: a re-export
  // pulls a module in and does not contain the word "import".
  it('finds a re-export', () => {
    expect(parseSpecifiers("export { a } from './a.ts'")).toEqual(['./a.ts'])
  })

  it('finds a dynamic import with a literal argument', () => {
    expect(parseSpecifiers("await import('./late.ts')")).toEqual(['./late.ts'])
  })

  it('finds a require call', () => {
    expect(parseSpecifiers("const a = require('./a.ts')")).toEqual(['./a.ts'])
  })

  it('keeps a type-only import, which breaks a typecheck even though it emits nothing', () => {
    expect(parseSpecifiers("import type { A } from './a.ts'")).toEqual(['./a.ts'])
  })

  // The reason this file uses the compiler's scanner rather than a regular
  // expression. Both of these contain the word and neither is an edge.
  it('ignores the word import in a comment', () => {
    expect(parseSpecifiers("// import { a } from './a.ts'\nconst x = 1")).toEqual([])
  })

  it('ignores a module specifier inside a string', () => {
    expect(parseSpecifiers("const advice = \"import { a } from './a.ts'\"")).toEqual([])
  })

  it('cannot find a computed dynamic import, which is the blind spot the matrix measures', () => {
    expect(parseSpecifiers('await import(join(dir, name))')).toEqual([])
  })
})

describe('resolving a specifier', () => {
  const files = new Set(['src/a.ts', 'src/b/index.ts', 'src/data/x.json', 'lib/c.tsx'])

  it('resolves a relative path that names its extension', () => {
    expect(resolveSpecifier('./a.ts', 'src/main.ts', files)).toBe('src/a.ts')
  })

  it('resolves an extensionless relative path', () => {
    expect(resolveSpecifier('./a', 'src/main.ts', files)).toBe('src/a.ts')
  })

  it('resolves a directory to its index file', () => {
    expect(resolveSpecifier('./b', 'src/main.ts', files)).toBe('src/b/index.ts')
  })

  // TypeScript's own NodeNext convention: write the output extension, mean the
  // source file. Both forms appear in real repositories.
  it('resolves a .js specifier to the .ts file it means', () => {
    expect(resolveSpecifier('./a.js', 'src/main.ts', files)).toBe('src/a.ts')
  })

  it('resolves a JSON file, which is what a data dependency looks like', () => {
    expect(resolveSpecifier('./data/x.json', 'src/main.ts', files)).toBe('src/data/x.json')
  })

  it('resolves through an alias table', () => {
    expect(resolveSpecifier('@/lib/c', 'src/main.ts', files, { '@/': '' })).toBe('lib/c.tsx')
  })

  it('resolves nothing for a package, which is outside the tree', () => {
    expect(resolveSpecifier('vitest', 'src/main.ts', files)).toBeNull()
  })

  it('resolves nothing for a node builtin', () => {
    expect(resolveSpecifier('node:fs', 'src/main.ts', files)).toBeNull()
  })

  // What a deletion leaves behind. The importer is still there and names a
  // file that is not, which `select.ts` turns into a full run.
  it('resolves nothing for a relative path that is no longer in the tree', () => {
    expect(resolveSpecifier('./deleted.ts', 'src/main.ts', files)).toBeNull()
  })

  it('resolves nothing above the root, rather than escaping it', () => {
    expect(resolveSpecifier('../../outside.ts', 'src/main.ts', files)).toBeNull()
  })
})

describe('the fixture graph', () => {
  it('records the import chain money → pricing → cart', () => {
    const { graph } = fixture()

    expect([...(graph.imports.get('src/pricing.ts') ?? [])]).toContain('src/money.ts')
    expect([...(graph.imports.get('src/cart.ts') ?? [])]).toContain('src/pricing.ts')
  })

  it('records the reverse index, which is what a selection walks', () => {
    const { graph } = fixture()

    // `rules/registry.ts` is in this list because it imports `Line` as a
    // type. The edge emits no JavaScript and is kept anyway: it is a real
    // dependency of `pnpm typecheck`, and over-selecting is the safe
    // direction.
    expect([...(graph.importers.get('src/money.ts') ?? [])].sort()).toEqual([
      'src/cart.ts',
      'src/label.ts',
      'src/money.test.ts',
      'src/pricing.ts',
      'src/rules/registry.ts',
      'src/support/factory.ts',
    ])
  })

  it('finds no importer for a rule loaded by name at run time', () => {
    const { graph } = fixture()

    expect([...(graph.importers.get('src/rules/bulk.rule.ts') ?? [])]).toEqual([])
  })

  it('finds no importer for the data file the rate table reads', () => {
    const { graph } = fixture()

    expect([...(graph.importers.get('src/data/rates.json') ?? [])]).toEqual([])
  })

  it('carries non-code files as nodes with no edges, so an edge can be added to them', () => {
    const { graph } = fixture()

    expect(graph.files).toContain('src/__snapshots__/label.test.ts.snap')
    expect([...(graph.imports.get('src/__snapshots__/label.test.ts.snap') ?? [])]).toEqual([])
  })

  it('records node builtins as external rather than dropping them', () => {
    const { graph } = fixture()

    expect(graph.external.get('src/rates.ts')).toEqual(['node:fs', 'node:url'])
  })

  it('resolves every relative specifier in the fixture', () => {
    const { graph } = fixture()
    const unresolvedRelative = [...graph.external.entries()].flatMap(([file, specifiers]) =>
      specifiers.filter((specifier) => specifier.startsWith('.')).map((specifier) => `${file} → ${specifier}`),
    )

    expect(unresolvedRelative).toEqual([])
  })
})

describe('walking the graph backwards', () => {
  it('includes the seed, so a changed test file selects itself', () => {
    const { graph } = fixture()

    expect(reverseReachable(graph, ['src/money.test.ts'])).toContain('src/money.test.ts')
  })

  it('reaches every file that imports the seed through any chain', () => {
    const { graph } = fixture()

    // Ten of the thirteen are reached through imports that run. The three
    // rule files are reached through type-only imports — `registry.ts` names
    // `Line`, and each rule names `Rule` — and none of them is a test, so they
    // cost the selection nothing while keeping the typecheck graph honest.
    expect([...reverseReachable(graph, ['src/money.ts'])].sort()).toEqual([
      'src/cart.test.ts',
      'src/cart.ts',
      'src/label.test.ts',
      'src/label.ts',
      'src/money.test.ts',
      'src/money.ts',
      'src/pricing.test.ts',
      'src/pricing.ts',
      'src/rules/bulk.rule.ts',
      'src/rules/registry.test.ts',
      'src/rules/registry.ts',
      'src/rules/weekend.rule.ts',
      'src/support/factory.ts',
    ])
  })

  it('stops at one hop when the walk is depth-limited', () => {
    const { graph } = fixture()

    expect([...reverseReachable(graph, ['src/money.ts'], 1)].sort()).toEqual([
      'src/cart.ts',
      'src/label.ts',
      'src/money.test.ts',
      'src/money.ts',
      'src/pricing.ts',
      'src/rules/registry.ts',
      'src/support/factory.ts',
    ])
  })

  it('ignores a seed that is not in the graph', () => {
    const { graph } = fixture()

    expect([...reverseReachable(graph, ['src/nowhere.ts'])]).toEqual([])
  })

  it('terminates on a cycle', () => {
    const root = join(FIXTURE_ROOT, 'src')
    const graph = buildGraph(root, ['a.ts', 'b.ts'])

    // Neither file imports the other on disk; the point is the walk, so the
    // edges are stated directly.
    const cyclic = {
      ...graph,
      importers: new Map([
        ['a.ts', new Set(['b.ts'])],
        ['b.ts', new Set(['a.ts'])],
      ]),
    }

    expect([...reverseReachable(cyclic, ['a.ts'])].sort()).toEqual(['a.ts', 'b.ts'])
  })
})

describe('the path helpers', () => {
  it('names the extensions that are parsed for specifiers', () => {
    expect(isParsed('a.ts')).toBe(true)
    expect(isParsed('a.json')).toBe(false)
    expect(isParsed('a.snap')).toBe(false)
  })

  it('reports a repository-relative path with forward slashes', () => {
    expect(relativeTo('/repo', '/repo/src/a.ts')).toBe('src/a.ts')
  })

  it('reports the empty string for a file at the root, not a dot', () => {
    expect(directoryOf('package.json')).toBe('')
    expect(directoryOf('src/a.ts')).toBe('src')
  })
})
