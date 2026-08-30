// @vitest-environment node
/**
 * The README, derived rather than trusted.
 *
 * Every number in `snapshot/README.md` comes from `matrix.ts`, `edits.ts` or
 * `registry.ts`, and this file reads the prose back out and checks it against
 * them. A prose claim that nothing checks is one commit from being wrong, and
 * the sentence stays convincing long after it stops being true — which is
 * exactly the failure the directory is about, one level up.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { BUGS, NOISE, VARIANTS } from './edits'
import { REGISTRY } from './registry'
import { resultFor, unionResult } from './matrix'
import { VOLATILE_PATTERNS } from './policy'
import { PROBE_IDS } from './probes'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const readme = readFileSync(join(repoRoot, 'snapshot/README.md'), 'utf8')

/**
 * One row of the results table: `| \`probe\` — gloss | caught / total | … |`.
 *
 * The em dash is load-bearing. Without it the pattern also matches the
 * pairing's row, whose label starts `` `projected` + `assertions` `` — and the
 * table would then be checked against `resultFor('projected')`, which is a
 * different measurement that happens to have the same shape.
 */
const ROW = /^\|\s*`(\w+)` — [^|]*\|\s*(\d+) \/ (\d+)\s*\|\s*(\d+) \/ (\d+)\s*\|\s*\*\*([\d.]+)%\*\*\s*\|/gm

describe('the results table', () => {
  it('has a row per probe, with the numbers matrix.ts computes', () => {
    const rows = [...readme.matchAll(ROW)]

    expect(rows.map((row) => row[1])).toEqual([...PROBE_IDS])

    for (const row of rows) {
      const result = resultFor(row[1] as (typeof PROBE_IDS)[number])

      expect(Number(row[2]), `${row[1]} caught`).toBe(result.caught)
      expect(Number(row[3]), `${row[1]} total bugs`).toBe(BUGS.length)
      expect(Number(row[4]), `${row[1]} false alarms`).toBe(result.falseAlarms)
      expect(Number(row[5]), `${row[1]} total noise`).toBe(NOISE.length)
      expect(Number(row[6]), `${row[1]} signal rate`).toBeCloseTo(result.signalRate, 1)
    }
  })

  it('states the pairing’s result as the union of the two narrow probes', () => {
    const union = unionResult(['projected', 'assertions'])
    const line = readme.split('\n').find((text) => text.includes('`projected` + `assertions`'))

    expect(line).toBeDefined()
    expect(line).toContain(`${union.caught} / ${BUGS.length}`)
    expect(line).toContain(`${union.falseAlarms} / ${NOISE.length}`)
    expect(union.signalRate).toBe(100)
  })
})

describe('the counts in the prose', () => {
  it('reports the corpus as sixteen variants, ten bugs and six refactors', () => {
    expect(VARIANTS).toHaveLength(16)
    expect(BUGS).toHaveLength(10)
    expect(NOISE).toHaveLength(6)
    expect(readme).toContain('sixteen single changes')
    expect(readme).toContain('Ten of the changes are bugs')
    expect(readme).toContain('**Six broke nothing**')
  })

  it('names the exact variants each narrow probe misses', () => {
    // The two lists in "The two narrow probes miss different things". If a
    // variant were renamed or a probe changed what it sees, the README would
    // still read plausibly, which is why this is asserted rather than eyeballed.
    for (const id of ['BADGE_MODIFIER_DROPPED', 'ARIA_LABEL_DROPPED']) {
      expect(readme, `${id} is not named in the README`).toContain(id)
    }

    for (const id of ['DISCOUNT_INCLUDES_DELIVERY', 'TAX_TRUNCATED']) {
      expect(readme, `${id} is not named in the README`).toContain(id)
    }
  })

  it('describes fourteen hand-written assertions, which is how many there are', () => {
    expect(readme).toContain('14 hand-written expectations')
  })
})

describe('the rules table', () => {
  it('has a row for every rule the gate can report', () => {
    // Sourced from the README against the union of what `policy.ts` can
    // produce. A seventh rule added without a row would leave the README
    // describing a gate that is stricter than it says.
    for (const rule of ['unregistered', 'unused', 'over-budget', 'volatile', 'obsolete', 'empty']) {
      expect(readme, `no README row for ${rule}`).toMatch(new RegExp(`\\| \`${rule}\` \\|`))
    }

    expect(readme).toContain('enforces six rules')
  })

  it('lists every volatility pattern the policy actually scans for', () => {
    const prose = readme.toLowerCase()

    for (const rule of VOLATILE_PATTERNS) {
      // Any substantial word of the pattern's name. Matching the whole name
      // would force the README to quote the table verbatim, which is a worse
      // README; matching the first word alone breaks on "a localhost port",
      // where the word a reader looks for is the second one.
      const words = rule.name.toLowerCase().split(/[\s-]+/).filter((word) => word.length > 3)

      expect(
        words.some((word) => prose.includes(word)),
        `${rule.name} is not mentioned in the README`,
      ).toBe(true)
    }
  })
})

describe('the file table', () => {
  it('has a row for every module in the directory', () => {
    // A file added here without a line in the README is a file nobody reading
    // the README knows exists.
    const modules = [
      'render.ts',
      'orders.ts',
      'project.ts',
      'edits.ts',
      'probes.ts',
      'matrix.ts',
      'diff.ts',
      'registry.ts',
      'inventory.ts',
      'policy.ts',
      'check.ts',
    ]

    for (const module of modules) {
      expect(readme, `${module} is not in the file table`).toMatch(
        new RegExp(`\\| \`${module.replace('.', '\\.')}\` \\|`),
      )
    }
  })
})

describe('the diff-size finding', () => {
  it('states the corpus sizes yield.test.ts measures', () => {
    expect(readme).toContain('138 lines')
    expect(readme).toContain('54 lines')
    expect(readme).toContain('| 64 | 0 |')
  })

  it('records the correction rather than the claim it started from', () => {
    expect(readme).toContain('the two mark exactly the same\nnumber of lines, every time')
  })
})

describe('the registry described in the README', () => {
  it('matches the registry that exists', () => {
    expect(REGISTRY.filter((entry) => entry.kind === 'file')).toHaveLength(1)
    expect(REGISTRY.filter((entry) => entry.kind === 'inline')).toHaveLength(4)
    expect(readme).toContain('registry.ts')
  })

  it('has a reason written for every registered snapshot', () => {
    // The rule the README calls the whole point. A row with an empty `why` is
    // a registration that recorded no decision.
    for (const entry of REGISTRY) {
      expect(entry.why.length, `${entry.name} has no reason`).toBeGreaterThan(30)
      expect(entry.budget).toBeGreaterThan(0)
    }
  })
})
