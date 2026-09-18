// @vitest-environment node
//
// Reads this directory's files off disk, so it needs the node environment.

/**
 * README.md against the directory it documents.
 *
 * `ct/README.md` is mostly two tables of measurements, and measurements go
 * stale. The ones on the *browser* side are re-derived by the specs on every
 * run — 568px of text in a 120px box is what `OverflowTooltip.spec.tsx`
 * asserts, and the jsdom column is what `*.jsdom.test.tsx` asserts — so what
 * is left unguarded is the arithmetic and the prose *around* them: a width
 * changed in a spec and not in the table, a component added with no paragraph,
 * a runner split described one way and configured another.
 *
 * That is what this file checks, and it checks it against the sources as text
 * rather than by importing them. A spec written for Playwright's runner cannot
 * be imported into Vitest — `test()` called outside a Playwright worker throws
 * — so the constants are parsed out of the file the same way
 * `workflow-templates/actionPins.ts` parses a workflow.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8')

const readme = read('ct/README.md')
const overflowSpec = read('ct/OverflowTooltip.spec.tsx')
const indexHtml = read('ct/index.html')
const ctConfig = read('ct/playwright-ct.config.ts')
const vitestConfig = read('vitest.config.ts')
const workflow = read('.github/workflows/ci.yml')
const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

/** The components this directory ships, by name. */
const components = readdirSync(join(here, 'components'))
  .filter((entry) => entry.endsWith('.tsx'))
  .map((entry) => entry.replace(/\.tsx$/, ''))

/** A `const NAME = 123` declaration's value, read out of a spec's source. */
function numberConstant(source: string, name: string): number {
  const match = new RegExp(`const ${name} = (\\d+)`).exec(source)

  if (match?.[1] === undefined) {
    throw new Error(`${name} is no longer declared as a number literal in the spec`)
  }

  return Number(match[1])
}

/** A `const NAME = '…'` declaration's value, read out of a spec's source. */
function stringConstant(source: string, name: string): string {
  const match = new RegExp(`const ${name} = '([^']+)'`).exec(source)

  if (match?.[1] === undefined) {
    throw new Error(`${name} is no longer declared as a string literal in the spec`)
  }

  return match[1]
}

/** The width the browser lays the long string out at, as the README publishes it. */
const PUBLISHED_CONTENT_WIDTH = 568

describe('the directory README documents the directory', () => {
  it('links every component the directory ships', () => {
    for (const component of components) {
      expect(readme, `README does not link ${component}`).toContain(
        `](./components/${component}.tsx)`,
      )
    }
  })

  it('pairs every component with a browser spec and a jsdom test', () => {
    // The pairing is the whole argument of this directory: a component with
    // only a browser spec has nothing to be compared against, and one with
    // only a jsdom test is in the wrong directory.
    for (const component of components) {
      expect(existsSync(join(here, `${component}.spec.tsx`)), `${component} has no browser spec`).toBe(
        true,
      )
      expect(
        existsSync(join(here, `${component}.jsdom.test.tsx`)),
        `${component} has no jsdom counterpart`,
      ).toBe(true)
    }
  })
})

describe('the overflow measurements in the README', () => {
  const cramped = numberConstant(overflowSpec, 'CRAMPED')
  const long = stringConstant(overflowSpec, 'LONG')

  it('names the box width the spec actually mounts', () => {
    expect(readme).toContain(`${cramped}px box`)
  })

  it('counts the characters the spec actually measures', () => {
    expect(readme).toContain(`${long.length} characters`)
  })

  it('subtracts the two numbers it publishes', () => {
    // 568 − 120. The overhang is quoted in two places and is the one figure on
    // the page that is arithmetic rather than a measurement, so it is the one
    // that goes wrong when a width is edited.
    expect(readme).toContain(`by ${PUBLISHED_CONTENT_WIDTH - cramped}px`)
    expect(readme).toContain(`${PUBLISHED_CONTENT_WIDTH}px`)
    expect(overflowSpec, 'the spec no longer states the width the README publishes').toContain(
      `${PUBLISHED_CONTENT_WIDTH}px`,
    )
  })

  it('quotes the typography the mount page actually sets', () => {
    // The measurement is only reproducible because the font is pinned. If the
    // page stops pinning it, every figure above becomes a property of whatever
    // `system-ui` resolves to on the machine that ran the suite.
    expect(indexHtml).toContain('font: 16px/1.5 monospace')
    expect(readme).toContain('16px monospace')
  })
})

describe('the wiring the README describes', () => {
  it('states the split the two runners are configured with', () => {
    expect(ctConfig).toContain("testMatch: '**/*.spec.tsx'")
    expect(vitestConfig).toContain("'ct/**/*.spec.tsx'")
    expect(readme).toContain('`*.jsdom.test.tsx`')
  })

  it('pins the component package to the Playwright installed beside it', () => {
    // `@playwright/experimental-ct-core` depends on an exact `playwright-core`,
    // so the component runner and the end-to-end runner have to be the same
    // release. `@playwright/test` is declared as a range and this package as an
    // exact version, which is the pairing that can drift: a Playwright minor
    // would move one and not the other, and the failure that follows is a
    // browser protocol mismatch reported from somewhere unhelpful.
    const versionOf = (pkg: string): string =>
      (JSON.parse(read(`node_modules/${pkg}/package.json`)) as { version: string }).version

    expect(versionOf('@playwright/experimental-ct-react')).toBe(versionOf('@playwright/test'))
  })

  it('names a script that exists and a CI job that runs it', () => {
    expect(manifest.scripts['test:ct']).toBe('playwright test --config ct/playwright-ct.config.ts')
    expect(readme).toContain('pnpm test:ct')
    expect(workflow).toContain('run: pnpm test:ct')
  })
})
