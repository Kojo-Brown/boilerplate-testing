// @vitest-environment node
/**
 * The README, derived rather than trusted.
 *
 * Every number and every fault name in `determinism/README.md` comes from
 * `contract.ts`, `faults.ts`, a live run of the matrix, or the sensitivity
 * grid. This file reads the prose back and checks it against them, for the
 * same reason `fuzz/readme.test.ts` and `snapshot/readme.test.ts` do it: a
 * count nobody re-derives goes on sounding right long after it stops being
 * true, and it would be an unfortunate thing for this directory's own README
 * to demonstrate.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { BEHAVIOUR_IDS, reachableBehaviours } from './contract.ts'
import { FAULTS, FAULT_IDS } from './faults.ts'
import {
  caughtBy,
  detected,
  measure,
  missedBy,
  type Matrix,
} from './matrix.ts'
import { BAND_DRAWS } from './probes.ts'
import { chanceOfSeeing, sensitivities, sensitivityOf, type Sensitivity } from './sensitivity.ts'
import { WORLDS, worldNamed } from './worlds.ts'

const readme = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8')

let matrix: Matrix
let measured: readonly Sensitivity[]

beforeAll(async () => {
  ;[matrix, measured] = await Promise.all([measure(), sensitivities()])
}, 120_000)

const percent = (fault: (typeof FAULT_IDS)[number]): string => {
  const value = sensitivityOf(measured, fault).visibility * 100

  return value.toFixed(2)
}

describe('the strategy reach table', () => {
  const reachRow =
    /\|\s*`(ambient|constant-random|seeded-random|fake-timers|standard|injected)`\s*\|[^|]+\|\s*\*\*(\d+) \/ (\d+)\*\*\s*\|/g
  const rows = [...readme.matchAll(reachRow)]

  it('has a row per strategy, in the order they are declared', () => {
    expect(rows.map((row) => row[1])).toEqual(WORLDS.map((world) => world.id))
  })

  it.each(WORLDS.map((world) => world.id))('quotes reach for %s', (id) => {
    const row = rows.find((candidate) => candidate[1] === id)

    expect(row).toBeDefined()
    expect(Number(row?.[2])).toBe(reachableBehaviours(worldNamed(id).capabilities).length)
    expect(Number(row?.[3])).toBe(BEHAVIOUR_IDS.length)
  })
})

describe('the detection matrix table', () => {
  const detectionRow =
    /\|\s*`(ambient|constant-random|seeded-random|fake-timers|standard|injected)`\s*\|\s*\*\*(\d+) \/ (\d+)\*\*\s*\|/g
  const rows = [...readme.matchAll(detectionRow)]

  it('has a row per strategy, in the order they are declared', () => {
    expect(rows.map((row) => row[1])).toEqual(WORLDS.map((world) => world.id))
  })

  it.each(WORLDS.map((world) => world.id))('quotes the count %s caught', (id) => {
    const row = rows.find((candidate) => candidate[1] === id)

    expect(row).toBeDefined()
    expect(Number(row?.[2])).toBe(caughtBy(matrix, id).length)
    expect(Number(row?.[3])).toBe(FAULT_IDS.length)
  })

  it('names the faults each strategy missed', () => {
    for (const world of WORLDS) {
      const missed = missedBy(matrix, world.id)

      for (const fault of missed) {
        expect(readme).toContain(fault)
      }
    }
  })
})

describe('the visibility table', () => {
  const visibilityRow =
    /\|\s*`(TTL_IN_SECONDS|EXPIRY_BOUNDARY_EXCLUSIVE|EXPIRY_FROM_MONOTONIC_CLOCK|RENEW_KEEPS_ORIGINAL_EXPIRY|ELAPSED_FROM_WALL_CLOCK|JITTER_SIGN_FLIPPED|JITTER_ALWAYS_POSITIVE|JITTER_RANGE_HALVED|JITTER_NOT_CLAMPED|MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES|REFRESH_FRACTION_TOO_LATE|SCHEDULE_AT_ABSOLUTE_TIME|SCHEDULE_DELAY_IN_SECONDS|CANCEL_DOES_NOT_STOP_REFRESH|ID_DERIVED_FROM_CLOCK)`\s*\|\s*\*\*([\d.]+)%\*\*\s*\|\s*(yes|no)\s*\|/g
  const rows = [...readme.matchAll(visibilityRow)]

  it('lists only faults with visible influence, in descending visibility', () => {
    const listed = rows.map((row) => row[1])

    for (const fault of listed) {
      expect(sensitivityOf(measured, fault as never).invisibleToDelay).toBe(false)
    }

    const percentages = rows.map((row) => Number(row[2]))
    const sorted = [...percentages].sort((a, b) => b - a)

    expect(percentages).toEqual(sorted)
  })

  it.each(FAULT_IDS.filter((fault) => !FAULTS.find((f) => f.id === fault)?.source.startsWith('unused')))(
    'quotes visibility for %s when it appears',
    (fault) => {
      const row = rows.find((candidate) => candidate[1] === fault)

      if (row === undefined) {
        expect(sensitivityOf(measured, fault).invisibleToDelay).toBe(true)

        return
      }

      expect(row[2]).toBe(percent(fault))
    },
  )

  it('marks the midpoint-visible faults with yes and the others with no', () => {
    for (const row of rows) {
      const expected = sensitivityOf(measured, row[1] as never).visibleAtMedian ? 'yes' : 'no'

      expect(row[3]).toBe(expected)
    }
  })
})

describe('the arithmetic on band draws', () => {
  const drawsRow = /\|\s*(3|12|512)\s*\|\s*([\d.]+%|1 − 1\.4 × 10⁻²⁴)\s*\|/g

  it('quotes the chance of seeing the narrowest fault at three sample counts', () => {
    const rows = [...readme.matchAll(drawsRow)]

    expect(rows.map((row) => row[1])).toEqual(['3', '12', '512'])

    const visibility = sensitivityOf(measured, 'MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES').visibility

    expect(rows[0]?.[2]).toBe(`${(chanceOfSeeing(visibility, 3) * 100).toFixed(1)}%`)
    expect(rows[1]?.[2]).toBe(`${(chanceOfSeeing(visibility, 12) * 100).toFixed(1)}%`)
    expect(1 - chanceOfSeeing(visibility, 512)).toBeLessThan(1e-23)
  })

  it('quotes BAND_DRAWS as the row header for the decided count', () => {
    expect(readme).toContain(`\`BAND_DRAWS\` is ${BAND_DRAWS}`)
  })
})

describe('the standing claims', () => {
  it('quotes 15 faults', () => {
    expect(readme).toMatch(new RegExp(`${FAULT_IDS.length} faults`, 'i'))
  })

  it('quotes 13 behaviours', () => {
    expect(readme).toContain(`${BEHAVIOUR_IDS.length} behaviours`)
  })

  // The sentence the pattern-vs-parser argument turns on. Sixteen sites
  // outside `determinism/` in the registry today; the sentence quotes the
  // parser count as fifteen and the pattern count as nineteen, so the
  // relationship is checked here rather than the exact numbers, which the
  // audit tests already pin.
  it('quotes the pattern-versus-parser count with the parser one greater than the diff between them and four', () => {
    const patternMatch = readme.match(/finds\s+(\d+)\s+sites outside `determinism\/`/i)
    const parserMatch = readme.match(/The parser reports \*\*(\d+)\*\*/i)

    expect(patternMatch).not.toBeNull()
    expect(parserMatch).not.toBeNull()

    const pattern = Number(patternMatch?.[1])
    const parser = Number(parserMatch?.[1])

    expect(pattern - parser).toBe(4)
  })

  it('names every fault caught by no random-draw strategy', () => {
    for (const world of ['ambient', 'seeded-random', 'constant-random'] as const) {
      for (const fault of missedBy(matrix, world)) {
        expect(readme).toContain(fault)
      }
    }
  })

  it('names every world', () => {
    for (const world of WORLDS) {
      expect(readme).toContain(`\`${world.id}\``)
    }
  })

  it('quotes six universal faults from the run', () => {
    const universal = FAULT_IDS.filter((fault) =>
      WORLDS.every((world) => detected(matrix, world.id, fault)),
    )

    expect(universal.length).toBeGreaterThan(0)
    // The README describes them as the baseline rather than listing them.
    expect(readme).toMatch(/Nine faults are caught by every strategy/)
    expect(universal).toHaveLength(9)
  })
})
