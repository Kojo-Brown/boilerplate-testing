/**
 * What a run does to the baseline on disk, as a function.
 *
 * ---------------------------------------------------------------------------
 * Why this half exists at all
 * ---------------------------------------------------------------------------
 * `matrix.spec.ts` measures whether a comparison reports a difference. That is
 * only half of a visual-regression suite, and it is the half people argue
 * about. The other half is what the job then *does*, and it is decided by one
 * command-line flag with five settings, two of which silently rewrite the
 * thing the suite exists to compare against.
 *
 * A difference that is found and then absorbed into the baseline is worse than
 * one that was never found: `missed` means the next run might catch it, and
 * `absorbed` means no run ever will, because the defect is now the reference.
 * That distinction is the `auto-updated` row in `wirings.ts`, and this file is
 * where it stops being an opinion.
 *
 * ---------------------------------------------------------------------------
 * Real runs, real files, no browser
 * ---------------------------------------------------------------------------
 * Every cell here spawns the actual Playwright CLI against
 * `fixture/cell.spec.ts` and then reads the baseline file off the disk. It is
 * the same move `matrix/reports.ts` makes: the question is what the runner
 * does, so asking the runner is the only answer worth having.
 *
 * And it needs no browser, because the fixture's assertion is
 * `toMatchSnapshot` over a PNG this repository encoded — see `fixture/pixel.ts`.
 * The baseline lifecycle is the runner's, not the renderer's, so the half of
 * this directory that is about `--update-snapshots` runs in `pnpm test` on
 * every Node major, on a machine with nothing installed.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { flatPng } from './fixture/pixel.ts'

const run = promisify(execFile)

const PLAYWRIGHT_BIN = fileURLToPath(new URL('../node_modules/.bin/playwright', import.meta.url))
const FIXTURE_CONFIG = fileURLToPath(new URL('./fixture/playwright-fixture.config.ts', import.meta.url))

/** The colour the baseline holds, and the one a changed run renders. */
export const BASELINE_COLOUR = '#2563eb'
export const CHANGED_COLOUR = '#dc2626'

/**
 * The five settings of `--update-snapshots`.
 *
 * `default` is the absence of the flag, which Playwright documents as
 * equivalent to `missing`. It is listed separately rather than folded in
 * because "we did not pass the flag" and "we passed `missing`" are different
 * things to find in a workflow file, and a table that collapsed them could not
 * say whether the equivalence still holds.
 */
export const UPDATE_MODES = ['default', 'missing', 'changed', 'all', 'none'] as const
export type UpdateMode = (typeof UPDATE_MODES)[number]

/**
 * The three states a baseline can be in when a run starts.
 *
 *   - `absent`    — a snapshot assertion that has never run here. A new test,
 *                   or a fresh CI workspace for a baseline nobody committed.
 *   - `unchanged` — a baseline that still matches what the code renders.
 *   - `changed`   — a baseline that no longer matches. Either a regression or
 *                   an intended redesign; the runner cannot tell, and that is
 *                   the point of the review row in `wirings.ts`.
 */
export const SITUATIONS = ['absent', 'unchanged', 'changed'] as const
export type Situation = (typeof SITUATIONS)[number]

/**
 * What one run did, read as exit code plus what happened to the file.
 *
 *   - `clean`        — exit 0, baseline untouched.
 *   - `blocked`      — exit 1, baseline untouched. The gate working.
 *   - `absorbed`     — exit 0, baseline rewritten. The gate deleted.
 *   - `seeded-red`   — exit 1, baseline created. Playwright's "writing actual".
 *   - `seeded-green` — exit 0, baseline created. A first run that passes
 *                      against a baseline it invented.
 *   - `refused`      — exit 1, no baseline created.
 */
export const RESULTS = ['clean', 'blocked', 'absorbed', 'seeded-red', 'seeded-green', 'refused'] as const
export type LifecycleResult = (typeof RESULTS)[number]

export interface RunOutcome {
  readonly result: LifecycleResult
  readonly exitCode: number
  /** How many times the runner attempted the test, including the first. */
  readonly attempts: number
}

function argsFor(mode: UpdateMode): readonly string[] {
  return mode === 'default' ? [] : [`--update-snapshots=${mode}`]
}

interface JsonReport {
  readonly suites?: readonly {
    readonly specs?: readonly {
      readonly tests?: readonly { readonly results?: readonly unknown[] }[]
    }[]
  }[]
}

function attemptsIn(report: JsonReport): number {
  let total = 0

  for (const suite of report.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const entry of spec.tests ?? []) {
        total += (entry.results ?? []).length
      }
    }
  }

  return total
}

/**
 * Spawn one run and report what it did.
 *
 * `retries` is a parameter because the first thing anybody worries about when
 * they hear that a missing baseline is written and the run fails is whether a
 * retry then passes against it — a green CI run whose baseline is whatever the
 * first attempt happened to render. `lifecycle.test.ts` asks.
 */
