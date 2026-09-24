// @vitest-environment node
//
// Reads this directory's files off disk and resolves them relative to
// `import.meta.url`, which the project-default jsdom environment rewrites to an
// http: URL that `fileURLToPath` rejects.

/**
 * README.md against the directory it documents.
 *
 * The four tables are not *checked against* the measurement, they are
 * **rendered from it** and compared as text — the discipline `intercept/` began
 * and `matrix/` continued. There is no version of this file that agrees with a
 * published table holding a wrong cell or a row somebody reordered.
 *
 * What is left is the prose: one paragraph per finding and no more, the
 * arithmetic the paragraphs quote, the files they link, the commands they tell a
 * reader to run, and the two claims about wiring — that Vitest declines the
 * browser spec and that CI has a job which runs it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { renderEnvironmentTable, movesWithEnvironment } from './environments.ts'
import { HAZARDS, hazardsWith } from './hazards.ts'
import { DISABLED_BY_DEFAULT } from './scan.ts'
import { JOURNEY_STATES } from './states.ts'
import {
  renderHazardTable,
  renderMatrix,
  renderScoreTable,
  scoreOf,
  strategy,
  STRATEGIES,
} from './strategies.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8')

const readme = read('a11y/README.md')
const workflow = read('.github/workflows/ci.yml')
const vitestConfig = read('vitest.config.ts')
const manifest = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
  devDependencies: Record<string, string>
}

/** The `**Lead sentence.**` openers of the findings section's paragraphs. */
function findingLeads(): string[] {
  const start = readme.indexOf('### What the tables say')
  const end = readme.indexOf('\n## ', start + 1)

  return readme
    .slice(start, end === -1 ? undefined : end)
    .split('\n\n')
    .slice(1)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.startsWith('**'))
}

describe('the published tables are the measurement', () => {
  it.each([
    ['hazard catalogue', renderHazardTable],
    ['score table', renderScoreTable],
    ['strategy matrix', renderMatrix],
    ['environment comparison', renderEnvironmentTable],
  ])('prints the %s exactly as the module renders it', (_name, render) => {
    expect(readme).toContain(render())
  })

  it('prints four distinct tables rather than one of them twice', () => {
    const rendered = [
      renderHazardTable(),
      renderScoreTable(),
      renderMatrix(),
      renderEnvironmentTable(),
    ]

    expect(new Set(rendered).size).toBe(rendered.length)
    expect(new Set(rendered.map((table) => readme.indexOf(table))).size).toBe(rendered.length)
  })
})

describe('the findings section', () => {
  it('opens one paragraph per finding and no more', () => {
    // Both directions: a finding with no paragraph fails this, and so does a
    // paragraph making a claim the tables do not support.
    expect(findingLeads()).toHaveLength(5)
  })

  it('quotes the arithmetic the findings rest on', () => {
    // Every number here is one a reader could check against a table above it,
    // which is exactly why these are the ones that go wrong.
    expect(readme).toContain(`scores ${String(scoreOf(strategy('per-page-on-load')))} of 12`)
    expect(readme).toContain('**finds one**')
    expect(readme).toContain(`Nine rules are off by default`)
    expect(readme).toContain('Half the catalogue is invisible to axe')
  })

  it('counts each verdict the way the catalogue counts it', () => {
    const spelled: Record<number, string> = { 1: 'One', 2: 'Two', 3: 'Three', 6: 'Six' }

    for (const verdict of ['violation', 'incomplete', 'disabled', 'none'] as const) {
      const count = hazardsWith(verdict).length
      const line = `**\`${verdict}\`**`
      const paragraph = readme.slice(readme.indexOf(line))

      expect(paragraph.startsWith(line), `no bullet for ${verdict}`).toBe(true)
      expect(
        paragraph.slice(0, 200),
        `the ${verdict} bullet does not say ${spelled[count] ?? count} of twelve`,
      ).toContain(`${spelled[count] ?? String(count)} of twelve`)
    }
  })

  it('names the number of rules axe-core ships disabled', () => {
    expect(DISABLED_BY_DEFAULT).toHaveLength(9)
  })

  it('names both rules that move between jsdom and a browser', () => {
    for (const row of movesWithEnvironment()) {
      expect(readme, `the README does not discuss ${row.rule}`).toContain(`\`${row.rule}\``)
    }
  })

  it('names every journey state it tabulates', () => {
    for (const state of JOURNEY_STATES) {
      expect(readme, `the README does not name ${state}`).toContain(`\`${state}\``)
    }
  })

  it('names every strategy it scores', () => {
    for (const subject of STRATEGIES) {
      expect(readme, `the README does not name ${subject.name}`).toContain(`\`${subject.name}\``)
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

  it('names two commands that exist and do what it says they do', () => {
    expect(manifest.scripts['test:a11y']).toBe(
      'playwright test --config a11y/playwright-a11y.config.ts',
    )

    for (const command of ['pnpm test a11y/', 'pnpm test:a11y']) {
      expect(readme, `the README does not show ${command}`).toContain(command)
    }
  })

  it('names a CI job that runs the browser half', () => {
    expect(workflow).toContain('run: pnpm test:a11y')
    expect(readme).toContain('the `a11y` job')
  })

  it('states the runner split the configs are actually wired with', () => {
    // The README's claim that `pnpm test a11y/` needs no browser holds only if
    // Vitest declines the spec.
    expect(vitestConfig).toContain("'a11y/**/*.spec.ts'")
    expect(readme).toContain('excludes `a11y/journey.spec.ts`')
  })

  it('pins the axe wrapper to the axe-core the rest of the repository installs', () => {
    // The claim the environment comparison rests on: one axe-core in the tree,
    // so the jsdom column and the browser column ran the same rule code.
    expect(manifest.devDependencies['@axe-core/playwright']).toBe('4.12.1')
    expect(readme).toContain('pinned to 4.12.1')
  })

  it('describes a catalogue of the size it documents', () => {
    expect(HAZARDS).toHaveLength(12)
    expect(readme).toContain('twelve real accessibility defects')
  })
})
