/**
 * Rebuild `corpus.ts` by actually running the campaigns.
 *
 *     pnpm fuzz:record
 *
 * The recorded corpus is what makes this directory affordable in `pnpm test`.
 * A campaign is a search — two thousand inputs per probe per variant, and a
 * minimisation search on top of every hit — and paying for the search on every
 * commit to learn a result that has not changed since the last commit is how a
 * gate acquires `continue-on-error: true`. So the search runs here, by hand,
 * and what it finds is committed: one minimal input per (fault, probe), which
 * `corpus.test.ts` replays in milliseconds.
 *
 * That trade is the practical shape of fuzzing in CI, and it is worth being
 * explicit that the two halves catch different things. The replay is a
 * regression gate — these sixteen faults stay caught. `detection.test.ts` is
 * the audit that the regression gate is still telling the truth: it re-runs
 * the campaigns for real and fails if the live matrix and the committed corpus
 * disagree, so a corpus that has quietly stopped being reachable by the
 * campaign that produced it cannot sit there looking green.
 *
 * Rerun this when `config.ts`, `edits.ts`, `generators.ts`, `oracles.ts` or
 * `settings.ts` changes. `detection.test.ts` is what tells you that you had to.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { probeOnce, runProbe, PROBE_IDS, type ProbeId } from './campaign.ts'
import { VARIANTS, type VariantId } from './edits.ts'
import { GENERATOR_IDS, type GeneratorId } from './generators.ts'
import { loadControl, loadVariant } from './load.ts'
import { minimise } from './minimise.ts'
import type { OracleId } from './oracles.ts'

/**
 * The four faults the generator comparison is run over.
 *
 * Four rather than sixteen because the point is qualitative and a campaign per
 * (fault, generator) pair is not free. Each one is here because it separates
 * the generators differently: a lexer fault only byte-level edits reach, a
 * structural fault only a schema-aware generator emits, a crash only deep
 * nesting provokes, and a validator fault two of the three reach. The oracle
 * is fixed per row so the row measures generators and nothing else.
 */
const CROSSOVER_CASES: readonly { variant: VariantId; probe: ProbeId }[] = [
  { variant: 'CONTROL_CHARACTER_ACCEPTED', probe: 'differential' },
  { variant: 'PROTOTYPE_POLLUTION', probe: 'differential' },
  { variant: 'NO_DEPTH_LIMIT', probe: 'crash' },
  { variant: 'UNKNOWN_KEY_IGNORED', probe: 'invariant' },
]

interface Crossover {
  variant: VariantId
  probe: ProbeId
  foundBy: GeneratorId[]
}

interface Detection {
  variant: VariantId
  probe: ProbeId
  reason: string
  inputsTried: number
  witness: string
  foundLength: number
  minimisedLength: number
  evaluations: number
}

const OUTPUT_PATH = fileURLToPath(new URL('./corpus.ts', import.meta.url))

