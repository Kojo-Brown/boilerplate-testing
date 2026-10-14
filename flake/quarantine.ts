/**
 * Quarantine as data, and the automation that keeps it honest.
 *
 * ---------------------------------------------------------------------------
 * What was here before
 * ---------------------------------------------------------------------------
 * `vitest/flaky.ts` shipped a `quarantine()` helper, `vitest/quarantine.config.ts`
 * a suite to run quarantined tests in, `playwright.config.ts` a `@flaky` title
 * convention with a project to match it, and
 * `workflow-templates/flaky-quarantine.yml` a workflow to run both nightly.
 * None of it had a call site, and three things about it could not have worked:
 * the helper renamed the test it quarantined, the config's reporter wrote no
 * file for the workflow to upload, and the title convention changed the id the
 * history would have been joined on. `README.md` has the measurements.
 *
 * What was missing underneath all of it is the thing quarantine is *for*. A
 * quarantined test is a debt: somebody took a failing test out of the way on
 * the promise of coming back to it. The mechanism everybody builds — a marker
 * at the call site — records the removal and nothing else: not who owns it,
 * not why, not when it stops being acceptable, and above all not whether the
 * test has quietly started passing, which is the one fact that should get it
 * out again.
 *
 * So the registry is a file, not a set of markers in test bodies:
 *
 *   - A test's call site never changes when it is quarantined or released,
 *     so its title and id — the only keys a report offers — stay put and its
 *     history survives the round trip.
 *   - An entry carries an owner, a reason, a ticket and an expiry, and
 *     `pnpm flake:check` fails when any of them is missing or past due. A
 *     quarantine with no expiry is not a quarantine, it is a deletion with
 *     extra steps.
 *   - Every entry is checked against what the test has actually been doing,
 *     and the automation *decides*: a test the history calls `fixed` must come
 *     out, a test it calls `broken` was never flaky and the entry is hiding a
 *     real failure.
 */

import type { Classification, TestHistory } from './history.ts'

/** One quarantined test. */
export interface QuarantineEntry {
  /** Test file, relative to the repository root. */
  readonly module: string
  /** The test's full name, `describe > it`. Never decorated with a tag. */
  readonly name: string
  /** Which runner collects this test, and therefore which list it must appear in. */
  readonly runner: 'vitest' | 'playwright'
  /** Why it is out of the suite. A sentence, for whoever finds it in six weeks. */
  readonly reason: string
  /** Who is going to fix it. */
  readonly owner: string
  /** Where the work is tracked. */
  readonly ticket: string
  /** ISO date the entry was added. */
  readonly addedOn: string
  /** ISO date after which the entry is a failure of this gate. */
  readonly expiresOn: string
}

export interface Registry {
  readonly version: 1
  readonly entries: readonly QuarantineEntry[]
}

/** What the automation says should happen to an entry. */
export type Decision =
  | 'hold'
  | 'release'
  | 'escalate'
  | 'expired'
  | 'orphan'
  | 'unevidenced'

export interface Judgement {
  readonly entry: QuarantineEntry
  readonly decision: Decision
  /** One line, for the gate's output and the dashboard. */
  readonly because: string
  readonly classification: Classification | undefined
}

/** The limits, all of them arguable, all of them in one place. */
export interface QuarantinePolicy {
  /** Longest an entry may be in force, in days. */
  readonly maximumDays: number
  /** Most entries the registry may hold at once. */
  readonly maximumEntries: number
}

