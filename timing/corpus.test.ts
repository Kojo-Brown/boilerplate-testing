// @vitest-environment node
//
// The corpus is evidence, so this suite is mostly about refusing a corrupted
// one. A corpus that had lost a column or gained a row would change every cell
// of the published matrix, and `runs.test.ts` would report the new numbers as
// the measurement rather than as the damage.

import { describe, expect, it } from 'vitest'

import { CORPUS, noise, noiseProfile, runs, samples, totalNoise, totals } from './corpus.ts'
import { median } from './durations.ts'

describe('the recorded corpus', () => {
  it('holds one row per run and one column per file', () => {
    expect(CORPUS.rows).toHaveLength(CORPUS.recorded.runs)

    for (const row of CORPUS.rows) {
      expect(row).toHaveLength(CORPUS.files.length)
    }
  })

  it('was recorded over enough runs for a median to mean anything', () => {
    expect(CORPUS.recorded.runs).toBeGreaterThanOrEqual(16)
  })

  it('names the machine it was recorded on, so a reader can discount it', () => {
    expect(CORPUS.recorded.node).toMatch(/^v\d+\./)
    expect(CORPUS.recorded.platform).not.toBe('')
    expect(CORPUS.recorded.parallelism).toBeGreaterThan(0)
  })

  it('measured the same five fixture files in every run', () => {
    expect(CORPUS.files).toEqual([
      'fixture/large.test.ts',
      'fixture/medium.test.ts',
      'fixture/small.test.ts',
      'fixture/tiny.test.ts',
      'fixture/uneven.test.ts',
    ])
  })

  it('spans three orders of magnitude, which is what makes the spread visible', () => {
    const medians = CORPUS.files.map((file) => median(samples(file)))

    expect(Math.max(...medians) / Math.min(...medians)).toBeGreaterThan(100)
  })
})

describe('reading the corpus', () => {
  it('presents each row as a run keyed by file', () => {
    const [first] = runs()

    expect(first).toBeDefined()
    expect(Object.keys(first ?? {}).sort()).toEqual([...CORPUS.files])
  })

  it('gives one file every duration recorded for it', () => {
    expect(samples('fixture/tiny.test.ts')).toHaveLength(CORPUS.recorded.runs)
  })

  it('refuses a file the corpus never measured', () => {
    expect(() => samples('fixture/nope.test.ts')).toThrow(/not a corpus file/)
  })

  it('gives one total per run', () => {
    expect(totals()).toHaveLength(CORPUS.recorded.runs)
  })
})

describe('the noise profile', () => {
  it('bounds every file between the runs that measured it', () => {
    for (const entry of noiseProfile()) {
      expect(entry.minMs).toBeLessThanOrEqual(entry.medianMs)
      expect(entry.medianMs).toBeLessThanOrEqual(entry.maxMs)
      expect(entry.spread).toBeGreaterThanOrEqual(0)
    }
  })

  // The headline measurement, asserted on the recorded numbers rather than
  // described: the 1ms file's worst run is more than twice its median, and the
  // 242ms file's is within a few per cent of it. Nothing in either file
  // changed between runs.
  it('reports the shortest file as more than twice its median at worst', () => {
    expect(noise('fixture/tiny.test.ts').spread).toBeGreaterThan(1)
  })

  it('reports the longest file as within 5% of its median at worst', () => {
    expect(noise('fixture/large.test.ts').spread).toBeLessThan(0.05)
  })

  it('reports the suite total as quieter than any short file in it', () => {
    expect(totalNoise().spread).toBeLessThan(noise('fixture/small.test.ts').spread)
  })

  it('covers every file in the corpus', () => {
    expect(noiseProfile().map((entry) => entry.file)).toEqual([...CORPUS.files])
  })
})
