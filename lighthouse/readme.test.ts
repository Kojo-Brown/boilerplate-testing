// @vitest-environment node
//
// README.md's tables are not checked against the model — they are *rendered
// from* it and compared as text, the discipline `k6/`, `intercept/` and
// `trace/` established. There is no version of this file that agrees with a
// published table holding a wrong cell.
//
// The findings are held to the same standard in both directions: each is a
// predicate plus a heading the README must carry, so a finding that stops being
// true fails here, and a heading with no finding behind it fails here too.

import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { STICKY_MARKER } from './comment.ts'
import {
  findings,
  lhciPostsOnlyStatuses,
  MEASURED_AGAINST,
  renderBudgetTable,
  renderWiringTable,
} from './findings.ts'
import { loadBudgets } from './load.ts'

const here = dirname(fileURLToPath(import.meta.url))
const README = readFileSync(join(here, 'README.md'), 'utf8')

/**
 * The same text with its line wrapping flattened.
 *
 * Prose assertions read this: a sentence that says the right thing should not
 * fail because the paragraph was re-wrapped, and a sentence that says the wrong
 * thing should not pass because it was.
 */
const PROSE = README.replace(/\s+/g, ' ')

const budgets = loadBudgets()

describe('the tables are rendered, not transcribed', () => {
  it('carries the budget table exactly as `renderBudgetTable` prints it', () => {
    expect(README).toContain(renderBudgetTable(budgets))
  })

  it('carries the wiring table exactly as `renderWiringTable` prints it', () => {
    expect(README).toContain(renderWiringTable())
  })
})

describe('every finding is published, and every published finding holds', () => {
  for (const finding of findings(budgets)) {
    it(`carries and supports: ${finding.heading.replace(/^#+ /, '')}`, () => {
      // Matched as a whole line, so a section renamed to soften a claim fails
      // rather than passing on a substring.
      expect(README.split('\n')).toContain(finding.heading)
      expect(finding.holds()).toBe(true)
    })
  }

  it('publishes no "What was measured" heading with no finding behind it', () => {
    const headings = new Set(findings(budgets).map((finding) => finding.heading))
    const start = README.indexOf('## What was measured')
    const end = README.indexOf('\n## ', start + 1)

    expect(start).toBeGreaterThan(-1)

    const published = README.slice(start, end === -1 ? undefined : end)
      .split('\n')
      .filter((line) => line.startsWith('### '))

    expect(published.filter((heading) => !headings.has(heading))).toEqual([])
  })
})

describe('the versions the measurements were taken against', () => {
  it('names them in the README', () => {
    expect(PROSE).toContain(`Lighthouse ${MEASURED_AGAINST.lighthouse}`)
    expect(PROSE).toContain(`Lighthouse CI ${MEASURED_AGAINST.lhci}`)
  })

  // A README claiming to have been measured against a version nobody has
  // installed is the failure this repository's audit gates exist for.
  it('matches the installed Lighthouse and LHCI', () => {
    const require = createRequire(import.meta.url)
    const lhciRequire = createRequire(require.resolve('@lhci/cli/src/cli.js'))

    const lhci = JSON.parse(
      readFileSync(require.resolve('@lhci/cli/package.json'), 'utf8'),
    ) as { version: string }
    const lighthouse = JSON.parse(
      readFileSync(lhciRequire.resolve('lighthouse/package.json'), 'utf8'),
    ) as { version: string }

    expect(lhci.version).toBe(MEASURED_AGAINST.lhci)
    expect(lighthouse.version).toBe(MEASURED_AGAINST.lighthouse)
  })
})

describe('the commands the README publishes', () => {
  it('names both entry points', () => {
    expect(README).toContain('pnpm lighthouse:ci')
    expect(README).toContain('pnpm lighthouse:check')
  })

  it('names them in package.json too', () => {
    const scripts = (
      JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }
    ).scripts

    expect(scripts['lighthouse:ci']).toContain('lighthouse/lighthouserc.cjs')
    expect(scripts['lighthouse:check']).toBe('node lighthouse/check.ts')
  })

  it('documents the port the fixture origin uses', () => {
    // The README's runnable example hardcodes it; a changed default would make
    // a copied command silently audit nothing.
    expect(README).toContain('localhost:8802')
  })
})

describe('the sticky comment', () => {
  it('describes the comment as updated in place rather than appended', () => {
    expect(PROSE).toContain('updated in place')
  })

  it('keys on an HTML comment, which is what makes it invisible to a reader', () => {
    expect(STICKY_MARKER.startsWith('<!--')).toBe(true)
    expect(STICKY_MARKER.endsWith('-->')).toBe(true)
  })
})

describe('lhciPostsOnlyStatuses', () => {
  it('reads the installed @lhci/cli rather than asserting from memory', () => {
    expect(lhciPostsOnlyStatuses()).toBe(true)
  })
})

describe('the file index', () => {
  it('lists every module in this directory', () => {
    const modules = readdirSync(here)
      .filter(
        (name) =>
          (name.endsWith('.ts') || name.endsWith('.cjs') || name.endsWith('.json')) &&
          !name.endsWith('.test.ts'),
      )
      .sort()

    expect(modules.length).toBeGreaterThan(0)
    for (const name of modules) {
      expect(README).toContain(`\`${name}\``)
    }
  })
})
