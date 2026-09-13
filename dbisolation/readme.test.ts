// @vitest-environment node
/**
 * The README audit: the claim is well formed and complete, checked without a
 * container.
 *
 * The container suites check that the claim is *true*. This one checks it is a
 * claim at all — every strategy has a column, every fault, behaviour and probe
 * has a row, no cell holds a word outside its vocabulary, and the cost
 * orderings in the document and in `cost.ts` are the same list in the same
 * order. Those are the failures that would otherwise surface as a container
 * suite erroring in a job most contributors cannot run.
 */

import { describe, expect, it } from 'vitest'

import { BEHAVIOUR_KEYS } from './behaviours.ts'
import { COST_ORDERINGS } from './cost.ts'
import { FAULTS } from './faults.ts'
import { PROBE_KEYS } from './leakage.ts'
import {
  bare,
  detectionGrid,
  expectedGrid,
  gridKey,
  leakageGrid,
  readmeText,
  statedOrderings,
  usabilityGrid,
} from './readme.ts'
import { STRATEGY_KEYS } from './strategies.ts'

const GRIDS = [
  { name: 'detection', grid: () => detectionGrid(STRATEGY_KEYS), rows: FAULTS },
  { name: 'usability', grid: () => usabilityGrid(STRATEGY_KEYS), rows: BEHAVIOUR_KEYS },
  { name: 'leakage', grid: () => leakageGrid(STRATEGY_KEYS), rows: PROBE_KEYS },
] as const

describe('README.md', () => {
  it.each(GRIDS)('has a $name grid with a column per strategy', ({ grid }) => {
    expect(grid().columns).toEqual([...STRATEGY_KEYS])
  })

  it.each(GRIDS)('has a $name grid with a row per subject, in order and with no others', ({ grid, rows }) => {
    expect(grid().rows).toEqual([...rows])
  })

  it.each(GRIDS)('leaves no cell of the $name grid blank', ({ grid, rows }) => {
    const parsed = grid()

    for (const row of rows) {
      for (const column of STRATEGY_KEYS) {
        expect(parsed.cells.has(gridKey(row, column)), `${row}/${column}`).toBe(true)
      }
    }
  })

  it('refuses a word outside a grid’s vocabulary', () => {
    const markdown = ['| Probe | `none` |', '| --- | --- |', '| `rows` | leaky |'].join('\n')

    expect(() => expectedGrid('Probe', ['none'], ['pass', 'fail'], markdown)).toThrow(/reads "leaky"/)
  })

  it('says so when a grid is missing rather than returning an empty one', () => {
    expect(() => expectedGrid('Probe', ['none'], ['pass'], '# nothing here')).toThrow(/has no Probe grid/)
  })

  it('stops a grid at the next table’s header, not at the blank line', () => {
    // The blank line is not in `tableRows` at all, so the row after `rows` is
    // the second grid's header. Three grids over the same strategies sit one
    // after another in this document, which is why the terminator is a header
    // shape rather than a blank label.
    const markdown = [
      '| Probe | `none` |',
      '| --- | --- |',
      '| `rows` | pass |',
      '',
      '| Fault | `none` |',
      '| --- | --- |',
      '| `X` | pass |',
    ].join('\n')

    expect(expectedGrid('Probe', ['none'], ['pass', 'fail'], markdown).rows).toEqual(['rows'])
  })

  it('states the cost orderings exactly as cost.ts holds them', () => {
    expect(statedOrderings()).toEqual(COST_ORDERINGS.map(({ cheaper, dearer }) => ({ cheaper, dearer })))
  })

  it('quotes a figure for every strategy in the cost table, plus the baseline', () => {
    const rows = readmeText()
      .split('\n')
      .filter((line) => /^\| `[a-z-]+`[^|]*\| \d/.test(line))
      .map((line) => bare(line.split('|')[1] ?? ''))

    expect(rows).toEqual(['connect-only (baseline)', 'rollback', 'rollback-savepoint', 'none', ...rows.slice(4)])
    expect(rows).toHaveLength(STRATEGY_KEYS.length + 1)
  })

  it('names every strategy somewhere in the prose', () => {
    const text = readmeText()

    for (const strategy of STRATEGY_KEYS) {
      expect(text, strategy).toContain(`\`${strategy}\``)
    }
  })

  it('does not claim the template error depends on the copy strategy', () => {
    // The first draft did, from a plausible inference and a bad probe. The
    // measurement says both strategies raise 55006 on a busy template, and this
    // is the one sentence in the document that would be tempting to restore.
    const text = readmeText().toLowerCase()

    expect(text).toContain('must have no other sessions connected')
    expect(text).not.toMatch(/wal_log[^.]*does not (need|require)/)
  })
})
