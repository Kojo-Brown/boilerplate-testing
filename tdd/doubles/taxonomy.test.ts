// @vitest-environment node
/**
 * The audit that stops the guide from drifting away from the code.
 *
 * `README.md` is the deliverable here, and it makes claims of exactly the kind
 * prose is worst at keeping: which file holds which kind, which collaborator
 * each is demonstrated on, and a five-by-five table of what each kind catches.
 * A rename, a moved file, or a row edited by hand would leave every sentence
 * in place and several of them wrong.
 *
 * So the README is read as data and checked against `taxonomy.ts` — the same
 * reasoning as `../katas.test.ts` and `../schools/design.test.ts`, applied to
 * a third kind of claim.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import { FAULTS, FAULT_IDS } from './faults'
import { CAUGHT, DETECTION, DOUBLE_KINDS, MISSED, TAXONOMY } from './taxonomy'

const here = new URL('.', import.meta.url)
const readme = readFileSync(fileURLToPath(new URL('README.md', here)), 'utf8')
const files = readdirSync(fileURLToPath(here))

/** Modules that are not one kind's double: the feature, the harness, the data. */
const SUPPORT_MODULES = [
  'faults.ts',
  'probes.ts',
  'registerUser.ts',
  'taxonomy.ts',
  'userStoreContract.ts',
  'world.ts',
]

function row(firstCell: string): string[] {
  const line = readme.split('\n').find((candidate) => candidate.startsWith(`| ${firstCell}`))

  if (line === undefined) {
    throw new Error(`README has no table row starting with ${firstCell}`)
  }

  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

describe('the taxonomy', () => {
  it('covers the five kinds, once each, in the documented order', () => {
    expect(TAXONOMY.map((entry) => entry.kind)).toEqual([...DOUBLE_KINDS])
  })

  it('ships every kind in a module that exists', () => {
    for (const entry of TAXONOMY) {
      expect(files, `${entry.kind} points at a missing ${entry.module}`).toContain(entry.module)
    }
  })

  it('classifies every module in the folder', () => {
    // A sixth double added as a file and never added to the taxonomy would
    // otherwise sit here undocumented and untested by the matrix.
    const claimed = [...TAXONOMY.map((entry) => entry.module), ...SUPPORT_MODULES].sort()
    const onDisk = files.filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts')).sort()

    expect(onDisk).toEqual(claimed)
  })

  it('has a fault list and a detection matrix that agree', () => {
    expect(Object.keys(DETECTION).sort()).toEqual([...FAULT_IDS].sort())
    expect(FAULTS.map((fault) => fault.id)).toEqual([...FAULT_IDS])
  })
})

describe('the README', () => {
  it('gives every kind a section, its one-line definition, and its seam', () => {
    for (const entry of TAXONOMY) {
      const heading = `### ${entry.kind[0]?.toUpperCase()}${entry.kind.slice(1)}`

      expect(readme, `no ${heading} section`).toContain(heading)
      expect(readme, `${entry.kind}'s headline is not in the README`).toContain(entry.headline)
      expect(readme, `${entry.kind}'s module is not linked`).toContain(`(./${entry.module})`)
      expect(readme, `${entry.kind}'s seam is not named`).toContain(`\`${entry.seam}\``)
    }
  })

  it('prints the guidance the taxonomy declares, word for word', () => {
    for (const entry of TAXONOMY) {
      expect(readme, `${entry.kind}: "reach for it when" has drifted`).toContain(entry.whenToUse)
      expect(readme, `${entry.kind}: "stop when" has drifted`).toContain(entry.whenNotToUse)
    }
  })

  it('heads the detection table with the kinds, in order', () => {
    expect(row('Fault |')).toEqual(['Fault', ...DOUBLE_KINDS])
  })

  it('prints the detection matrix the tests derive', () => {
    for (const fault of FAULTS) {
      const cells = row(`\`${fault.id}\``)
      const expected = DOUBLE_KINDS.map((kind) =>
        DETECTION[fault.id].includes(kind) ? CAUGHT : MISSED,
      )

      expect(cells[0], `${fault.id}'s row does not describe the fault`).toContain(fault.description)
      expect(cells.slice(1), `${fault.id}'s row disagrees with the matrix`).toEqual(expected)
    }
  })
})