async function record(): Promise<void> {
  const control = await loadControl()

  for (const probe of PROBE_IDS) {
    const result = runProbe(control, probe)

    if (result.finding !== null) {
      throw new Error(
        `the control is not clean: ${probe} reported ${result.finding.reason} — ${result.finding.detail}`,
      )
    }
  }

  const detections: Detection[] = []

  for (const variant of VARIANTS) {
    const subject = await loadVariant(variant.id)

    for (const probe of PROBE_IDS) {
      const result = runProbe(subject, probe)

      if (result.finding === null) {
        continue
      }

      const { input, reason } = result.finding

      if (probe === 'examples') {
        detections.push({
          variant: variant.id,
          probe,
          reason,
          inputsTried: result.inputsTried,
          witness: '',
          foundLength: 0,
          minimisedLength: 0,
          evaluations: 0,
        })

        continue
      }

      // A crash witness is recorded exactly as it was found, and this is the
      // one place the pipeline deliberately declines to minimise.
      //
      // The minimal input that overflows a stack is a fact about the stack:
      // ddmin drives it to the precise depth at which *this* runtime, on
      // *this* machine, with *this* frame size, runs out — 4,188 brackets
      // here — and a witness sitting exactly on that boundary is a witness
      // that stops reproducing on a runner with a slightly larger stack, or
      // after an optimisation shrinks a frame. It would fail in the most
      // expensive way available: green on the machine that recorded it, red
      // in CI, for a reason that looks nothing like the bug.
      //
      // So a crash keeps its margin. The cost is a 60,000-character witness,
      // and `render` writes it as `'['.repeat(30000)` rather than sixty
      // thousand literal brackets.
      if (reason === 'SUBJECT_THREW' || reason === 'THREW') {
        detections.push({
          variant: variant.id,
          probe,
          reason,
          inputsTried: result.inputsTried,
          witness: input,
          foundLength: input.length,
          minimisedLength: input.length,
          evaluations: 0,
        })

        continue
      }

      // The predicate holds the *reason* fixed, not merely "something is
      // wrong". Reducing towards any failure walks straight to the empty
      // string, which fails every probe here for the least interesting reason
      // available.
      const reduced = minimise(
        input,
        (candidate) => probeOnce(subject, probe as OracleId, candidate)?.reason === reason,
      )

      detections.push({
        variant: variant.id,
        probe,
        reason,
        inputsTried: result.inputsTried,
        witness: reduced.input,
        foundLength: input.length,
        minimisedLength: reduced.input.length,
        evaluations: reduced.evaluations,
      })
    }
  }

  const crossover: Crossover[] = []

  for (const each of CROSSOVER_CASES) {
    const subject = await loadVariant(each.variant)

    crossover.push({
      variant: each.variant,
      probe: each.probe,
      foundBy: GENERATOR_IDS.filter(
        (generator) => runProbe(subject, each.probe, { generator }).finding !== null,
      ),
    })
  }

  writeFileSync(OUTPUT_PATH, render(detections, crossover))

  const found = new Set(detections.map((detection) => detection.variant))

  process.stdout.write(
    `recorded ${detections.length} detections over ${found.size}/${VARIANTS.length} faults\n`,
  )

  process.stdout.write(`crossover over ${crossover.length} faults:\n`)

  for (const row of crossover) {
    process.stdout.write(`  ${row.variant.padEnd(34)} ${row.probe.padEnd(13)} ${row.foundBy.join(', ')}\n`)
  }

  for (const variant of VARIANTS) {
    const probes = detections
      .filter((detection) => detection.variant === variant.id)
      .map((detection) => detection.probe)

    process.stdout.write(`  ${variant.id.padEnd(34)} ${probes.join(', ') || '— nothing found it'}\n`)
  }
}

/**
 * A witness as source code.
 *
 * Long witnesses here are runs of one character — 30,000 brackets and 30,000
 * more — and writing them out literally would make `corpus.ts` a 60KB line
 * nobody can review. Run-length form is exact, diffs legibly, and says what
 * the input *is* in a way the literal never could.
 */
function renderWitness(witness: string): string {
  if (witness.length <= 120) {
    return JSON.stringify(witness)
  }

  const runs: { character: string; length: number }[] = []

  for (const character of witness) {
    const last = runs[runs.length - 1]

    if (last !== undefined && last.character === character) {
      last.length += 1
    } else {
      runs.push({ character, length: 1 })
    }
  }

  if (runs.length > 8) {
    return JSON.stringify(witness)
  }

  return runs
    .map((run) => `${JSON.stringify(run.character)}.repeat(${run.length})`)
    .join(' + ')
}

