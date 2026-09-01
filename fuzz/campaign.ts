/**
 * The loop: inputs in, the first finding out.
 *
 * ---------------------------------------------------------------------------
 * Why a campaign stops at its first finding
 * ---------------------------------------------------------------------------
 * The matrix in `detection.test.ts` asks one question per cell — *would this
 * probe have noticed this fault* — and the second, third and four-hundredth
 * time an already-condemned subject fails tells nobody anything while costing
 * the same as the first. `property/probes.ts` stops for the same reason and
 * `mutation/` calls it bail.
 *
 * ---------------------------------------------------------------------------
 * Why an exception from the subject is a finding for every probe
 * ---------------------------------------------------------------------------
 * A crash is not an oracle's verdict. It is the *absence* of a verdict: the
 * subject never returned, so nothing was compared, and whichever probe
 * happened to be running is the one that reports it. That is why `SUBJECT_THREW`
 * can appear in any row and not only in `crash`'s, and it is worth stating
 * plainly because it deflates the technique's most-quoted result. "We fuzzed
 * it and it never crashed" is a claim about the language, not about the
 * program: in a memory-safe runtime almost nothing crashes, and every fault in
 * `edits.ts` except one returns a wrong answer perfectly politely.
 *
 * The one probe that can miss a crash is `differential`, and it misses this
 * one for an interesting reason rather than a boring one — its list of
 * declared divergences tells it not to look at deep input at all, so it
 * excuses the very documents that expose the missing depth guard. An excuse
 * list is a hole with a comment above it.
 *
 * A harness bug would land in the same bucket, which is what the control
 * campaign is for: `config.ts` compiled with no edits must produce zero
 * findings under all five probes, and if the harness is throwing, the control
 * is the first thing to go red.
 */

import { firstExampleFailure } from './examples.ts'
import { inputStream, type GeneratorId } from './generators.ts'
import type { Subject } from './load.ts'
import { oracleNamed, ORACLE_IDS, type Finding, type OracleId } from './oracles.ts'
import { CAMPAIGN_BUDGET, SEED } from './settings.ts'

/** Every way this directory puts a subject under test. */
export const PROBE_IDS = [...ORACLE_IDS, 'examples'] as const

export type ProbeId = (typeof PROBE_IDS)[number]

export interface CampaignOptions {
  readonly seed?: number
  readonly budget?: number
  readonly generator?: GeneratorId
}

export interface CampaignResult {
  readonly probe: ProbeId
  /** How many inputs were tried, including the one that found something. */
  readonly inputsTried: number
  readonly finding: (Finding & { readonly input: string }) | null
}

/**
 * One input, one oracle, with a thrown subject turned into a finding.
 *
 * The single place that decision is made, so that a campaign, the minimiser's
 * predicate and the corpus replay all agree about what a crash counts as. They
 * have to: a minimiser that reduces towards a different notion of failure than
 * the campaign that found the input produces a witness that does not reproduce.
 */
export function probeOnce(subject: Subject, probe: OracleId, input: string): Finding | null {
  try {
    return oracleNamed(probe).check(subject, input)
  } catch (error) {
    return {
      reason: 'SUBJECT_THREW',
      detail:
        error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 120) : String(error),
    }
  }
}

/**
 * Run one probe against one subject until it finds something or runs out.
 *
 * `examples` ignores the generator and the budget: it is a fixed list, it
 * takes one pass, and treating it as a campaign of twenty-six inputs would be
 * a category error dressed up as symmetry.
 */
export function runProbe(
  subject: Subject,
  probe: ProbeId,
  options: CampaignOptions = {},
): CampaignResult {
  if (probe === 'examples') {
    return runExamples(subject)
  }

  const generator = options.generator ?? 'mixed'
  const seed = options.seed ?? SEED
  const budget = options.budget ?? CAMPAIGN_BUDGET

  let inputsTried = 0

  for (const input of inputStream(generator, seed, budget)) {
    inputsTried += 1

    const finding = probeOnce(subject, probe, input)

    if (finding !== null) {
      return { probe, inputsTried, finding: { ...finding, input } }
    }
  }

  return { probe, inputsTried, finding: null }
}

function runExamples(subject: Subject): CampaignResult {
  let failure: { title: string; detail: string } | null

  try {
    failure = firstExampleFailure(subject)
  } catch (error) {
    return {
      probe: 'examples',
      inputsTried: 1,
      finding: {
        reason: 'SUBJECT_THREW',
        detail: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 120) : String(error),
        input: '',
      },
    }
  }

  if (failure === null) {
    return { probe: 'examples', inputsTried: 1, finding: null }
  }

  return {
    probe: 'examples',
    inputsTried: 1,
    finding: { reason: 'EXAMPLE_FAILED', detail: `${failure.title}: ${failure.detail}`, input: '' },
  }
}
