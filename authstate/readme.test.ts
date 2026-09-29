// @vitest-environment node
//
// Reads this directory's files off disk and resolves them relative to
// `import.meta.url`, which the project-default jsdom environment rewrites to an
// http: URL that `fileURLToPath` rejects.

/**
 * README.md against the directory it documents.
 *
 * The two published tables are not *checked against* `capture.ts` and
 * `isolation.ts`; they are **rendered from** them and compared as text, the
 * arrangement `intercept/README.md` introduced. There is no version of this
 * file that agrees with a wrong cell, a reordered row, or a column somebody
 * added and did not document.
 *
 * What is left over is the prose around the tables, and it is checked in both
 * directions: every finding in `findings.ts` must have a paragraph, and every
 * claim-shaped paragraph must be a finding. A README that quietly grows a
 * twelfth claim nothing measures is the failure this half exists for.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { FINDINGS } from './findings.ts'
import { HAZARD_DEFINITIONS } from './isolation.ts'
import { PROBES } from './probes.ts'
import { renderCapture, renderIsolation } from './render.ts'
import { STRATEGIES } from './strategies.ts'
import { WIRINGS } from './wirings.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8')

const readme = read('authstate/README.md')
const workflow = read('.github/workflows/ci.yml')
const collect = read('shape/collect.ts')
const gates = read('workflow-templates/gateSteps.ts')
const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

describe('the published tables are the measurement', () => {
  it('prints the capture table exactly as render.ts renders it', () => {
    expect(readme).toContain(renderCapture())
  })

  it('prints the isolation table exactly as render.ts renders it', () => {
    expect(readme).toContain(renderIsolation())
  })

  it('prints two different tables rather than one twice', () => {
    expect(renderCapture()).not.toBe(renderIsolation())
  })
})

describe('the catalogue tables', () => {
  it('gives every wiring a row carrying its own summary', () => {
    for (const wiring of WIRINGS) {
      expect(readme, `${wiring.key} has no catalogue row`).toContain(`| \`${wiring.key}\` |`)
      expect(readme, `${wiring.key}'s summary is not published`).toContain(wiring.summary)
    }
  })

  it('gives every strategy a row carrying its own summary', () => {
    for (const strategy of STRATEGIES) {
      expect(readme, `${strategy.key} has no catalogue row`).toContain(`| \`${strategy.key}\` |`)
    }
  })

  it('gives every hazard a row carrying the question it asks', () => {
    for (const hazard of HAZARD_DEFINITIONS) {
      expect(readme, `${hazard.key} has no row`).toContain(`| \`${hazard.key}\` |`)
      expect(readme, `${hazard.key}'s question is not published`).toContain(hazard.asks)
    }
  })

  it('names every probe somewhere, so no column is undocumented', () => {
    for (const probe of PROBES) {
      expect(readme, `${probe.key} is never mentioned`).toContain(probe.key)
    }
  })
})

/**
 * A findings paragraph opens with a bolded sentence. That is a convention
 * rather than a law, which is exactly why it is enforced: the count in both
 * directions is what stops a claim being added without a predicate behind it.
 */
const boldOpeners = (readme.match(/^\*\*[^*]+/gm) ?? []).length

describe('every finding has a paragraph, and every paragraph a finding', () => {
  it('opens as many claim paragraphs as there are findings', () => {
    expect(boldOpeners).toBe(FINDINGS.length)
  })

  for (const finding of FINDINGS) {
    it(`publishes the ${finding.id} finding`, () => {
      expect(readme, `${finding.id} has no paragraph in the README`).toContain(finding.phrase)
    })
  }

  it('gives every finding a phrase distinctive enough to locate it', () => {
    const ambiguous = FINDINGS.filter(
      (finding) => readme.split(finding.phrase).length !== 2,
    ).map((finding) => finding.id)

    expect(ambiguous).toEqual([])
  })
})

describe('the mechanisms, not only the verdicts', () => {
  it('names what a replacement worker keeps and what it does not', () => {
    expect(readme).toMatch(/new `workerIndex` and the\s+same `parallelIndex`/)
  })

  it('names the barrier as the reason the parallel phase needs no sleep', () => {
    expect(readme).toMatch(/rendezvous rather than a duration/)
  })

  it('states the control that makes an absent cell mean anything', () => {
    expect(readme).toMatch(/scoped to a browsing context/)
  })

  it('states the one engine the capture table was measured in', () => {
    expect(readme).toMatch(/Chromium only/)
  })
})

describe('the directory it describes', () => {
  it('links only files that exist', () => {
    const named = new Set(readme.match(/`([a-z][\w./-]*\.(?:ts|md))`/g) ?? [])

    for (const quoted of named) {
      const name = quoted.replaceAll('`', '')

      // Repo-relative paths are resolved from the root; bare names from here.
      const candidate = name.includes('/') ? join(repoRoot, name) : join(here, name)

      if (!name.includes('/') || name.startsWith('authstate/')) {
        expect(existsSync(candidate), `${name} is named in the README but does not exist`).toBe(
          true,
        )
      }
    }
  })

  it('tells the reader the scripts that actually exist', () => {
    for (const script of ['test', 'test:authstate']) {
      expect(manifest.scripts[script], `package.json has no ${script} script`).toBeDefined()
      expect(readme, `the README does not mention pnpm ${script}`).toContain(`pnpm ${script}`)
    }
  })
})

describe('the wiring into the rest of the repository', () => {
  it('has a CI job running the capture half', () => {
    expect(workflow).toContain('pnpm test:authstate')
  })

  it('collects the capture specs in the shape census', () => {
    expect(collect).toContain("collectPlaywright(outputDir, 'authstate/playwright-authstate.config.ts')")
  })

  it('excuses the fixture specs in the census, since no runner runs them', () => {
    for (const spec of ['alpha', 'beta', 'restart']) {
      expect(collect).toContain(`authstate/fixture/specs/${spec}.spec.ts`)
    }
  })

  it('runs the capture gate under --throw-deprecation like every other gate', () => {
    expect(gates).toContain("'test:authstate'")
  })
})