function render(detections: readonly Detection[], crossover: readonly Crossover[]): string {
  const rows = detections
    .map(
      (detection) => `  {
    variant: ${JSON.stringify(detection.variant)},
    probe: ${JSON.stringify(detection.probe)},
    reason: ${JSON.stringify(detection.reason)},
    inputsTried: ${detection.inputsTried},
    witness: ${renderWitness(detection.witness)},
    foundLength: ${detection.foundLength},
    minimisedLength: ${detection.minimisedLength},
    evaluations: ${detection.evaluations},
  },`,
    )
    .join('\n')

  return `${HEADER}
export const DETECTIONS: readonly Detection[] = [
${rows}
]

/** Which probes noticed a given fault at all. */
export function probesThatFound(variant: VariantId): readonly ProbeId[] {
  return DETECTIONS.filter((detection) => detection.variant === variant).map(
    (detection) => detection.probe,
  )
}

/** The faults a given probe noticed. */
export function faultsFoundBy(probe: ProbeId): readonly VariantId[] {
  return DETECTIONS.filter((detection) => detection.probe === probe).map(
    (detection) => detection.variant,
  )
}

/** Every fault at least one probe noticed. */
export function faultsFound(): readonly VariantId[] {
  return VARIANT_IDS.filter((id) => DETECTIONS.some((detection) => detection.variant === id))
}

export const CROSSOVER: readonly Crossover[] = [
${crossover
  .map(
    (row) => `  {
    variant: ${JSON.stringify(row.variant)},
    probe: ${JSON.stringify(row.probe)},
    foundBy: [${row.foundBy.map((id) => JSON.stringify(id)).join(', ')}],
  },`,
  )
  .join('\n')}
]
`
}

const HEADER = `/**
 * The recorded result of running every probe against every fault.
 *
 * GENERATED BY \`pnpm fuzz:record\` — edit \`record.ts\`, not this file.
 *
 * One row per (fault, probe) pair that found something, carrying the minimal
 * input that reproduces it. Two suites read this file and they read it for
 * opposite reasons:
 *
 *   - \`corpus.test.ts\` replays every witness against the fault it was found
 *     on. That is the regression gate, and it is milliseconds rather than the
 *     minutes a real campaign costs.
 *   - \`detection.test.ts\` re-runs the campaigns and fails if the live matrix
 *     disagrees with the rows below. That is what stops this file becoming a
 *     screenshot of a result that used to be true.
 *
 * \`inputsTried\` is how many inputs the campaign consumed before the probe
 * noticed anything; \`foundLength\` and \`minimisedLength\` are the witness
 * before and after \`minimise.ts\`, and \`evaluations\` is what that search cost
 * in predicate calls. The ratio between the first two is the number worth
 * looking at: it is why a fuzzer's raw output is unreadable and why nobody
 * should file one.
 */

import type { ProbeId } from './campaign.ts'
import { VARIANT_IDS, type VariantId } from './edits.ts'
import type { GeneratorId } from './generators.ts'

export /**
 * The four faults the generator comparison is run over.
 *
 * Four rather than sixteen because the point is qualitative and a campaign per
 * (fault, generator) pair is not free. Each one is here because it separates
 * the generators differently: a lexer fault only byte-level edits reach, a
 * structural fault only a schema-aware generator emits, a crash only deep
 * nesting provokes, and a validator fault two of the three reach. The oracle
 * is fixed per row so the row measures generators and nothing else.
 */
const CROSSOVER_CASES: readonly { variant: VariantId; probe: ProbeId }[] = [
  { variant: 'CONTROL_CHARACTER_ACCEPTED', probe: 'differential' },
  { variant: 'PROTOTYPE_POLLUTION', probe: 'differential' },
  { variant: 'NO_DEPTH_LIMIT', probe: 'crash' },
  { variant: 'UNKNOWN_KEY_IGNORED', probe: 'invariant' },
]

interface Crossover {
  variant: VariantId
  probe: ProbeId
  foundBy: GeneratorId[]
}

interface Detection {
  readonly variant: VariantId
  readonly probe: ProbeId
  /** Which check fired. \`SUBJECT_THREW\` means the subject never returned. */
  readonly reason: string
  readonly inputsTried: number
  /** The minimal input that reproduces it. Empty for \`examples\`, which generates none. */
  readonly witness: string
  readonly foundLength: number
  readonly minimisedLength: number
  readonly evaluations: number
}
`

await record()
