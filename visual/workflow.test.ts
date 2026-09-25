// @vitest-environment node
//
// `workflow-templates/visual-regression.yml` is the top row of the matrix as a
// copyable file, and this is the audit that keeps it one. The three controls a
// workflow file can actually carry are derived back out of the text and
// compared against whichever row tops the table — no constant below names the
// winner, so the day the measurement moves, the template fails the build
// instead of becoming last year's advice. `ephemeral/workflows.test.ts`
// established the shape.
//
// Read as text rather than parsed as YAML, like everything else in
// `workflow-templates/`: what is being checked is what a reader would grep
// for, and adding a YAML dependency to assert that a flag is present would be
// a larger claim than the file makes.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { absorbingModes, safeModes, seedingModes, type UpdateMode } from './lifecycle.ts'
import { WIRINGS, scoreOf, type Review, type Wiring } from './wirings.ts'

const TEMPLATE = fileURLToPath(
  new URL('../workflow-templates/visual-regression.yml', import.meta.url),
)

const source = readFileSync(TEMPLATE, 'utf8')

/** Every uncommented line, so an example in a comment is not read as a step. */
const live = source
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/** The setting of `--update-snapshots` the template's test step actually passes. */
function updateModeOf(text: string): UpdateMode {
  const explicit = /--update-snapshots=(\w+)/.exec(text)

  if (explicit) {
    return explicit[1] as UpdateMode
  }

  return /--update-snapshots\b/.test(text) ? 'all' : 'default'
}

/** Whether the template publishes the diffs a failed comparison produced. */
function publishesDiffs(text: string): boolean {
  return /uses:\s*actions\/upload-artifact/.test(text) && /if:\s*always\(\)/.test(text)
}

/**
 * Whether the template pushes baselines back to the branch.
 *
 * A bot that commits a new baseline when the suite goes red is
 * `--update-snapshots` wearing a hat, so it is checked for separately: the
 * flag can be right and the policy still wrong.
 */
function commitsBaselines(text: string): boolean {
  return /git\s+(commit|push)/.test(text)
}

/** The review policy those three controls add up to. */
function reviewOf(text: string): Review {
  if (absorbingModes().includes(updateModeOf(text)) || commitsBaselines(text)) {
    return 'auto-update'
  }

  return publishesDiffs(text) ? 'approve' : 'blocking'
}

const best = [...WIRINGS].sort((left, right) => scoreOf(right) - scoreOf(left))[0] as Wiring

describe('the shipped workflow is the top row of the table', () => {
  it('carries the review policy the top-scoring wiring has', () => {
    expect(reviewOf(live)).toBe(best.review)
  })

  it('passes the one update setting that neither invents nor rewrites a baseline', () => {
    const mode = updateModeOf(live)

    expect([...safeModes()]).toContain(mode)
    expect([...absorbingModes()]).not.toContain(mode)
    expect([...seedingModes()]).not.toContain(mode)
  })

  it('publishes the diffs, which is what separates `approve` from `blocking`', () => {
    expect(publishesDiffs(live)).toBe(true)
  })

  it('never writes baselines back to the branch', () => {
    expect(commitsBaselines(live)).toBe(false)
  })

  it('runs on pull requests, or it is not a gate', () => {
    expect(live).toMatch(/^on:/m)
    expect(live).toMatch(/pull_request:/)
  })
})

describe('the deriver', () => {
  // The audit above passes trivially if `updateModeOf` cannot tell the
  // settings apart, so the deriver is tested on text that is not the template.
  it('reads each spelling of the flag', () => {
    expect(updateModeOf('run: playwright test')).toBe('default')
    expect(updateModeOf('run: playwright test --update-snapshots')).toBe('all')
    expect(updateModeOf('run: playwright test --update-snapshots=none')).toBe('none')
    expect(updateModeOf('run: playwright test --update-snapshots=changed')).toBe('changed')
  })

  it('calls a workflow that rewrites baselines `auto-update`, however it does it', () => {
    expect(reviewOf('run: playwright test --update-snapshots=all')).toBe('auto-update')
    expect(
      reviewOf('run: playwright test --update-snapshots=none\nrun: git commit -am baselines'),
    ).toBe('auto-update')
  })

  it('calls a blocking job with no artifact `blocking`, not `approve`', () => {
    expect(reviewOf('run: playwright test --update-snapshots=none')).toBe('blocking')
  })

  it('ignores a flag that only appears in a comment', () => {
    // The template's own prose quotes `--update-snapshots=changed` as the
    // command a person runs locally. Reading the file without stripping
    // comments would derive `auto-update` from its documentation.
    expect(source).toContain('--update-snapshots=changed')
    expect(updateModeOf(live)).toBe('none')
  })
})
