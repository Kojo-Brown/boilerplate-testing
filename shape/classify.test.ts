// @vitest-environment node
//
// This file writes and reads fixture trees, and resolves its own location from
// `import.meta.url`. Under the project-default jsdom environment that URL is
// rewritten to an http: one and `fileURLToPath` throws.

/**
 * The classifier, tested against a fixture tree rather than this repository.
 *
 * Pointing these at the real suite would make them change every time anyone
 * adds a test, which is exactly the property a gate's own tests must not have.
 * The repository-wide invariants live in `shape.test.ts`, and they assert
 * things that stay true as the suite grows ("nothing is unclassified") rather
 * than numbers that do not.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classifyRepository, findTestFiles, readImports, resolveLocal } from './classify.ts'

let root: string

/** Write a fixture file, creating its directories. */
function write(relativePath: string, source: string): string {
  const absolute = join(root, relativePath)

  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source, 'utf8')

  return absolute
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'shape-classify-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readImports', () => {
  it('reads one ref per binding of a named import', () => {
    const file = write(
      'named.ts',
      `import { readFileSync, writeFileSync } from 'node:fs'\nvoid readFileSync\nvoid writeFileSync\n`,
    )

    expect(readImports(file)).toEqual([
      { specifier: 'node:fs', binding: 'readFileSync' },
      { specifier: 'node:fs', binding: 'writeFileSync' },
    ])
  })

  it('marks a default import `default` and a namespace import `*`', () => {
    const file = write(
      'shapes.ts',
      `import fs from 'node:fs'\nimport * as path from 'node:path'\nvoid fs\nvoid path\n`,
    )

    expect(readImports(file)).toEqual([
      { specifier: 'node:fs', binding: 'default' },
      { specifier: 'node:path', binding: '*' },
    ])
  })

  it('records a side-effect import with a null binding', () => {
    const file = write('sideEffect.ts', `import 'node:fs'\n`)

    expect(readImports(file)).toEqual([{ specifier: 'node:fs', binding: null }])
  })

  it('ignores a type-only import, which is erased before anything runs', () => {
    const file = write(
      'typeOnly.ts',
      `import type { Stats } from 'node:fs'\nexport type Alias = Stats\n`,
    )

    expect(readImports(file)).toEqual([])
  })

  it('ignores a type-only specifier inside a value import', () => {
    const file = write(
      'mixed.ts',
      `import { readFileSync, type Stats } from 'node:fs'\nexport type A = Stats\nvoid readFileSync\n`,
    )

    expect(readImports(file)).toEqual([{ specifier: 'node:fs', binding: 'readFileSync' }])
  })

  it('follows a re-export, which is how the Playwright fixtures reach the browser', () => {
    const file = write('reexport.ts', `export { thing } from './other'\nexport * from './more'\n`)

    expect(readImports(file)).toEqual([
      { specifier: './other', binding: null },
      { specifier: './more', binding: null },
    ])
  })

  it('reads a dynamic import', () => {
    const file = write('dynamic.ts', `export const load = () => import('node:fs')\n`)

    expect(readImports(file)).toEqual([{ specifier: 'node:fs', binding: null }])
  })

  it('reads a require call', () => {
    const file = write('required.ts', `const fs = require('node:fs')\nvoid fs\n`)

    expect(readImports(file)).toEqual([{ specifier: 'node:fs', binding: null }])
  })

  it('never mistakes a module name written inside prose for an import', () => {
    // The regex this file replaced reported that a comment containing the
    // words "from 'x'" was an import. That is the whole reason the parser is
    // here, so it gets a test rather than a note.
    const file = write(
      'prose.ts',
      [
        '/**',
        " * A doc comment that says: import { server } from 'msw/node'",
        ' * and mentions require("node:child_process") for good measure.',
        ' */',
        `export const code = "import { x } from '@playwright/test'"`,
        '',
      ].join('\n'),
    )

    expect(readImports(file)).toEqual([])
  })

  it('parses TSX', () => {
    const file = write(
      'component.tsx',
      `import { render } from '@testing-library/react'\nexport const El = () => <div />\nvoid render\n`,
    )

    expect(readImports(file)).toEqual([
      { specifier: '@testing-library/react', binding: 'render' },
    ])
  })
})

describe('resolveLocal', () => {
  it('resolves a relative import to a .ts file', () => {
    const from = write('resolve/from.ts', 'export {}\n')
    const target = write('resolve/target.ts', 'export const a = 1\n')

    expect(resolveLocal(from, './target', root)).toBe(target)
  })

  it('resolves a relative import written with its .ts extension', () => {
    const from = write('resolve/fromExt.ts', 'export {}\n')
    const target = write('resolve/targetExt.ts', 'export const a = 1\n')

    expect(resolveLocal(from, './targetExt.ts', root)).toBe(target)
  })

  it('resolves a directory to its index file', () => {
    const from = write('resolve/fromDir.ts', 'export {}\n')
    const target = write('resolve/pkg/index.ts', 'export const a = 1\n')

    expect(resolveLocal(from, './pkg', root)).toBe(target)
  })

  it('resolves the @/ alias against the root', () => {
    const from = write('deep/nested/from.ts', 'export {}\n')
    const target = write('aliased.ts', 'export const a = 1\n')

    expect(resolveLocal(from, '@/aliased', root)).toBe(target)
  })

  it('returns null for a package, which is what makes it external', () => {
    const from = write('resolve/external.ts', 'export {}\n')

    expect(resolveLocal(from, 'vitest', root)).toBeNull()
    expect(resolveLocal(from, './does-not-exist', root)).toBeNull()
  })
})

