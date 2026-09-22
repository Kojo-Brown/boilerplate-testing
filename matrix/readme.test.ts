// @vitest-environment node
//
// Reads this directory's files off disk and resolves them relative to
// `import.meta.url`, which the project-default jsdom environment rewrites to
// an http: URL that `fileURLToPath` rejects.

/**
 * README.md against the directory it documents.
 *
 * The four tables in the README are not *checked against* the measurement,
 * they are **rendered from it** and compared as text — the discipline
 * `intercept/readme.test.ts` established. There is no version of this file
 * that agrees with a published table holding a wrong cell, a reordered row, or
 * a column somebody added and did not document.
 *
 * What is left is the prose around them: one paragraph per finding and no
 * more, the arithmetic the paragraphs quote, the files they link, the scripts
 * they tell a reader to run, and the two claims about wiring — that Vitest
 * declines the browser specs and that CI has a job which runs them.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  FINDINGS as EMULATION_FINDINGS,
  REGISTRY,
  renderEmulationTable,
  renderProjectTable,
} from './emulation.ts'
import {
  FINDINGS as SHARDING_FINDINGS,
  FIXTURE_TEST_COUNT,
  renderBalanceTable,
  renderShapesTable,
} from './grouping.ts'
import { CONDITION_NAMES } from './conditions.ts'
import { PROBES } from './probes.ts'
import { SETUP_FILE, FIXTURE_FILES } from './fixture.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8')

const readme = read('matrix/README.md')
const workflow = read('.github/workflows/ci.yml')
const vitestConfig = read('vitest.config.ts')
const collect = read('shape/collect.ts')
const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

/** The body of one `###` section, by its heading. */
function section(heading: string): string {
  const start = readme.indexOf(`### ${heading}`)

  if (start === -1) {
    throw new Error(`the README no longer has a "${heading}" section`)
  }

  const next = readme.indexOf('\n### ', start + 1)

  return readme.slice(start, next === -1 ? undefined : next)
}

/** The `**Lead sentence.**` openers of a section's paragraphs. */
function leads(heading: string): string[] {
  const body = section(heading)
  const [, ...rest] = body.split('\n\n')

  return rest
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.startsWith('**'))
}

describe('the published tables are the measurement', () => {
  it.each([
    ['project matrix', renderProjectTable],
    ['emulation table', renderEmulationTable],
    ['grouping table', renderShapesTable],
    ['balance table', renderBalanceTable],
  ])('prints the %s exactly as the module renders it', (_name, render) => {
    expect(readme).toContain(render())
  })

  it('prints four distinct tables rather than one of them twice', () => {
    const rendered = [
      renderProjectTable(),
      renderEmulationTable(),
      renderShapesTable(),
      renderBalanceTable(),
    ]

    expect(new Set(rendered).size).toBe(rendered.length)
    expect(new Set(rendered.map((table) => readme.indexOf(table))).size).toBe(rendered.length)
  })

  it('prints the registry census the test suite checks', () => {
    for (const [engine, counts] of Object.entries(REGISTRY.byEngine)) {
      expect(readme, `${engine} has no census row`).toContain(
        `| ${engine} | ${counts.desktop} | ${counts.mobile} |`,
      )
    }

    expect(readme).toContain(`${REGISTRY.descriptors} device descriptors`)
  })
})

describe('the findings sections', () => {
  it('opens one paragraph per emulation finding and no more', () => {
    // Both directions: a finding added to `emulation.ts` with no paragraph
    // fails this, and so does a paragraph making a claim no finding supports.
    expect(leads('What the tables say')).toHaveLength(
      Object.keys(EMULATION_FINDINGS).length,
    )
  })

  it('opens one paragraph per sharding finding and no more', () => {
    const bodies = readme.split('## Part 2 — sharding')

    expect(bodies).toHaveLength(2)

    const sharding = bodies[1] ?? ''
    const start = sharding.indexOf('### What the tables say')
    const end = sharding.indexOf('\n### ', start + 1)
    const paragraphs = sharding
      .slice(start, end === -1 ? undefined : end)
      .split('\n\n')
      .slice(1)
      .filter((paragraph) => paragraph.trim().startsWith('**'))

    expect(paragraphs).toHaveLength(Object.keys(SHARDING_FINDINGS).length)
  })

  it('quotes the arithmetic the findings rest on', () => {
    // Every number here is one a reader could check against a table above it,
    // which is exactly why these are the ones that go wrong.
    expect(readme).toContain('200 of 207 descriptors')
    expect(readme).toContain('`[8, 4, 10, 1]` against a nominal\n`[6, 6, 6, 5]`')
    expect(readme).toContain('(9 → 8)')
    expect(readme).toContain('(5 → 6)')
    expect(readme).toContain('(5 → 7)')
    expect(readme).toContain(`${FIXTURE_TEST_COUNT} tests, one project`)
  })

  it('counts the device probes it claims are unmoved by a resize', () => {
    const device = PROBES.filter((probe) => probe.kind === 'device')

    expect(readme).toContain(`${device.length === 10 ? 'Ten' : String(device.length)} probes:`)
  })

  it('names every condition it tabulates', () => {
    for (const condition of CONDITION_NAMES) {
      expect(readme, `the README does not name ${condition}`).toContain(`\`${condition}\``)
    }
  })
})

describe('the wiring the README describes', () => {
  it('links only files that exist', () => {
    const links = [...readme.matchAll(/\]\((\.\/[^)]+|\.\.\/[^)]+)\)/g)].map((match) => match[1] ?? '')

    expect(links.length).toBeGreaterThan(0)

    for (const link of links) {
      expect(existsSync(join(here, link.split('#')[0] ?? '')), `${link} does not exist`).toBe(true)
    }
  })

  it('counts the fixture the way the fixture is', () => {
    const declarations = [...FIXTURE_FILES, SETUP_FILE].reduce(
      (count, file) => count + file.titles.length,
      0,
    )

    expect(readme).toContain(`${declarations} empty tests in seven shapes`)
  })

  it('names two scripts that exist and do what it says they do', () => {
    expect(manifest.scripts['test:matrix']).toBe(
      'playwright test --config matrix/playwright-matrix.config.ts',
    )

    for (const command of ['pnpm test matrix/', 'pnpm test:matrix']) {
      expect(readme, `the README does not show ${command}`).toContain(command)
    }
  })

  it('names a CI job that runs the browser half', () => {
    expect(workflow).toContain('run: pnpm test:matrix')
    expect(readme).toContain('the `matrix` job')
  })

  it('states the runner split the configs are actually wired with', () => {
    // The README's claim that `pnpm test matrix/` needs no browser holds only
    // if Vitest declines the specs and the census still counts them.
    expect(vitestConfig).toContain("'matrix/**/*.spec.ts'")
    expect(collect).toContain(
      "collectPlaywright(outputDir, 'matrix/playwright-matrix.config.ts')",
    )
  })
})