export const DEFAULT_QUARANTINE_POLICY: QuarantinePolicy = {
  // Six weeks: long enough to survive a holiday, short enough that the entry
  // is still somebody's problem rather than part of the furniture.
  maximumDays: 42,
  // A suite with eleven quarantined tests does not have a flake problem, it
  // has a trust problem, and the gate should say so rather than let the file
  // grow.
  maximumEntries: 10,
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function isEntry(value: unknown): value is QuarantineEntry {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Record<string, unknown>
  const strings = ['module', 'name', 'reason', 'owner', 'ticket', 'addedOn', 'expiresOn']

  return (
    strings.every((key) => typeof candidate[key] === 'string' && (candidate[key] as string).trim() !== '') &&
    (candidate['runner'] === 'vitest' || candidate['runner'] === 'playwright') &&
    DATE.test(candidate['addedOn'] as string) &&
    DATE.test(candidate['expiresOn'] as string)
  )
}

/**
 * Parse a registry, refusing anything that is not one.
 *
 * Strictly, and this is the one place in the directory where strictness is
 * load-bearing rather than tidy: a malformed entry that parsed as `{}` would
 * quarantine nothing while reading as a quarantine, which is the failure mode
 * where a test is silently back in the suite and nobody is told.
 */
export function parseRegistry(source: string): Registry {
  const payload: unknown = JSON.parse(source)

  if (typeof payload !== 'object' || payload === null) throw new Error('quarantine registry: not an object')

  const candidate = payload as { version?: unknown; entries?: unknown }

  if (candidate.version !== 1) throw new Error('quarantine registry: expected version 1')
  if (!Array.isArray(candidate.entries)) throw new Error('quarantine registry: entries must be an array')

  for (const [index, entry] of candidate.entries.entries()) {
    if (!isEntry(entry)) {
      throw new Error(
        `quarantine registry: entry ${index} is incomplete — module, name, runner, reason, owner, ticket, addedOn and expiresOn are all required`,
      )
    }
  }

  const keys = new Set(candidate.entries.map((entry) => keyOf(entry as QuarantineEntry)))

  if (keys.size !== candidate.entries.length) throw new Error('quarantine registry: duplicate entries')

  return { version: 1, entries: candidate.entries as readonly QuarantineEntry[] }
}

export const keyOf = (entry: { readonly module: string; readonly name: string }): string =>
  `${entry.module}::${entry.name}`

const days = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/**
 * Decide what should happen to one entry.
 *
 * Pure, and given the history rather than asked to go and find it, so that
 * `quarantine.test.ts` can put it in front of histories no run of this
 * repository produces — a quarantined test that has been passing for a month,
 * one that has never passed at all, one that does not exist.
 *
 * The order of the branches is the order of urgency, and `orphan` comes before
 * `expired` on purpose: an entry naming a test that is gone cannot be assessed
 * at all, and telling somebody their entry expired is a worse message than
 * telling them it refers to nothing.
 */
export function decide(
  entry: QuarantineEntry,
  context: {
    readonly history: TestHistory | undefined
    readonly known: ReadonlySet<string>
    readonly today: string
  },
): Judgement {
  const { history, known, today } = context
  const classification = history?.classification

  if (!known.has(keyOf(entry))) {
    return {
      entry,
      decision: 'orphan',
      because: `no test named "${entry.name}" is collected from ${entry.module} — remove the entry or fix the name`,
      classification,
    }
  }

  if (days(entry.expiresOn, today) > 0) {
    return {
      entry,
      decision: 'expired',
      because: `expired on ${entry.expiresOn} (${String(days(entry.expiresOn, today))} days ago) — fix the test or renew the entry with a reason`,
      classification,
    }
  }

  if (history === undefined || history.attempts === 0) {
    return {
      entry,
      decision: 'unevidenced',
      because: 'no attempts recorded — nothing has measured this test flaking, so the entry is an assertion rather than a finding',
      classification,
    }
  }

  if (classification === 'fixed' || classification === 'stable') {
    return {
      entry,
      decision: 'release',
      because: `${String(history.passStreak)} consecutive passing attempts — take it out of quarantine`,
      classification,
    }
  }

  if (classification === 'broken') {
    return {
      entry,
      decision: 'escalate',
      because: `fails every attempt (${String(history.failures)}/${String(history.attempts)}) — this is not a flake and quarantine is hiding it`,
      classification,
    }
  }

  return {
    entry,
    decision: 'hold',
    because: `flaky in ${String(history.flakyRuns)} of ${String(history.runs)} runs, expires ${entry.expiresOn}`,
    classification,
  }
}

/** Everything wrong with a registry, as sentences. */
export function audit(
  registry: Registry,
  context: {
    readonly histories: readonly TestHistory[]
    readonly known: ReadonlySet<string>
    readonly today: string
    readonly policy?: QuarantinePolicy
  },
): { readonly judgements: readonly Judgement[]; readonly violations: readonly string[] } {
  const policy = context.policy ?? DEFAULT_QUARANTINE_POLICY
  const byKey = new Map(context.histories.map((history) => [keyOf(history), history]))

  const judgements = registry.entries.map((entry) =>
    decide(entry, { history: byKey.get(keyOf(entry)), known: context.known, today: context.today }),
  )

  const violations: string[] = []

  if (registry.entries.length > policy.maximumEntries) {
    violations.push(
      `${String(registry.entries.length)} entries, limit ${String(policy.maximumEntries)}: a quarantine this size is a suite nobody trusts`,
    )
  }

  for (const entry of registry.entries) {
    const window = days(entry.addedOn, entry.expiresOn)

    if (window <= 0) {
      violations.push(`${keyOf(entry)}: expiresOn (${entry.expiresOn}) is not after addedOn (${entry.addedOn})`)
    } else if (window > policy.maximumDays) {
      violations.push(
        `${keyOf(entry)}: in force for ${String(window)} days, limit ${String(policy.maximumDays)}`,
      )
    }
  }

  for (const judgement of judgements) {
    if (judgement.decision !== 'hold') {
      violations.push(`${keyOf(judgement.entry)}: ${judgement.decision} — ${judgement.because}`)
    }
  }

  return { judgements, violations }
}

/**
 * Is this test quarantined?
 *
 * The one function the runtime helpers need. Keyed on module and name, and
 * deliberately *not* on a tag or a decorated title: releasing a test is
 * deleting a line from a JSON file, and nothing at the call site moves.
 */
export function isQuarantined(registry: Registry, module: string, name: string): boolean {
  const key = `${module}::${name}`

  return registry.entries.some((entry) => keyOf(entry) === key)
}
