// @vitest-environment node
//
// Reads this directory's files off disk and resolves them relative to
// `import.meta.url`, which the project-default jsdom environment rewrites to
// an http: URL that `fileURLToPath` rejects.

/**
 * README.md against the directory it documents.
 *
 * Most of `ct/readme.test.ts`'s argument applies here — a measurement in prose
 * goes stale and nothing tells you — but this directory can do something
 * stronger, and does. The two matrix tables in the README are not *checked
 * against* `matrix.ts`; they are **rendered from it** by `renderTable` and
 * compared as text. There is no version of this file that agrees with a table
 * containing a wrong cell, a reordered row, or a column somebody added and did
 * not document. The two are the same string or the build is red.
 *
 * What is left over is the arithmetic and the prose *around* the tables: a
 * paragraph for every finding and no more, the counts the opening states, the
 * files it links, and the scripts it tells a reader to run. Those are the
 * things that go wrong when a wiring is added, and they are what the rest of
 * this suite checks.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { readHar } from './har'
import { FINDINGS, renderTable } from './matrix'
import { CURRENT_SCHEMA, ORIGIN_PORT, RECORDED_SCHEMA } from './origin'
import { PROBES } from './probes'
import { CONDITIONS, WIRINGS } from './wirings'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8')

const readme = read('intercept/README.md')
const workflow = read('.github/workflows/ci.yml')
const vitestConfig = read('vitest.config.ts')
const collect = read('shape/collect.ts')
const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

/** The body of one `##` section, by its heading. */
function section(heading: string): string {
  const start = readme.indexOf(`## ${heading}`)

  if (start === -1) {
    throw new Error(`the README no longer has a "${heading}" section`)
  }

  const next = readme.indexOf('\n## ', start + 1)

  return readme.slice(start, next === -1 ? undefined : next)
}

describe('the published tables are the measurement', () => {
  for (const condition of CONDITIONS) {
    it(`prints the ${condition} table exactly as the matrix renders it`, () => {
      expect(readme).toContain(renderTable(condition))
    })
  }

  it('prints both tables and not one twice', () => {
    const [connected, severed] = CONDITIONS.map((condition) => renderTable(condition))

    expect(connected).not.toBe(severed)
    expect(readme.indexOf(connected ?? '')).not.toBe(readme.indexOf(severed ?? ''))
  })
})

describe('the catalogue tables', () => {
  it('gives every wiring a row carrying its own summary and rationale', () => {
    for (const wiring of WIRINGS) {
      expect(readme, `${wiring.name} has no row`).toContain(
        `| \`${wiring.name}\` | ${wiring.summary} | ${wiring.rationale} |`,
      )
    }
  })

  it('gives every probe a row carrying its question and its whole vocabulary', () => {
    for (const probe of PROBES) {
      const outcomes = probe.outcomes.map((outcome) => `\`${outcome}\``).join(', ')

      expect(readme, `${probe.name} has no row`).toContain(
        `| \`${probe.name}\` | ${probe.question} | ${outcomes} |`,
      )
    }
  })

  it('states the counts the tables actually have', () => {
    const cells = WIRINGS.length * CONDITIONS.length * PROBES.length

    expect(readme).toContain(`${cells} cells`)
    expect(readme).toContain('eight wirings')
    expect(readme).toContain('twelve probes')
    expect(readme).toContain('two conditions')
  })
})

describe('the findings section', () => {
  it('opens one paragraph per finding and no more', () => {
    // Both directions at once: a finding added to `matrix.ts` with no
    // paragraph fails this, and so does a paragraph making a claim the table
    // is not asked to support.
    const leads = [...section('What the tables say').matchAll(/^\*\*(.+?)\*\*/gms)]

    expect(leads).toHaveLength(FINDINGS.length)
  })

  it('quotes the arithmetic the findings rest on', () => {
    // Every number here is one a reader could check against the tables above
    // it, which is exactly why they are the ones that go wrong.
    expect(readme).toContain('ten of twelve probes')
    expect(readme).toContain('exactly three probes')
    expect(readme).toContain('Five wirings answer `known-get`')
  })

  it('names the two schemas the drift is between', () => {
    expect(readme).toContain(`schema: ${RECORDED_SCHEMA}`)
    expect(readme).toContain(`schema: ${CURRENT_SCHEMA}`)
    expect(RECORDED_SCHEMA).toBeLessThan(CURRENT_SCHEMA)
  })

  it('counts the entries the committed recording holds', () => {
    expect(readHar().log.entries).toHaveLength(7)
    expect(readme).toContain('seven entries')
  })
})

describe('the wiring the README describes', () => {
  it('links only files that exist', () => {
    const links = [...readme.matchAll(/\]\((\.\/[^)]+|\.\.\/[^)]+)\)/g)].map((match) => match[1] ?? '')

    expect(links.length).toBeGreaterThan(0)

    for (const link of links) {
      const target = join(here, link.split('#')[0] ?? '')

      expect(existsSync(target), `${link} does not exist`).toBe(true)
    }
  })

  it('names the port the recorder and the fixture server agree on', () => {
    expect(readme).toContain(String(ORIGIN_PORT))
    expect(read('intercept/playwright-intercept.config.ts')).toContain('ORIGIN_PORT')
  })

  it('names three scripts that exist and do what it says they do', () => {
    expect(manifest.scripts['test:intercept']).toBe(
      'playwright test --config intercept/playwright-intercept.config.ts',
    )
    expect(manifest.scripts['intercept:record']).toBe('node intercept/record.ts')

    for (const command of ['pnpm test:intercept', 'pnpm intercept:record', 'pnpm test intercept/']) {
      expect(readme, `the README does not show ${command}`).toContain(command)
    }
  })

  it('names a CI job that runs the suite', () => {
    expect(workflow).toContain('run: pnpm test:intercept')
    expect(readme).toContain('the `intercept` job')
  })

  it('states the runner split the two configs are actually configured with', () => {
    // The claim the README makes about `shape/` only holds if both halves are
    // wired: Vitest must decline the specs and the census must collect them.
    expect(vitestConfig).toContain("'intercept/**/*.spec.ts'")
    expect(collect).toContain("collectPlaywright(outputDir, 'intercept/playwright-intercept.config.ts')")
  })
})
