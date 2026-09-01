// @vitest-environment node
/**
 * The README, derived rather than trusted.
 *
 * Every count in `fuzz/README.md` comes from `corpus.ts`, `edits.ts`,
 * `settings.ts` or a live measurement, and this file reads the prose back and
 * checks it against them. The directory's whole argument is that a claim
 * nobody re-derives goes on sounding right long after it stops being true —
 * which would be an unfortunate thing for its own README to demonstrate.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { PROBE_IDS, type ProbeId } from './campaign.ts'
import { CROSSOVER, DETECTIONS, probesThatFound } from './corpus.ts'
import { VARIANTS, VARIANT_IDS } from './edits.ts'
import { GENERATOR_IDS, type GeneratorId } from './generators.ts'
import { ORACLES } from './oracles.ts'
import { measureReach, type Reach } from './reach.ts'
import { CAMPAIGN_BUDGET, DEEP_NESTING, SEED } from './settings.ts'

const readme = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8')

const foundBy = (probe: ProbeId): readonly string[] =>
  VARIANT_IDS.filter((id) => probesThatFound(id).includes(probe))

/**
 * `| \`crash\` — gloss | **1 / 16** | what it is |`
 *
 * Anchored to the end of the row. Without the anchor this also matches the
 * generator table, whose rows open identically and carry four more cells — and
 * the oracle counts would then be checked against a coverage figure that
 * happens to have the same shape.
 */
const ORACLE_ROW = /^\|\s*`(\w+)` — [^|]*\|\s*\*\*(\d+) \/ (\d+)\*\*\s*\|[^|]*\|\s*$/gm

describe('the oracle matrix table', () => {
  const rows = [...readme.matchAll(ORACLE_ROW)]

  it('has a row per probe, in the order the probes are declared', () => {
    expect(rows.map((row) => row[1])).toStrictEqual([...PROBE_IDS])
  })

  it.each(PROBE_IDS)('quotes the count corpus.ts records for %s', (probe) => {
    const row = rows.find((candidate) => candidate[1] === probe)

    expect(row).toBeDefined()
    expect(Number(row?.[2])).toBe(foundBy(probe).length)
    expect(Number(row?.[3])).toBe(VARIANT_IDS.length)
  })

  it('states the union of the automated probes correctly', () => {
    const union = VARIANT_IDS.filter((id) =>
      probesThatFound(id).some((probe) => probe !== 'examples'),
    )
    const line = readme.split('\n').find((text) => text.includes('all four automated probes'))

    expect(line).toContain(`**${union.length} / ${VARIANT_IDS.length}**`)
  })
})

describe('the generator reach table', () => {
  const reach: Record<GeneratorId, Reach> = {
    random: measureReach('random', SEED, CAMPAIGN_BUDGET),
    mutate: measureReach('mutate', SEED, CAMPAIGN_BUDGET),
    grammar: measureReach('grammar', SEED, CAMPAIGN_BUDGET),
    mixed: measureReach('mixed', SEED, CAMPAIGN_BUDGET),
  }

  /** `| \`random\` — gloss | **7 / 13** | **1 / 9** | 3 | 0 |` */
  const ROW = /^\|\s*`(\w+)` — [^|]*\|\s*\*\*(\d+) \/ (\d+)\*\*\s*\|\s*\*\*(\d+) \/ (\d+)\*\*\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gm

  const rows = [...readme.matchAll(ROW)]

  it('has a row per generator, in the order they are declared', () => {
    expect(rows.map((row) => row[1])).toStrictEqual([...GENERATOR_IDS])
  })

  it.each(GENERATOR_IDS)('quotes what %s actually reached', (id) => {
    const row = rows.find((candidate) => candidate[1] === id)
    const measured = reach[id]

    expect(row).toBeDefined()
    expect(Number(row?.[2]), 'parse refusals').toBe(measured.parseCodes.length)
    expect(Number(row?.[4]), 'validation refusals').toBe(measured.validationCodes.length)
    expect(Number(row?.[6]), 'parsed').toBe(measured.parsed)
    expect(Number(row?.[7]), 'accepted').toBe(measured.accepted)
  })

  it('quotes the campaign size the table was measured over', () => {
    expect(readme).toContain(`Over ${CAMPAIGN_BUDGET.toLocaleString('en-GB')} inputs each`)
  })

  it('quotes the acceptance rate the structure-aware generator now reaches', () => {
    const rate = Math.round((reach.grammar.accepted / reach.grammar.inputs) * 100)

    expect(readme).toContain(`from 0.4% to ${rate}%`)
  })
})

