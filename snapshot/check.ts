/**
 * `pnpm snapshot:check` — the CI gate for the snapshot policy.
 *
 * Takes the inventory, asks Vitest which tests exist, judges the result
 * against `registry.ts`, prints the whole picture and exits non-zero on any
 * violation.
 *
 * ---------------------------------------------------------------------------
 * Why this is a script and not a test
 * ---------------------------------------------------------------------------
 * One rule needs the runner. A `.snap` entry is obsolete when the test that
 * produced it no longer exists, and nothing on the filesystem can decide that
 * — the name in the file has to be checked against the names the collector
 * reports. So this spawns `vitest list`, the same way `shape/collect.ts` does
 * and for the same reason, and it is a CI step of its own rather than a
 * `*.test.ts` inside the unit run.
 *
 * The half that *is* cheap and deterministic — the inventory, and the policy
 * decision over it — stays in `pnpm test` as `inventory.test.ts` and
 * `policy.test.ts`. That split is the same one `shape/` makes.
 *
 * Only the test files that own a `.snap` are listed, rather than the whole
 * repository, because listing 1,200 tests to check four snapshot names is
 * thirty seconds nobody needs to wait for.
 *
 * The report is written for somebody who has just been told their pull request
 * is red and has never heard of this gate: it prints every registered
 * snapshot, its size against its budget, and the reason it exists, before it
 * prints what is wrong.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT, takeInventory, type Inventory } from './inventory.ts'
import { evaluate, type Evaluation } from './policy.ts'
import { REGISTRY } from './registry.ts'

/**
 * Every `describe > it` name Vitest collects from the given files.
 *
 * `process.execPath` rather than `npx`, so the collector runs under the exact
 * Node running this script — which matters on a version matrix — and does not
 * depend on anything being on `PATH`. The payload is a file rather than
 * stdout, so a banner or a deprecation notice cannot corrupt the parse.
 */
export function collectTestNames(files: readonly string[]): Set<string> {
  if (files.length === 0) {
    return new Set()
  }

  const entry = join(REPO_ROOT, 'node_modules/vitest/vitest.mjs')

  if (!existsSync(entry)) {
    throw new Error('Cannot list tests: node_modules/vitest is missing. Run `pnpm install` first.')
  }

  const directory = mkdtempSync(join(tmpdir(), 'snapshot-check-'))
  const outputFile = join(directory, 'tests.json')

  try {
    execFileSync(process.execPath, [entry, 'list', `--json=${outputFile}`, ...files], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? ''

    throw new Error(`vitest list failed:\n${stderr.trim()}`, { cause: error })
  }

  if (!existsSync(outputFile)) {
    throw new Error(`vitest list produced no output at ${outputFile}`)
  }

  const payload: unknown = JSON.parse(readFileSync(outputFile, 'utf8'))

  rmSync(directory, { recursive: true, force: true })

  if (!Array.isArray(payload)) {
    throw new Error(`vitest list produced ${typeof payload}, expected an array of tests`)
  }

  const names = new Set<string>()

  for (const test of payload as { name?: unknown }[]) {
    if (typeof test.name === 'string') {
      names.add(test.name)
    }
  }

  return names
}

/** The test files that own at least one file snapshot. */
export function filesWithSnapshots(inventory: Inventory): string[] {
  return [
    ...new Set(
      inventory.snapshots.filter((snapshot) => snapshot.kind === 'file').map((s) => s.file),
    ),
  ].sort()
}

const pad = (value: string | number, width: number): string => String(value).padStart(width)

export function render(inventory: Inventory, evaluation: Evaluation): string {
  const lines: string[] = []

  lines.push('')
  lines.push('Snapshot policy — every snapshot is registered, budgeted and stable')
  lines.push('')
  lines.push(
    `  ${inventory.snapshots.length} snapshot(s) across ${inventory.snapFiles.length} .snap ` +
      `file(s) and ${new Set(inventory.inline.map((s) => s.file)).size} file(s) with inline snapshots`,
  )
  lines.push('')

  for (const { snapshot, registration, headroom } of evaluation.governed) {
    lines.push(
      `  ${snapshot.kind.padEnd(6)} ${pad(snapshot.lines, 3)}/${String(registration.budget).padEnd(3)} ` +
        `(+${headroom})  ${snapshot.file}`,
    )
    lines.push(`         ${snapshot.name}`)
    lines.push(`         ${registration.why}`)
    lines.push('')
  }

  if (evaluation.violations.length > 0) {
    lines.push(`  ${evaluation.violations.length} violation(s):`)
    lines.push('')

    for (const violation of evaluation.violations) {
      lines.push(`    [${violation.kind}] ${violation.file}`)
      lines.push(`      ${violation.detail}`)
      lines.push('')
    }

    lines.push('  See snapshot/README.md for what each rule is for.')
    lines.push('')
  }

  return lines.join('\n')
}

function main(): void {
  const inventory = takeInventory()
  const testNames = collectTestNames(filesWithSnapshots(inventory))
  const evaluation = evaluate(inventory, REGISTRY, testNames)

  process.stdout.write(render(inventory, evaluation))

  if (evaluation.violations.length > 0) {
    process.stdout.write(`snapshot: FAILED (${evaluation.violations.length} violation(s))\n`)
    process.exitCode = 1

    return
  }

  process.stdout.write('snapshot: ok\n')
}

/**
 * Run only when this file is the program, not when it is imported.
 *
 * `check.test.ts` imports `render` and `filesWithSnapshots` to test the report
 * itself. Without this guard that import would spawn `vitest list` from inside
 * a Vitest worker — the gate's slowest step, run for nothing, every time the
 * unit suite touches this file.
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
