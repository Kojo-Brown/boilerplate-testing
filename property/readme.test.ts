// @vitest-environment node
//
// Reads README.md off disk, so it needs a filesystem rather than a DOM.

/**
 * README.md against the code it documents.
 *
 * Every number on that page is a measurement, and a measurement written into
 * prose is a measurement that starts rotting the moment somebody changes an
 * arbitrary. So none of it is trusted: the tables are re-rendered here from a
 * live run and the README is required to contain them, line for line.
 *
 * The direction matters. This checks that everything the code measures appears
 * in the README — a new fault or a new invariant with no line fails — and that
 * every rendered table row is present verbatim. It does not check the reverse
 * (that the README contains nothing else), because most of the file is the
 * argument rather than the data, and a rule that forbade prose would be a rule
 * that got turned off.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SAMPLES } from './arbitraries'
import { NUM_RUNS } from './config'
import { ALL_PAIRS, coverageOf, SITUATIONS, SITUATION_LABELS } from './coverage'
import { FAULTS } from './faults'
import { INVARIANTS } from './invariants'
import { runMatrix } from './matrix'
import { PROBES, PROBE_IDS } from './probes'
import { percent, profileSample } from './profile'

const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8')

const rows = runMatrix()

const caughtCount = (probe: (typeof PROBE_IDS)[number]): number =>
  rows.filter((row) => row.results[probe].caught).length

describe('the property catalogue', () => {
  it('lists every invariant, with its family, its domain and its statement', () => {
    for (const invariant of INVARIANTS) {
      expect(
        readme,
        `README does not document ${invariant.id}`,
      ).toContain(
        `- \`${invariant.id}\` (${invariant.family}, ${invariant.domain}) — ${invariant.statement}`,
      )
    }
  })

  it('names the three families it compares', () => {
    for (const family of ['structural', 'metamorphic', 'model']) {
      expect(readme).toContain(`**${family}**`)
    }
  })
})

describe('the fault catalogue', () => {
  it('lists every fault, with the description the matrix rows are keyed by', () => {
    for (const fault of FAULTS) {
      expect(readme, `README does not document ${fault.id}`).toContain(
        `- \`${fault.id}\` — ${fault.description}`,
      )
    }
  })
})

describe('the detection matrix', () => {
  it('publishes the header the measured columns are in', () => {
    expect(readme).toContain(`| Fault | ${PROBE_IDS.join(' | ')} |`)
  })

  it('publishes every measured row exactly as it comes out of the run', () => {
    for (const row of rows) {
      const rendered =
        `| \`${row.fault.id}\` | ` +
        PROBE_IDS.map((id) => (row.results[id].caught ? '✓' : '—')).join(' | ') +
        ' |'

      expect(readme, `README row for ${row.fault.id} does not match the measurement`).toContain(
        rendered,
      )
    }
  })

  it('publishes the totals, so a probe cannot lose a catch unnoticed', () => {
    const rendered =
      '| **caught** | ' +
      PROBE_IDS.map((id) => `**${caughtCount(id)} / ${rows.length}**`).join(' | ') +
      ' |'

    expect(readme).toContain(rendered)
  })
})

describe('the arbitrary profile', () => {
  const columns = [
    'overlap',
    'touch',
    'containment',
    'degenerate',
    'negative',
    'fractional',
  ] as const

  it('publishes every measured percentage, to the decimal place they were measured at', () => {
    for (const sample of SAMPLES) {
      const profile = profileSample(sample)
      const rendered =
        `| \`${sample.id}\` | ` +
        columns.map((column) => percent(profile.counts[column], profile.draws)).join(' | ') +
        ` | ${caughtCount(sample.id)} / ${rows.length} |`

      expect(readme, `README profile row for ${sample.id} is stale`).toContain(rendered)
    }
  })

  it('publishes how each arbitrary is built', () => {
    for (const sample of SAMPLES) {
      expect(readme).toContain(`| \`${sample.id}\` | ${sample.label} |`)
    }
  })
})

describe('the coverage table', () => {
  it('publishes the situations it counts, with their labels', () => {
    for (const situation of SITUATIONS) {
      expect(readme, `README does not document the ${situation} situation`).toContain(
        `- \`${situation}\` — ${SITUATION_LABELS[situation]}`,
      )
    }
  })

  it('publishes every probe’s measured situation and pair counts', () => {
    for (const probe of PROBES) {
      const report = coverageOf(probe.inputs())
      const rendered =
        `| \`${probe.id}\` | ${report.calls} | ${report.situations.size} / ${SITUATIONS.length} ` +
        `| ${report.pairs.size} / ${ALL_PAIRS.length} |`

      expect(readme, `README coverage row for ${probe.id} is stale`).toContain(rendered)
    }
  })
})

describe('the claims that are not tables', () => {
  it('states the run count the properties are configured for', () => {
    expect(readme).toContain(`\`NUM_RUNS\` is ${NUM_RUNS}`)
  })

  it('points at the command that runs the directory', () => {
    expect(readme).toContain('pnpm test property/')
  })

  it('keeps a section for what is deliberately not built', () => {
    // The half of a pattern README that stops it being a sales page.
    expect(readme).toContain('## What is not built')
  })

  it('lists every module in the directory, so nothing arrives undocumented', () => {
    const modules = [
      'availability.ts',
      'model.ts',
      'arbitraries.ts',
      'invariants.ts',
      'examples.ts',
      'faults.ts',
      'probes.ts',
      'matrix.ts',
      'coverage.ts',
      'profile.ts',
      'shrinking.ts',
      'config.ts',
    ]

    for (const module of modules) {
      expect(readme, `README does not list ${module}`).toContain(`| \`${module}\` |`)
    }
  })
})
