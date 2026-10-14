/**
 * The attempt ledger: the subject's own record of what it was asked to do.
 *
 * Every probe in `../probes.ts` asks what a *runner's* artifact knows about a
 * rerun. None of them can be answered without a second, independent account of
 * what actually happened — otherwise a wiring that records nothing is
 * indistinguishable from a wiring whose test never ran. The subject therefore
 * files one line per attempt here, in the directory `FLAKE_LEDGER` names, and
 * `../runs.ts` reads this back alongside the runner's report and compares them.
 *
 * Append-only JSON Lines, one `open`/`write`/`close` per line: a Playwright
 * run has several worker processes writing into the same file at once, and a
 * single `appendFileSync` of a line under the pipe buffer is the only write
 * that is atomic across them.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One attempt, as the subject files it. */
export interface AttemptRecord {
  /** The case id from the plan — the subject's test title. */
  readonly id: string
  /** 1-based, counted over the lifetime of the ledger directory. */
  readonly attempt: number
  readonly outcome: 'passed' | 'failed'
}

const LEDGER_FILE = 'attempts.jsonl'

function ledgerDir(): string {
  const dir = process.env['FLAKE_LEDGER']

  if (dir === undefined || dir === '') {
    throw new Error('flake subject: FLAKE_LEDGER is unset. The subject is never run on its own.')
  }

  mkdirSync(dir, { recursive: true })

  return dir
}

/**
 * Claim the next attempt number for `id`.
 *
 * The counter is one file per case rather than a count of the lines already in
 * the ledger: reading the ledger would make the number depend on writes made by
 * other workers for other cases, and `readFileSync`-then-`writeFileSync` on a
 * file only this case touches is as close to a compare-and-set as two
 * concurrent attempts at the same case ever need — Vitest and Playwright both
 * serialise the attempts of one test.
 */
export function claimAttempt(id: string): number {
  const dir = ledgerDir()
  const counter = join(dir, `${encodeURIComponent(id)}.attempt`)
  const previous = existsSync(counter) ? Number.parseInt(readFileSync(counter, 'utf8'), 10) : 0
  const attempt = (Number.isFinite(previous) ? previous : 0) + 1

  writeFileSync(counter, String(attempt))

  return attempt
}

/** File the outcome of an attempt. Called after the verdict, before it is thrown. */
export function fileAttempt(record: AttemptRecord): void {
  appendFileSync(join(ledgerDir(), LEDGER_FILE), `${JSON.stringify(record)}\n`)
}

/** Read a ledger directory back. Missing file means no attempt was ever made. */
export function readLedger(dir: string): readonly AttemptRecord[] {
  const file = join(dir, LEDGER_FILE)

  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as AttemptRecord)
}

/**
 * Run one case of the plan: claim an attempt, file it, and throw if the plan
 * says this attempt fails.
 *
 * The error message carries the attempt number because one of the six probes is
 * whether the artifact kept the *first* attempt's error, and that question can
 * only be asked of a subject whose attempts say different things.
 */
export interface CaseHooks {
  /**
   * File an extra error against this attempt without ending it — the runner's
   * own soft assertion.
   *
   * Passed in rather than imported because the two halves of the subject have
   * no `expect` in common, and the one probe that needs it is about what
   * several errors in a single attempt do to a report that counts error
   * messages. See `../probes.ts`.
   */
  readonly soft?: (message: string) => void
}

export function runCase(
  id: string,
  failOn: readonly number[],
  errorsPerAttempt = 1,
  hooks: CaseHooks = {},
): void {
  const attempt = claimAttempt(id)
  const failing = failOn.includes(attempt)

  fileAttempt({ id, attempt, outcome: failing ? 'failed' : 'passed' })

  if (!failing) return

  const soft = hooks.soft

  if (soft !== undefined) {
    for (let index = 1; index < errorsPerAttempt; index += 1) {
      soft(`flake subject ${id}: attempt ${attempt} soft failure ${index}`)
    }
  }

  throw new Error(`flake subject ${id}: attempt ${attempt} fails by plan`)
}
