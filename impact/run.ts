/**
 * `pnpm impact:run` — run exactly what `pnpm impact:check` selected.
 *
 * Two files rather than one because the two halves fail for different reasons
 * and a pipeline wants them apart: the selection can be computed, printed and
 * audited on a machine with nothing installed but git, and running it is an
 * ordinary Vitest invocation whose exit code is the suite's.
 *
 * Three outcomes, and the middle one is the interesting one:
 *
 *   - `ALL` — the selection could not be narrowed, so the whole suite runs.
 *   - an empty file — nothing in the diff reaches a suite. Nothing runs, and
 *     this exits 0 while saying so loudly. It is a legitimate answer for a
 *     documentation-only diff, and it is also what a selector that has gone
 *     wrong produces, which is why `check.ts` prints the reasons and this
 *     prints the count.
 *   - a list — those files, and nothing else.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, RUN_ALL, SELECTION_FILE } from './repo.ts'

const VITEST_CLI = join(REPO_ROOT, 'node_modules/vitest/vitest.mjs')

function main(): number {
  if (!existsSync(SELECTION_FILE)) {
    process.stderr.write(`No selection at ${SELECTION_FILE}. Run \`pnpm impact:check\` first.\n`)

    return 1
  }

  const lines = readFileSync(SELECTION_FILE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (lines.length === 0) {
    process.stdout.write('Nothing in this diff reaches a suite: no tests to run.\n')

    return 0
  }

  const everything = lines[0] === RUN_ALL
  const args = everything ? ['run'] : ['run', ...lines]

  process.stdout.write(
    everything
      ? 'The selection could not be narrowed: running the whole suite.\n'
      : `Running ${String(lines.length)} selected suite(s).\n`,
  )

  const { status } = spawnSync(process.execPath, [VITEST_CLI, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  })

  return status ?? 1
}

process.exit(main())