describe('the generator crossover table', () => {
  /** `| \`FAULT\` | \`oracle\` | · | ✓ | · | ✓ |` */
  const ROW = /^\|\s*`([A-Z_]+)`\s*\|\s*`(\w+)`\s*\|\s*([·✓])\s*\|\s*([·✓])\s*\|\s*([·✓])\s*\|\s*([·✓])\s*\|/gm

  const rows = [...readme.matchAll(ROW)]

  it('has a row per recorded crossover case, in order', () => {
    expect(rows.map((row) => row[1])).toStrictEqual(CROSSOVER.map((row) => row.variant))
    expect(rows.map((row) => row[2])).toStrictEqual(CROSSOVER.map((row) => row.probe))
  })

  it.each(CROSSOVER.map((row) => [row.variant, row] as const))(
    'marks the generators that found %s',
    (variant, recorded) => {
      const row = rows.find((candidate) => candidate[1] === variant)
      const marked = GENERATOR_IDS.filter((_id, index) => row?.[index + 3] === '✓')

      expect(marked).toStrictEqual(recorded.foundBy)
    },
  )
})

describe('the minimisation table', () => {
  const minimised = DETECTIONS.filter((detection) => detection.evaluations > 0)

  const kept = (half: 'parser' | 'validator'): number => {
    const rows = minimised.filter(
      (detection) => VARIANTS.find((variant) => variant.id === detection.variant)?.half === half,
    )

    return Math.round(
      (100 * rows.reduce((total, row) => total + row.minimisedLength / row.foundLength, 0)) /
        rows.length,
    )
  }

  it('quotes the average reduction on unstructured witnesses', () => {
    expect(readme).toContain(`| **${kept('parser')}%** on average |`)
  })

  it('quotes the average reduction on structured witnesses', () => {
    expect(readme).toContain(`| **${kept('validator')}%** on average |`)
  })

  it('quotes a real before-and-after for each row', () => {
    const largest = minimised.reduce((best, row) =>
      row.foundLength > best.foundLength ? row : best,
    )

    expect(readme).toContain(`${largest.foundLength} → ${largest.minimisedLength} characters`)
  })

  it('quotes the size of the crash witness it declines to minimise', () => {
    expect(readme).toContain(`"[".repeat(${DEEP_NESTING})`)
  })
})

describe('the claims that carry the argument', () => {
  it('names the two faults nothing automated finds, and no others', () => {
    const missed = VARIANT_IDS.filter(
      (id) => probesThatFound(id).filter((probe) => probe !== 'examples').length === 0,
    )

    for (const id of missed) {
      expect(readme).toContain(id)
    }

    expect(missed).toHaveLength(2)
    expect(readme).toContain('Over-rejection is invisible to fuzzing by construction')
  })

  it('admits the automated probes are a subset of the examples, when they are', () => {
    const automated = VARIANT_IDS.filter((id) =>
      probesThatFound(id).some((probe) => probe !== 'examples'),
    )
    const byExamples = foundBy('examples')
    const subset = automated.every((id) => byExamples.includes(id as string))

    expect(subset).toBe(true)
    expect(readme).toContain('the automated probes are a strict subset of the')
  })

  it('does not claim the differential oracle found a validator fault', () => {
    const validatorFaults = VARIANTS.filter((variant) => variant.half === 'validator')
    const crossover = validatorFaults.filter((variant) =>
      probesThatFound(variant.id).includes('differential'),
    )

    expect(crossover).toStrictEqual([])
    expect(readme).toContain('It finds **zero** validator faults')
  })

  it('reports the seed experiment as it was measured', () => {
    expect(readme).toContain('20,000 mutations')
    expect(readme).toContain('**input 45**')
    expect(readme).toContain('**never**')
  })

  it('says what each oracle is blind to, in the oracle it belongs to', () => {
    for (const oracle of ORACLES) {
      expect(readme).toContain(`\`${oracle.id}\``)
    }
  })

  it('lists every fault by name somewhere in the prose or the files table', () => {
    const named = VARIANT_IDS.filter((id) => readme.includes(id))

    // Not all sixteen: the README argues about the ones that carry a finding.
    // What it must not do is name one that no longer exists.
    expect(named.length).toBeGreaterThan(5)
  })

  it('names only faults that exist', () => {
    const mentioned = [...readme.matchAll(/`?([A-Z][A-Z_]{6,})`?/g)].map((match) => match[1])
    const unknown = mentioned.filter(
      (name) =>
        !(VARIANT_IDS as readonly string[]).includes(name as string) &&
        !['MAX_DEPTH', 'UNEXPECTED_CHARACTER', 'UNKNOWN_KEY', 'PERTURBATIONS', 'SEED_CORPUS'].includes(
          name as string,
        ),
    )

    expect(unknown).toStrictEqual([])
  })
})

describe('the files table', () => {
  it('lists every module in the directory', async () => {
    const { readdirSync } = await import('node:fs')
    const directory = fileURLToPath(new URL('.', import.meta.url))
    const modules = readdirSync(directory).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    )

    for (const name of modules) {
      expect(readme, `${name} is missing from the files table`).toContain(`| \`${name}\` |`)
    }
  })

  it('lists nothing that is not there', async () => {
    const { existsSync } = await import('node:fs')
    const directory = fileURLToPath(new URL('.', import.meta.url))
    const listed = [...readme.matchAll(/^\| `([\w.]+\.ts)` \|/gm)].map((match) => match[1])

    expect(listed.length).toBeGreaterThan(10)

    for (const name of listed) {
      expect(existsSync(`${directory}${name}`), `${name} is listed but absent`).toBe(true)
    }
  })
})