describe('findTestFiles', () => {
  it('finds .test and .spec files in both TypeScript flavours', () => {
    const nested = mkdtempSync(join(tmpdir(), 'shape-find-'))

    for (const name of ['a.test.ts', 'b.spec.ts', 'c.test.tsx', 'd.spec.tsx']) {
      writeFileSync(join(nested, name), 'export {}\n', 'utf8')
    }

    writeFileSync(join(nested, 'helper.ts'), 'export {}\n', 'utf8')
    mkdirSync(join(nested, 'node_modules'), { recursive: true })
    writeFileSync(join(nested, 'node_modules', 'vendored.test.ts'), 'export {}\n', 'utf8')

    const found = findTestFiles(nested).map((path) => path.slice(nested.length + 1))

    expect(found.sort()).toEqual(['a.test.ts', 'b.spec.ts', 'c.test.tsx', 'd.spec.tsx'])

    rmSync(nested, { recursive: true, force: true })
  })
})

describe('classifying a tree', () => {
  let tree: string

  beforeAll(() => {
    tree = mkdtempSync(join(tmpdir(), 'shape-tree-'))

    const put = (relativePath: string, source: string): void => {
      const absolute = join(tree, relativePath)

      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, source, 'utf8')
    }

    put('pure.test.ts', `import { it } from 'vitest'\nit('adds', () => {})\n`)
    put('disk.test.ts', `import { readFileSync } from 'node:fs'\nvoid readFileSync\n`)
    put(
      'both.test.ts',
      `import { readFileSync } from 'node:fs'\nimport { test } from '@playwright/test'\nvoid readFileSync\nvoid test\n`,
    )
    // The Playwright fixture chain: spec -> barrel -> fixture -> the browser.
    put('fixtures/auth.ts', `export { test } from '@playwright/test'\n`)
    put('fixtures/index.ts', `export { test } from './auth'\n`)
    put('indirect.spec.ts', `import { test } from './fixtures'\nvoid test\n`)
    put('unknown.test.ts', `import thing from 'a-package-nobody-classified'\nvoid thing\n`)
    put('cycle/a.ts', `import './b'\nexport const a = 1\n`)
    put('cycle/b.ts', `import './a'\nimport { readFileSync } from 'node:fs'\nvoid readFileSync\n`)
    put('cycle.test.ts', `import './cycle/a'\n`)
  })

  afterAll(() => {
    rmSync(tree, { recursive: true, force: true })
  })

  const layerOf = (file: string): string | undefined =>
    classifyRepository(tree).files.find((entry) => entry.file === file)?.layer

  it('puts a test that reaches nothing outside its own memory in the unit layer', () => {
    expect(layerOf('pure.test.ts')).toBe('unit')
  })

  it('puts a test that reads the filesystem in the integration layer', () => {
    expect(layerOf('disk.test.ts')).toBe('integration')
  })

  it('takes the widest boundary when a test crosses several', () => {
    expect(layerOf('both.test.ts')).toBe('e2e')
  })

  it('follows re-exports through a barrel file to the boundary behind it', () => {
    // Without transitive resolution this spec imports './fixtures' and looks
    // like a unit test — the failure that would silently empty the e2e layer.
    expect(layerOf('indirect.spec.ts')).toBe('e2e')
  })

  it('records the import chain that led to the boundary', () => {
    const classified = classifyRepository(tree).files.find(
      (entry) => entry.file === 'indirect.spec.ts',
    )

    expect(classified?.evidence[0]?.via).toEqual([
      'indirect.spec.ts',
      'fixtures/index.ts',
      'fixtures/auth.ts',
    ])
  })

  it('reports an unclassified module instead of counting it as a unit test', () => {
    const { unclassified, files } = classifyRepository(tree)

    expect(unclassified).toContainEqual({
      specifier: 'a-package-nobody-classified',
      binding: 'default',
      file: 'unknown.test.ts',
    })

    // It still lands somewhere so the report is complete; the problem is what
    // fails the gate, not the layer.
    expect(files.find((entry) => entry.file === 'unknown.test.ts')?.layer).toBe('unit')
  })

  it('terminates on an import cycle and still finds the boundary behind it', () => {
    expect(layerOf('cycle.test.ts')).toBe('integration')
  })

  it('leaves a unit test with no evidence, because the absence is the definition', () => {
    const classified = classifyRepository(tree).files.find((entry) => entry.file === 'pure.test.ts')

    expect(classified?.evidence).toEqual([])
  })
})
