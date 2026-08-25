// @vitest-environment node
//
// Walks and parses the repository, so it needs a filesystem rather than a DOM.

/**
 * The half of the shape gate that runs inside `pnpm test`.
 *
 * The ratio itself is checked by `pnpm shape:check`, which has to spawn both
 * runners to count tests exactly (see `collect.ts` for why counting them
 * statically is not honest). That is too slow and too recursive to sit in the
 * unit suite.
 *
 * What *is* cheap is the other half: parsing every test file, resolving what it
 * reaches, and confirming the closed table still classifies all of it. That is
 * the part with a silent failure mode — add a dependency that opens a socket
 * and, without this, every test reaching it keeps counting as a unit test — so
 * it belongs where every contributor runs it.
 *
 * Every assertion below is written to stay true as the suite grows. There are
 * no test counts here and no percentages; those live in `policy.test.ts`
 * against numbers that are written down, and in the CI gate against numbers
 * that are measured.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LAYERS, MODULES } from './boundaries.ts'
import { classifyRepository, findTestFiles, REPO_ROOT } from './classify.ts'
import { POLICY, SHAPES } from './policy.ts'

const classification = classifyRepository()

const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8')

describe('classifying this repository', () => {
  it('finds every test file both runners own', () => {
    // A floor rather than an exact number, so adding tests never breaks this.
    // The point is that the walker sees Playwright specs and pact tests, which
    // neither runner's own file list would report on its own.
    const files = classification.files.map((file) => file.file)

    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('playwright/pom.spec.ts')
    expect(files).toContain('pact/consumer/users.consumer.pact.test.ts')
    expect(files).toContain('tdd/fizzbuzz/fizzBuzz.test.ts')
  })

  it('parses every test file it finds', () => {
    expect(classification.unparsable).toEqual([])
  })

  it('classifies every module any test can reach', () => {
    // The one that matters. A new dependency reaching a socket or a database
    // fails here rather than silently improving the ratio.
    const detail = classification.unclassified
      .map((module) => `  ${module.file}: ${module.specifier}#${module.binding ?? '(side effect)'}`)
      .join('\n')

    expect(classification.unclassified, `unclassified modules:\n${detail}`).toEqual([])
  })

  it('gives every test file exactly one of the declared layers', () => {
    for (const file of classification.files) {
      expect(LAYERS, `${file.file} has an unknown layer`).toContain(file.layer)
    }
  })

  it('puts every layer to use, so none of the three is a dead category', () => {
    const used = new Set(classification.files.map((file) => file.layer))

    expect([...used].sort()).toEqual([...LAYERS].sort())
  })
})

describe('the layers the classifier actually assigns', () => {
  const layerOf = (file: string): string | undefined =>
    classification.files.find((entry) => entry.file === file)?.layer

  it('reaches the browser through the fixture barrel, not just a direct import', () => {
    // `auth.spec.ts` imports './fixtures', which re-exports './auth', which
    // imports @playwright/test. Without transitive resolution this is a unit
    // test and the e2e layer loses most of its members.
    expect(layerOf('playwright/auth.spec.ts')).toBe('e2e')
    expect(layerOf('playwright/visual.spec.ts')).toBe('e2e')
  })

  it('counts an audit that reads the repository off disk as an integration test', () => {
    expect(layerOf('workflow-templates/actionPins.test.ts')).toBe('integration')
    expect(layerOf('tdd/katas.test.ts')).toBe('integration')
  })

  it('counts interception, a real socket and a mock provider as integration', () => {
    expect(layerOf('msw/handlers.test.ts')).toBe('integration')
    expect(layerOf('supertest/createTestApp.test.ts')).toBe('integration')
    expect(layerOf('pact/consumer/users.consumer.pact.test.ts')).toBe('integration')
  })

  it('separates linting real files from linting a string in memory', () => {
    // Same package, opposite answers: `ESLint` resolves config and reads paths,
    // `RuleTester` lints source it was handed.
    expect(layerOf('tdd/conventions/conventions.test.ts')).toBe('integration')
    expect(layerOf('tdd/conventions/eslint-plugin/titleScheme.test.ts')).toBe('unit')
  })

  it('counts a Testing Library render as a unit test, because jsdom is in-process', () => {
    expect(layerOf('react/renderWithProviders.test.tsx')).toBe('unit')
    expect(layerOf('a11y/check.test.tsx')).toBe('unit')
  })

  it('counts a kata that touches nothing as a unit test', () => {
    expect(layerOf('tdd/fizzbuzz/fizzBuzz.test.ts')).toBe('unit')
    expect(layerOf('tdd/schools/classicist/money.test.ts')).toBe('unit')
  })

  it('gives every non-unit file the evidence that put it there', () => {
    for (const file of classification.files) {
      if (file.layer !== 'unit') {
        expect(file.evidence.length, `${file.file} is ${file.layer} with no evidence`).toBeGreaterThan(0)
      }
    }
  })

  it('leaves every unit file with no evidence, because that is what unit means here', () => {
    for (const file of classification.files) {
      if (file.layer === 'unit') {
        expect(file.evidence, `${file.file} is unit but crosses something`).toEqual([])
      }
    }
  })
})

describe('the table has no entries nothing uses', () => {
  it('reaches every boundary module it classifies, or says why not', () => {
    // Entries nothing reaches today, each for a stated reason. They exist so
    // that the day something does reach them it is already classified rather
    // than failing the audit at an inconvenient moment. Anything *not* on this
    // list and unreached is a table entry describing a dependency that has
    // gone, which is worth deleting.
    //
    //   node:net, node:https, node:fs/promises  — siblings of boundaries that
    //     are reached; the obvious next thing a contributor imports.
    //   @prisma/client — `prisma/isolation.test.ts` tests the isolation
    //     helpers themselves and opens no connection.
    //   superagent — reached only through `import type { Response }` in
    //     `supertest/requestBuilder.ts`, and a type import is erased before
    //     anything runs, so it is correctly not a reach.
    const classifiedInAdvance = new Set([
      'node:net',
      'node:https',
      'node:fs/promises',
      '@prisma/client',
      'superagent',
    ])
    const reached = new Set(
      classification.files.flatMap((file) => file.evidence.map((entry) => entry.specifier)),
    )

    for (const [key, entry] of Object.entries(MODULES)) {
      if (entry.kind !== 'boundary') {
        continue
      }

      const specifier = key.split('#')[0] ?? key

      if (!classifiedInAdvance.has(specifier)) {
        expect(reached, `${key} is classified but nothing reaches it`).toContain(specifier)
      }
    }
  })
})

describe('README.md against the code it documents', () => {
  it('publishes the bands CI actually enforces', () => {
    for (const layer of LAYERS) {
      const band = POLICY.bands[layer]

      expect(readme, `README does not state the enforced ${layer} band`).toContain(
        `| \`${layer}\` | ${band.min}–${band.max}% |`,
      )
    }
  })

  it('names both shapes it claims to compare, with their origins', () => {
    for (const shape of Object.values(SHAPES)) {
      expect(readme).toContain(shape.name)
      expect(readme).toContain(shape.origin)
    }
  })

  it('names the shape this repository is held to', () => {
    expect(readme).toContain(`**Declared shape: ${SHAPES[POLICY.shape].name.toLowerCase()}**`)
  })

  it('documents every boundary the table can assign', () => {
    // A boundary added to the table without a line in the README is a rule
    // enforced on contributors that nothing tells them about.
    for (const [key, entry] of Object.entries(MODULES)) {
      if (entry.kind === 'boundary') {
        expect(readme, `README does not document the ${key} boundary`).toContain(`\`${key}\``)
      }
    }
  })

  it('points at the command that enforces the ratio', () => {
    expect(readme).toContain('pnpm shape:check')
  })
})

describe('the census covers the whole repository', () => {
  it('classifies every file the walker finds, with nothing dropped in between', () => {
    expect(classification.files).toHaveLength(findTestFiles().length)
  })

  it('reports paths relative to the repository root', () => {
    for (const file of classification.files) {
      expect(file.file.startsWith('/'), `${file.file} is absolute`).toBe(false)
      expect(file.file.includes('..'), `${file.file} escapes the root`).toBe(false)
    }

    expect(REPO_ROOT.endsWith('/')).toBe(true)
  })
})