export async function runOnce(options: {
  readonly mode: UpdateMode
  readonly situation: Situation
  readonly retries?: number
}): Promise<RunOutcome> {
  const scratch = mkdtempSync(join(tmpdir(), 'visual-lifecycle-'))

  try {
    const snapshots = join(scratch, 'snapshots')
    mkdirSync(snapshots, { recursive: true })

    const baselinePath = join(snapshots, 'cell.png')
    const before = options.situation === 'absent' ? null : flatPng(BASELINE_COLOUR)

    if (before !== null) {
      writeFileSync(baselinePath, before)
    }

    const rendered = options.situation === 'changed' ? CHANGED_COLOUR : BASELINE_COLOUR
    const reportPath = join(scratch, 'report.json')

    let exitCode = 0

    try {
      await run(PLAYWRIGHT_BIN, ['test', '--config', FIXTURE_CONFIG, ...argsFor(options.mode)], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          FIXTURE_SNAPSHOT_DIR: snapshots,
          FIXTURE_COLOUR: rendered,
          FIXTURE_RETRIES: String(options.retries ?? 0),
          FIXTURE_REPORT: reportPath,
          // A non-zero exit is data here rather than a failure, and `CI` is
          // cleared so that `forbidOnly`-style CI behaviour never decides a
          // cell that is supposed to be about the flag.
          CI: '',
        },
      })
    } catch (error) {
      const code = (error as { code?: number }).code
      exitCode = typeof code === 'number' ? code : 1
    }

    const after = existsSync(baselinePath) ? readFileSync(baselinePath) : null
    const green = exitCode === 0

    let result: LifecycleResult

    if (before === null) {
      result = after === null ? 'refused' : green ? 'seeded-green' : 'seeded-red'
    } else if (after !== null && after.equals(before)) {
      result = green ? 'clean' : 'blocked'
    } else {
      result = green ? 'absorbed' : 'blocked'
    }

    const report = existsSync(reportPath)
      ? (JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport)
      : {}

    return { result, exitCode, attempts: attemptsIn(report) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// The published table
// ---------------------------------------------------------------------------

/**
 * What each flag does in each situation.
 *
 * Re-derived against real runs by `lifecycle.test.ts`, which fails if any cell
 * moved. Three of the fifteen are worth reading twice:
 *
 *   - `default` and `missing` agree everywhere, so the documented equivalence
 *     holds — but that means the *default* writes a baseline it has never seen
 *     before and fails. On a fresh CI workspace that is a red run whose
 *     artifact is a baseline nobody reviewed, and the obvious next move —
 *     committing it — commits one machine's render.
 *   - `changed` and `all` are **the same row**, in all three situations. The
 *     distinction their names promise — update only what changed, versus
 *     update everything — does not appear anywhere, because a baseline that is
 *     missing is a change as far as the updater is concerned. The first draft
 *     of this table had `=all` seeding red and `=changed` seeding green, on
 *     the reasoning that the narrower flag would be the careful one; the
 *     measurement said they are indistinguishable.
 *   - Both of them `seeded-green`: given no baseline, they write one and
 *     **exit 0**. A visual test added to a repository whose CI passes either
 *     flag is green on its first run against a baseline no human has ever
 *     seen, and green on every run after it against that same invented
 *     reference. Those two cells are the only place in the table where a suite
 *     reports success having compared nothing.
 *   - `none` is the only setting that refuses to invent a baseline, and it is
 *     the one a CI job wants: on `absent` it fails without writing, so a test
 *     whose baseline was never committed is a failure rather than a silently
 *     seeded pass.
 */
export const LIFECYCLE: Readonly<Record<UpdateMode, Readonly<Record<Situation, LifecycleResult>>>> = {
  default: { absent: 'seeded-red', unchanged: 'clean', changed: 'blocked' },
  missing: { absent: 'seeded-red', unchanged: 'clean', changed: 'blocked' },
  changed: { absent: 'seeded-green', unchanged: 'clean', changed: 'absorbed' },
  all: { absent: 'seeded-green', unchanged: 'clean', changed: 'absorbed' },
  none: { absent: 'refused', unchanged: 'clean', changed: 'blocked' },
}

/** The modes that rewrite a baseline that no longer matches. */
export function absorbingModes(): readonly UpdateMode[] {
  return UPDATE_MODES.filter((mode) => LIFECYCLE[mode].changed === 'absorbed')
}

/** The modes that write a baseline that was not there and still report success. */
export function seedingModes(): readonly UpdateMode[] {
  return UPDATE_MODES.filter((mode) => LIFECYCLE[mode].absent === 'seeded-green')
}

/** The modes safe for a CI job: they neither rewrite nor invent a baseline. */
export function safeModes(): readonly UpdateMode[] {
  return UPDATE_MODES.filter(
    (mode) => LIFECYCLE[mode].changed === 'blocked' && LIFECYCLE[mode].absent === 'refused',
  )
}

export function renderLifecycleTable(): string {
  const header = ['`--update-snapshots`', ...SITUATIONS.map((entry) => `baseline \`${entry}\``)]

  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...UPDATE_MODES.map((mode) =>
      `| ${[
        mode === 'default' ? '*(flag absent)*' : `\`=${mode}\``,
        ...SITUATIONS.map((situation) => `\`${LIFECYCLE[mode][situation]}\``),
      ].join(' | ')} |`,
    ),
  ].join('\n')
}
