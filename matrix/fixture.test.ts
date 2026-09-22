// @vitest-environment node
//
// Reads `fixture/specs/` off disk, so it needs a filesystem rather than a DOM.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FIXTURE_DIR, FIXTURE_FILES, MATRIX_PROJECTS, SETUP_FILE, SINGLE_PROJECT } from './fixture.ts'
import {
  projectsFor,
  shapeFromEnv,
  SETUP_SPEC,
} from './fixture/playwright-fixture.config.ts'
import type { FileMode, SpecFile } from './shard.ts'

const SPECS_DIR = join(FIXTURE_DIR, 'specs')

/**
 * Read one spec file back out of its source.
 *
 * Deliberately crude — a regular expression over the text rather than a parse.
 * The fixture files are seven declarations each and are allowed to be nothing
 * more, and a parser here would be a second implementation of Playwright's
 * collection to get wrong. If somebody writes a fixture spec this cannot read,
 * the right answer is that the fixture stopped being a fixture.
 */
function readSpec(file: string): SpecFile {
  const source = readFileSync(join(SPECS_DIR, file), 'utf8')

  const titles = [...source.matchAll(/^\s*test\('([^']+)'/gm)].map((match) => match[1] ?? '')

  const mode: FileMode = source.includes('test.describe.serial(')
    ? 'serial'
    : source.includes('test.describe.parallel(')
      ? 'parallel'
      : 'sequential'

  return {
    file,
    titles,
    mode,
    hasAllHooks: /^test\.(before|after)All\(/m.test(source),
  }
}

describe('the fixture description', () => {
  it('names every spec file on disk and no others', () => {
    const onDisk = readdirSync(SPECS_DIR).filter((name) => name.endsWith('.spec.ts')).sort()
    const described = [...FIXTURE_FILES, SETUP_FILE].map((file) => file.file).sort()

    expect(described).toEqual(onDisk)
  })

  it('lists the files in the order Playwright collects them', () => {
    const described = FIXTURE_FILES.map((file) => file.file)

    // Alphabetical by path, which is what `collectFilesForProject` returns and
    // therefore the order every group index in `shard.ts` is counted in. A
    // file renamed from `plain` to `aaa` would re-shard the whole suite.
    expect(described).toEqual([...described].sort())
  })

  it.each([...FIXTURE_FILES, SETUP_FILE])('$file matches its source', (described) => {
    expect(readSpec(described.file)).toEqual(described)
  })

  it('keeps every fixture test free of a browser fixture', () => {
    // The sharding measurement runs in `pnpm test` on a machine with no
    // browser installed. That holds only while no fixture spec asks for one:
    // `--list` would still succeed, but the `merge.test.ts` runs would not.
    for (const name of readdirSync(SPECS_DIR)) {
      const source = readFileSync(join(SPECS_DIR, name), 'utf8')

      expect(source).not.toMatch(/test\([^)]*,\s*(async\s*)?\(\s*\{/)
    }
  })
})

describe('the fixture config against the description it is modelled by', () => {
  it.each([
    ['single', SINGLE_PROJECT],
    ['matrix', MATRIX_PROJECTS],
  ] as const)('names the same %s projects the model does, in the same order', (shape, described) => {
    // The model's project list and the config's are two hand-written things
    // that have to agree, and `partition.test.ts` compares their *output* —
    // which would also agree if both were wrong in the same way. This compares
    // the inputs.
    expect(projectsFor(shape).map((project) => project.name)).toEqual(
      described.map((project) => project.name),
    )
  })

  it('gives the setup project the only file it owns, and no other project that file', () => {
    const projects = projectsFor('matrix')
    const setup = projects.find((project) => project.name === 'setup')

    expect(setup?.testMatch).toEqual([SETUP_SPEC])
    expect(SETUP_SPEC).toContain(SETUP_FILE.file)

    for (const project of projects.filter((candidate) => candidate.name !== 'setup')) {
      expect(project.testIgnore, `${project.name} would collect the setup spec`).toEqual([
        SETUP_SPEC,
      ])
    }
  })

  it('declares the dependencies the model shards around', () => {
    const projects = projectsFor('matrix')

    for (const described of MATRIX_PROJECTS) {
      const actual = projects.find((project) => project.name === described.name)

      expect(actual?.dependencies ?? undefined).toEqual(
        described.dependencies === undefined ? undefined : [...described.dependencies],
      )
    }
  })

  it('refuses a shape it does not have projects for', () => {
    // A typo in `FIXTURE_PROJECTS` would otherwise silently measure the single
    // project shape and agree with a model built for it.
    expect(shapeFromEnv(undefined)).toBe('single')
    expect(shapeFromEnv('matrix')).toBe('matrix')
    expect(() => shapeFromEnv('both')).toThrow(/must be/)
  })
})
