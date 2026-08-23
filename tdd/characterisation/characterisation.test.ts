// @vitest-environment node
/**
 * The README, checked against the code it describes.
 *
 * Every claim in that document is either derived from something that runs
 * (`detection.test.ts` builds the matrix; `divergences.ts` runs its probes) or
 * checked here: the headings exist, the modules it links to exist, the figures
 * it quotes are the figures the code produces, and every mutant, suite,
 * divergence and seam it names is one that is really there.
 *
 * This is the same arrangement as `tdd/doubles/taxonomy.test.ts`, for the same
 * reason. A README is a comment on a directory, and comments rot; the ones in
 * this repository fail `pnpm test` instead.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DETECTION, HEADLINE, SEAMS, SUITES, killsBy } from './characterisation'
import { MUTANTS } from './mutants'
import { DIVERGENCES } from './divergences'
import { BRANCHES } from './legacy/renewal'

const readme = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8')
const requirements = readFileSync(
  fileURLToPath(new URL('./requirements.md', import.meta.url)),
  'utf8',
)

describe('the README', () => {
  it('keeps a section for each step of the exercise', () => {
    for (const heading of [
      '## The situation',
      '## What it costs to skip this',
      '## How it was built',
      '### 1. Break the smallest dependencies you can, first',
      '### 2. Build the corpus, and be able to say why it is adequate',
      '### 3. Record, and make the recording hard to launder',
      '### 4. Only then, refactor',
      '## The five divergences',
      '## When to use this',
    ]) {
      expect(readme, `missing heading: ${heading}`).toContain(heading)
    }
  })

  it('links to every module a reader is sent to', () => {
    for (const module of [
      './legacy/renewal.ts',
      './requirements.md',
      './corpus.ts',
      './corpus.test.ts',
      './observe.ts',
      './record.ts',
      './golden-master.json',
      './goldenMaster.test.ts',
      './seams.test.ts',
      './refactored.ts',
      './equivalence.test.ts',
      './detection.test.ts',
      './divergences.ts',
    ]) {
      expect(readme, `missing link: ${module}`).toContain(`(${module})`)
    }
  })

  it('quotes the figures the code actually produces', () => {
    expect(readme).toContain(`${HEADLINE.corpusSize} cases`)
    expect(readme).toContain(`${HEADLINE.corpusSize} recorded cases`)
    expect(readme).toContain(`one of the ${HEADLINE.branches} branches`)
    expect(readme).toContain(`${HEADLINE.specificationChecks} behaviours read carefully`)
    expect(readme).toContain(`**${killsBy('specification').length} / ${HEADLINE.mutants}**`)
    expect(readme).toContain(`**${killsBy('golden-master:invoice').length} / ${HEADLINE.mutants}**`)
    expect(readme).toContain(
      `**${killsBy('golden-master:everything').length} / ${HEADLINE.mutants}**`,
    )
    expect(readme).toContain('## The five divergences')
    expect(HEADLINE.divergences).toBe(5)
  })

  it('describes every mutant, with the row the matrix derived for it', () => {
    for (const mutant of MUTANTS) {
      const row = readme.split('\n').find((line) => line.includes(`| ${mutant.description} |`))

      expect(row, `no matrix row for ${mutant.id}`).toBeDefined()

      const cells = (row ?? '').split('|').map((cell) => cell.trim())
      // | description | documentation says so | specification | invoice | everything |
      const [, , documented, specification, invoiceOnly, everything] = cells

      expect(documented, `${mutant.id}: documentation column`).toBe(
        mutant.matchesTheDocs ? 'yes' : 'no',
      )
      expect(specification, `${mutant.id}: specification column`).toBe(
        DETECTION[mutant.id].includes('specification') ? '✓' : '·',
      )
      expect(invoiceOnly, `${mutant.id}: invoice-only column`).toBe(
        DETECTION[mutant.id].includes('golden-master:invoice') ? '✓' : '·',
      )
      expect(everything, `${mutant.id}: everything column`).toBe(
        DETECTION[mutant.id].includes('golden-master:everything') ? '✓' : '·',
      )
    }
  })

  it('names every seam and what omitting it would cost', () => {
    for (const seam of SEAMS) {
      expect(readme, `seam ${seam.name} missing`).toContain(`\`${seam.name}\``)
      expect(readme, `seam ${seam.name} has no consequence stated`).toContain(seam.problem)
    }
  })

  it('reproduces every divergence, both halves of it', () => {
    for (const divergence of DIVERGENCES) {
      expect(readme, `${divergence.id}: documented sentence`).toContain(divergence.documented)
      expect(readme, `${divergence.id}: what happens instead`).toContain(divergence.actual)
    }
  })

  it('summarises each of the three suites the matrix compares', () => {
    expect(SUITES.map((suite) => suite.id)).toEqual([
      'specification',
      'golden-master:invoice',
      'golden-master:everything',
    ])

    for (const suite of SUITES) {
      expect(suite.summary.length, `${suite.id} has no summary`).toBeGreaterThan(20)
      expect(suite.watches.length, `${suite.id} does not say what it watches`).toBeGreaterThan(20)
    }
  })

  it('warns against the two ways this technique is misused', () => {
    expect(readme).toContain('Do not reach for it when you are writing new code')
    expect(readme).toContain('It is scaffolding')
  })
})

describe('the inherited requirements', () => {
  it('still contains the words each divergence is reading', () => {
    // The document is evidence, not decoration: `divergences.ts` reads a rule
    // out of it, and a rule that no longer appears in the source is one nobody
    // can check. Whitespace is flattened because the source is hard-wrapped.
    const flattened = requirements.replace(/\s+/g, ' ')

    for (const divergence of DIVERGENCES) {
      expect(flattened, `${divergence.id} is not reading requirements.md`).toContain(
        divergence.quotedFrom.replace(/\s+/g, ' '),
      )
    }
  })

  it('has not been quietly corrected to match the code', () => {
    // The point of keeping a wrong document in the repository is that it is
    // the artefact `spec.test.ts` was written from. Tidying it would make that
    // suite look better informed than it was, and the comparison meaningless.
    const flattened = requirements.replace(/\s+/g, ' ')

    expect(flattened).toContain('Volume and loyalty discounts are added together')
    expect(flattened).toContain('An invoice total is never negative')
    expect(flattened).toContain('100 or more')
  })
})

describe('the branch list', () => {
  it('is the length the README quotes', () => {
    expect(BRANCHES).toHaveLength(HEADLINE.branches)
  })
})
