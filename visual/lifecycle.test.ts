// @vitest-environment node
//
// Spawns real `playwright test` runs and reads real files. No browser: the
// fixture's assertion is `toMatchSnapshot` over a PNG `fixture/pixel.ts`
// encoded, so this whole suite runs in `pnpm test` on a machine with nothing
// installed. See `lifecycle.ts`.
//
// Fifteen runs plus three, each spawning a Node process, so the timeouts are
// stated rather than inherited — Vitest's 5s default is less than one cold
// start of the Playwright CLI on a two-core runner. `ephemeral/` learned the
// same lesson the expensive way, on CI.

import { describe, expect, it } from 'vitest'

import {
  LIFECYCLE,
  SITUATIONS,
  UPDATE_MODES,
  absorbingModes,
  renderLifecycleTable,
  runOnce,
  safeModes,
  seedingModes,
  type LifecycleResult,
  type Situation,
  type UpdateMode,
} from './lifecycle.ts'

const RUN_TIMEOUT = 60_000
const TABLE_TIMEOUT = 300_000

describe('what a run does to the baseline on disk', () => {
  it(
    'agrees with the published table in every one of the fifteen cells',
    async () => {
      const observed: Record<string, Record<string, LifecycleResult>> = {}

      for (const mode of UPDATE_MODES) {
        const row: Record<string, LifecycleResult> = {}

        for (const situation of SITUATIONS) {
          row[situation] = (await runOnce({ mode, situation })).result
        }

        observed[mode] = row
      }

      const published = Object.fromEntries(
        UPDATE_MODES.map((mode) => [
          mode,
          Object.fromEntries(SITUATIONS.map((situation) => [situation, LIFECYCLE[mode][situation]])),
        ]),
      )

      expect(observed).toEqual(published)
    },
    TABLE_TIMEOUT,
  )

  it(
    'does not retry a missing baseline into a green run',
    async () => {
      // The thing to be afraid of, given that a missing baseline is written
      // and the attempt fails: that a retry then compares against the file the
      // first attempt just wrote, passes, and reports the run flaky-but-green
      // with a baseline nobody ever looked at.
      //
      // It does not happen. Playwright does not retry a snapshot-missing
      // failure — the run makes exactly one attempt and stays red — which is
      // the one piece of good news in this file and the reason `default` is
      // merely bad rather than dangerous.
      const outcome = await runOnce({ mode: 'default', situation: 'absent', retries: 2 })

      expect(outcome.result).toBe('seeded-red')
      expect(outcome.exitCode).not.toBe(0)
      expect(outcome.attempts).toBe(1)
    },
    RUN_TIMEOUT,
  )

  it(
    'does retry an ordinary mismatch, and still ends red',
    async () => {
      // The contrast that makes the previous case a statement about snapshots
      // rather than about retries being off: the same runner, the same flag,
      // a baseline that exists and does not match, and three attempts.
      const outcome = await runOnce({ mode: 'default', situation: 'changed', retries: 2 })

      expect(outcome.result).toBe('blocked')
      expect(outcome.attempts).toBe(3)
    },
    RUN_TIMEOUT,
  )
})

describe('reading the table', () => {
  it('names the two flags that rewrite a baseline that no longer matches', () => {
    expect([...absorbingModes()]).toEqual(['changed', 'all'])
  })

  it('names `none` as the only setting that refuses to invent a baseline', () => {
    expect([...safeModes()]).toEqual(['none'])
  })

  it('names both update settings as inventing a baseline and passing', () => {
    expect([...seedingModes()]).toEqual(['changed', 'all'])
  })

  it('finds no situation in which `=changed` differs from `=all`', () => {
    // Their names promise a distinction — update only what changed, versus
    // update everything — and none of the three situations a baseline can be
    // in exposes one, because a missing baseline is a change as far as the
    // updater is concerned. Reaching for `=changed` because it sounds safer
    // buys exactly nothing.
    expect(LIFECYCLE.changed).toEqual(LIFECYCLE.all)
  })

  it('confirms that the absent flag is `missing`, as Playwright documents', () => {
    expect(LIFECYCLE.default).toEqual(LIFECYCLE.missing)
  })

  it('has a `clean` column: an unchanged baseline is untouched by every flag', () => {
    // Worth pinning because it is what makes `--update-snapshots` look
    // harmless in local use. Run it on a tree with nothing to update and every
    // setting is identical; the difference only appears on the day something
    // did change, which is the day you needed the gate.
    for (const mode of UPDATE_MODES) {
      expect(LIFECYCLE[mode].unchanged, mode).toBe('clean')
    }
  })

  it('renders a row per mode and a column per situation', () => {
    const rendered = renderLifecycleTable()
    const rows = rendered.split('\n')

    expect(rows).toHaveLength(UPDATE_MODES.length + 2)

    for (const situation of SITUATIONS satisfies readonly Situation[]) {
      expect(rendered).toContain(`baseline \`${situation}\``)
    }

    for (const mode of UPDATE_MODES satisfies readonly UpdateMode[]) {
      if (mode !== 'default') {
        expect(rendered).toContain(`\`=${mode}\``)
      }
    }
  })
})
