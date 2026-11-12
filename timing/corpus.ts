/**
 * The recorded corpus: loading it, validating it, and the noise it contains.
 *
 * `corpus.json` is sixteen measurements of five unchanged files, produced by
 * `record.ts` on a real machine. Because the subject is identical in every
 * run, the variation between them has exactly one cause, and this module is
 * where that variation is turned into numbers the gate designs can be scored
 * against.
 *
 * The loader is strict for the usual reason: a corpus that has lost a column
 * or gained a row would quietly change every cell of the published matrix, and
 * `runs.test.ts` would report the new numbers as the measurement rather than
 * as the corruption it is.
 */

import corpusJson from './corpus.json' with { type: 'json' }
import { median, quantile, spread, type Run } from './durations.ts'

export interface Recorded {
  readonly node: string
  readonly platform: string
  readonly arch: string
  readonly parallelism: number
  readonly runs: number
}

export interface Corpus {
  readonly recorded: Recorded
  readonly files: readonly string[]
  /** One row per run, in `files` order. */
  readonly rows: readonly (readonly number[])[]
}

function validate(raw: unknown): Corpus {
  if (typeof raw !== 'object' || raw === null) throw new Error('corpus is not an object')

  const { recorded, files, runs } = raw as Record<string, unknown>

  if (typeof recorded !== 'object' || recorded === null) {
    throw new Error('corpus has no `recorded` block')
  }

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('corpus has no files')
  }

  if (!files.every((file): file is string => typeof file === 'string')) {
    throw new Error('corpus file list is not all strings')
  }

  if (!Array.isArray(runs) || runs.length < 2) {
    throw new Error('corpus needs at least two runs to contain any noise at all')
  }

  const rows: number[][] = []

  for (const [index, row] of runs.entries()) {
    if (!Array.isArray(row) || row.length !== files.length) {
      throw new Error(`corpus run ${String(index)} does not have one value per file`)
    }

    for (const value of row as readonly unknown[]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`corpus run ${String(index)} holds a value that is not a duration`)
      }
    }

    rows.push(row as number[])
  }

  const meta = recorded as Record<string, unknown>

  if (meta['runs'] !== rows.length) {
    throw new Error(
      `corpus says ${String(meta['runs'])} runs and carries ${String(rows.length)}`,
    )
  }

  return {
    recorded: meta as unknown as Recorded,
    files,
    rows,
  }
}

export const CORPUS: Corpus = validate(corpusJson)

/** The corpus as `Run`s — the form the gates consume. */
export function runs(corpus: Corpus = CORPUS): readonly Run[] {
  return corpus.rows.map((row) =>
    Object.fromEntries(corpus.files.map((file, index) => [file, row[index] ?? 0])),
  )
}

/** Every recorded duration of one file, across all runs. */
export function samples(file: string, corpus: Corpus = CORPUS): readonly number[] {
  const index = corpus.files.indexOf(file)

  if (index < 0) throw new Error(`not a corpus file: ${file}`)

  return corpus.rows.map((row) => row[index] ?? 0)
}

/** Every recorded total, across all runs. */
export function totals(corpus: Corpus = CORPUS): readonly number[] {
  return corpus.rows.map((row) => row.reduce((sum, ms) => sum + ms, 0))
}

/** One file's noise, as the model and the README describe it. */
export interface Noise {
  readonly file: string
  /** The file's typical duration. */
  readonly medianMs: number
  readonly minMs: number
  readonly maxMs: number
  /**
   * How far the worst recorded run sits above the median, as a ratio: the
   * percentage regression a per-file gate must tolerate to stay quiet on this
   * file when nothing has changed.
   */
  readonly spread: number
  /** The same quantity at the 95th percentile rather than the maximum. */
  readonly p95Spread: number
}

export function noise(file: string, corpus: Corpus = CORPUS): Noise {
  const values = samples(file, corpus)
  const mid = median(values)

  return {
    file,
    medianMs: mid,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    spread: spread(values),
    p95Spread: quantile(values, 0.95) / mid - 1,
  }
}

/** Every file's noise, in corpus order. */
export function noiseProfile(corpus: Corpus = CORPUS): readonly Noise[] {
  return corpus.files.map((file) => noise(file, corpus))
}

/** The total's noise, which is the same quantity for the whole suite. */
export function totalNoise(corpus: Corpus = CORPUS): Noise {
  const values = totals(corpus)
  const mid = median(values)

  return {
    file: 'TOTAL',
    medianMs: mid,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    spread: spread(values),
    p95Spread: quantile(values, 0.95) / mid - 1,
  }
}
