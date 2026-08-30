// @vitest-environment node
/**
 * Finding snapshots, and counting their lines correctly.
 *
 * The line count is the whole budget rule, so the cases that matter here are
 * the ones where a naive implementation gets it wrong: a snapshot containing a
 * backtick, one containing an `exports[` line of its own, an inline snapshot
 * whose template holds a blank line. Each of those would understate a
 * snapshot's size, and understating is the direction that passes.
 *
 * The fixtures are written to a temporary directory rather than committed,
 * because a committed fixture containing `toMatchInlineSnapshot` would be
 * found by the repository's own inventory and would need a registry row for a
 * snapshot that is not one.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  INLINE_MATCHERS,
  readInlineSnapshots,
  readSnapFile,
  takeInventory,
  testFileFor,
  walk,
} from './inventory'

let root: string

const write = (relativePath: string, contents: string): string => {
  const path = join(root, relativePath)

  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)

  return path
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'snapshot-inventory-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('reading a .snap file', () => {
  it('finds every entry with its name and its line count', () => {
    const path = write(
      'a/__snapshots__/one.test.ts.snap',
      '// Vitest Snapshot v1\n\nexports[`a > b 1`] = `\n"line one\nline two"\n`;\n\nexports[`a > c 1`] = `\n"only"\n`;\n',
    )

    const found = readSnapFile(path, root)

    expect(found.map((snapshot) => snapshot.name)).toEqual(['a > b 1', 'a > c 1'])
    expect(found.map((snapshot) => snapshot.lines)).toEqual([2, 1])
  })

  it('attributes a snapshot to the test file rather than the .snap', () => {
    const path = write('a/__snapshots__/two.test.ts.snap', 'exports[`x 1`] = `\n"y"\n`;\n')

    expect(readSnapFile(path, root)[0]?.file).toBe('a/two.test.ts')
  })

  it('does not truncate a snapshot that contains a backtick', () => {
    // The terminator is `` `; `` at the start of a line, not the first
    // backtick. Getting this wrong reports a shorter snapshot than exists,
    // which is the direction that quietly passes a budget.
    const path = write(
      'a/__snapshots__/three.test.ts.snap',
      'exports[`x 1`] = `\n"run `pnpm test` first\nthen read this"\n`;\n',
    )

    const found = readSnapFile(path, root)

    expect(found).toHaveLength(1)
    expect(found[0]?.lines).toBe(2)
    expect(found[0]?.content).toContain('then read this')
  })

  it('reads an entry whose content mentions exports[ itself', () => {
    const path = write(
      'a/__snapshots__/four.test.ts.snap',
      'exports[`x 1`] = `\n"exports[\\`not an entry\\`] = 1"\n`;\n',
    )

    expect(readSnapFile(path, root)).toHaveLength(1)
  })

  it('counts an empty snapshot as no lines rather than one', () => {
    const path = write('a/__snapshots__/five.test.ts.snap', 'exports[`x 1`] = `\n`;\n')

    expect(readSnapFile(path, root)[0]?.lines).toBe(0)
  })
})

describe('naming the test file a .snap belongs to', () => {
  it('strips the __snapshots__ directory and the .snap suffix', () => {
    expect(testFileFor('react/__snapshots__/Button.test.tsx.snap')).toBe('react/Button.test.tsx')
    expect(testFileFor('__snapshots__/root.test.ts.snap')).toBe('root.test.ts')
  })
})

describe('reading inline snapshots', () => {
  it('keys each one by the title of the test containing it', () => {
    const path = write(
      'b/one.test.ts',
      [
        "import { describe, expect, it } from 'vitest'",
        "describe('a thing', () => {",
        "  it('renders', () => {",
        '    expect(render()).toMatchInlineSnapshot(`',
        '      "one',
        '      two"',
        '    `)',
        '  })',
        '})',
      ].join('\n'),
    )

    const found = readInlineSnapshots(path, root)

    expect(found).toHaveLength(1)
    expect(found[0]?.name).toBe('renders')
    expect(found[0]?.lines).toBe(2)
  })

  it('counts a blank line inside the template', () => {
    const path = write(
      'b/two.test.ts',
      ["it('renders', () => {", '  expect(x).toMatchInlineSnapshot(`', '    a', '', '    b', '  `)', '})'].join(
        '\n',
      ),
    )

    expect(readInlineSnapshots(path, root)[0]?.lines).toBe(3)
  })

  it('records a call with no argument as having no literal', () => {
    const path = write('b/three.test.ts', ["it('renders', () => {", '  expect(x).toMatchInlineSnapshot()', '})'].join('\n'))

    const found = readInlineSnapshots(path, root)

    expect(found[0]?.literal).toBe(false)
    expect(found[0]?.lines).toBe(0)
  })

  it('records an interpolated template as having no literal', () => {
    const path = write(
      'b/four.test.ts',
      ["it('renders', () => {", '  expect(x).toMatchInlineSnapshot(`${expected}`)', '})'].join('\n'),
    )

    expect(readInlineSnapshots(path, root)[0]?.literal).toBe(false)
  })

  it('finds the error-matching form as well', () => {
    const path = write(
      'b/five.test.ts',
      ["it('throws', () => {", '  expect(x).toThrowErrorMatchingInlineSnapshot(`"boom"`)', '})'].join('\n'),
    )

    const found = readInlineSnapshots(path, root)

    expect(found[0]?.matcher).toBe('toThrowErrorMatchingInlineSnapshot')
    expect(INLINE_MATCHERS.has('toThrowErrorMatchingInlineSnapshot')).toBe(true)
  })

  it('keeps the innermost test title when tests are nested in describes', () => {
    const path = write(
      'b/six.test.ts',
      [
        "describe('outer', () => {",
        "  it('inner', () => {",
        '    expect(x).toMatchInlineSnapshot(`"v"`)',
        '  })',
        '})',
      ].join('\n'),
    )

    expect(readInlineSnapshots(path, root)[0]?.name).toBe('inner')
  })

  it('finds one inside it.each, whose title is a template the runner fills in', () => {
    const path = write(
      'b/seven.test.ts',
      ["it.each([1])('renders %i', () => {", '  expect(x).toMatchInlineSnapshot(`"v"`)', '})'].join('\n'),
    )

    expect(readInlineSnapshots(path, root)[0]?.name).toBe('renders %i')
  })

  it('ignores a matcher that merely has a similar name', () => {
    const path = write(
      'b/eight.test.ts',
      ["it('renders', () => {", '  expect(x).toMatchObject({})', '  expect(x).toMatchSnapshot()', '})'].join(
        '\n',
      ),
    )

    // `toMatchSnapshot` is a *file* snapshot: it is found by reading the
    // `.snap`, not by parsing the call, because only the file knows how many
    // lines it came to.
    expect(readInlineSnapshots(path, root)).toEqual([])
  })

  it('parses a .tsx file, where JSX would otherwise be a syntax error', () => {
    const path = write(
      'b/nine.test.tsx',
      ["it('renders', () => {", '  expect(<div />).toMatchInlineSnapshot(`"<div />"`)', '})'].join('\n'),
    )

    expect(readInlineSnapshots(path, root)).toHaveLength(1)
  })
})

describe('walking the repository', () => {
  it('skips build output and vendored directories', () => {
    write('c/node_modules/pkg/__snapshots__/x.test.ts.snap', 'exports[`x 1`] = `\n"y"\n`;\n')
    write('c/coverage/__snapshots__/y.test.ts.snap', 'exports[`x 1`] = `\n"y"\n`;\n')
    write('c/real/__snapshots__/z.test.ts.snap', 'exports[`x 1`] = `\n"y"\n`;\n')

    const found = walk(join(root, 'c'), (path) => path.endsWith('.snap'))

    expect(found).toHaveLength(1)
    expect(found[0]).toContain('real')
  })
})

describe('the repository’s own inventory', () => {
  it('finds the snapshots this directory ships', () => {
    const inventory = takeInventory()
    const names = inventory.snapshots.map((snapshot) => `${snapshot.file} ${snapshot.name}`)

    expect(names).toContain('snapshot/full.test.ts the order summary markup > renders a paid order in full 1')
    expect(names).toContain('snapshot/projected.test.ts lists every value of a paid order, in document order')
  })

  it('finds every inline snapshot with a literal body', () => {
    const inventory = takeInventory()

    for (const snapshot of inventory.inline) {
      expect(snapshot.literal, `${snapshot.file} ${snapshot.name}`).toBe(true)
    }
  })
})
