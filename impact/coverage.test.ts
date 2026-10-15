// @vitest-environment node

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { coveredFiles, selectByCoverage, type CoverageMap } from './coverage.ts'

/** A `coverage-final.json` with the given absolute paths as its keys. */
function writeReport(root: string, paths: readonly string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'impact-coverage-'))
  const file = join(directory, 'coverage-final.json')

  writeFileSync(
    file,
    JSON.stringify(Object.fromEntries(paths.map((path) => [join(root, path), { path, statementMap: {} }]))),
  )

  return file
}

describe('reading a coverage report', () => {
  it('names the covered files relative to the root', () => {
    const report = writeReport('/project', ['src/a.ts', 'src/b.ts'])

    expect([...coveredFiles(report, '/project')].sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('reads an empty report as covering nothing', () => {
    const report = writeReport('/project', [])

    expect([...coveredFiles(report, '/project')]).toEqual([])
  })
})

describe('selecting by coverage', () => {
  const map: CoverageMap = new Map([
    ['a.test.ts', new Set(['src/a.ts', 'src/shared.ts'])],
    ['b.test.ts', new Set(['src/b.ts', 'src/shared.ts'])],
  ])

  it('selects the one suite whose run touched the changed file', () => {
    expect(selectByCoverage(map, ['src/a.ts'])).toEqual(['a.test.ts'])
  })

  it('selects every suite that touched a shared module', () => {
    expect(selectByCoverage(map, ['src/shared.ts'])).toEqual(['a.test.ts', 'b.test.ts'])
  })

  // The blind spot that matters most, because it is silent: a file that did
  // not exist at the last run appears in no map.
  it('selects nothing for a file no recorded run touched', () => {
    expect(selectByCoverage(map, ['src/brand-new.ts'])).toEqual([])
  })

  it('selects nothing for an empty diff', () => {
    expect(selectByCoverage(map, [])).toEqual([])
  })
})
