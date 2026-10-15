/**
 * `pnpm impact:check` — the selection for a real diff, and the audit of the
 * configuration it was made with.
 *
 * ---------------------------------------------------------------------------
 * What it does
 * ---------------------------------------------------------------------------
 * Reads the diff against the merge base, builds the import graph over the
 * tracked files, folds in the derived snapshot edges and the declared data-file
 * edges, and prints what the recommended strategy would run — into
 * `$GITHUB_STEP_SUMMARY` when it is set and to stdout always. The list is also
 * written to a file so `pnpm impact:run` can run exactly it.
 *
 * It exits non-zero on two things, and neither of them is "the selection looks
 * small":
 *
 *   - **A stale configuration.** A trigger pattern that matches no tracked
 *     file, or a declared edge whose ends have moved. Both are silent in the
 *     worst way: the selector keeps working and stops covering something.
 *   - **A selection the runner would not run.** The suite list here is derived
 *     from `vitest.config.ts`'s own exclusion list; `vitest list` is the
 *     runner's answer to the same question. If they disagree, the selection is
 *     naming files that will not be collected, and a green "selected suites"
 *     job would mean nothing. Set `IMPACT_SKIP_COLLECT=1` to skip the
 *     collection, which is the slow half.
 *
 * ---------------------------------------------------------------------------
 * Why this does not replace the full run
 * ---------------------------------------------------------------------------
 * Because the measurement in `README.md` says it cannot. The recommended
 * strategy is safe on all eight faults in the catalogue, and its safety rests
 * on a hand-written list of data-file edges being complete — which nothing can
 * check, because the failure is an edge nobody thought of. So this is wired
 * into CI as fast feedback beside the full `gates` run, not instead of it, and
 * the decision is written down here rather than in a YAML comment that nobody
 * reads.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectVitest } from '../shape/collect.ts'
import { parseNameStatusZ, type ChangedFile } from './diff.ts'
import {
  auditConfiguration,
  derivedEdges,
  DEFAULT_STRATEGY,
  REPO_ROOT,
  repoSelection,
  RUN_ALL,
  SELECTION_FILE,
  trackedFiles,
  unitTestFiles,
} from './repo.ts'
import { strategy } from './strategies.ts'

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

/**
 * The reference the diff is taken against.
 *
 * `GITHUB_BASE_REF` is set on a pull request and names the target branch;
 * outside one, the default branch. `IMPACT_BASE` overrides both, which is how
 * this is used locally against anything.
 */
export function baseRef(): string {
  const explicit = process.env['IMPACT_BASE']

  if (explicit !== undefined && explicit !== '') return explicit

  const pullRequestBase = process.env['GITHUB_BASE_REF']

  if (pullRequestBase !== undefined && pullRequestBase !== '') return `origin/${pullRequestBase}`

  return 'origin/main'
}

/**
 * The diff: committed changes since the merge base, plus the working tree.
 *
 * `git diff <merge-base>` — with no second revision — compares the working
 * tree, so one command serves both a clean CI checkout and a developer
 * mid-change. Untracked files are added separately: `git diff` cannot see
 * them, and a new test file that nobody has staged yet is exactly the case a
 * selector must not drop.
 */
export function readDiff(base: string): readonly ChangedFile[] {
  let mergeBase: string

  try {
    mergeBase = git(['merge-base', base, 'HEAD']).trim()
  } catch {
    // The first thing that goes wrong on a shallow clone or a fork whose
    // default branch is not fetched, and the git error alone names neither
    // cause. CI passes `fetch-depth: 0` for exactly this reason.
    throw new Error(
      `cannot find the merge base of "${base}" and HEAD. Fetch it (\`git fetch origin\`), or name another base with IMPACT_BASE. In CI this means the checkout was shallow: set \`fetch-depth: 0\`.`,
    )
  }

  const committed = parseNameStatusZ(git(['diff', '--name-status', '-z', mergeBase]))
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter((path) => path !== '')
    .map((path): ChangedFile => ({ path, status: 'added' }))

  const seen = new Set(committed.map((change) => change.path))

  return [...committed, ...untracked.filter((change) => !seen.has(change.path))]
}

function report(lines: readonly string[]): void {
  const text = `${lines.join('\n')}\n`

  process.stdout.write(text)

  const summary = process.env['GITHUB_STEP_SUMMARY']

  if (summary !== undefined && summary !== '') appendFileSync(summary, text)
}

function main(): number {
  const files = trackedFiles()
  const suites = unitTestFiles(files)
  const base = baseRef()
  const changed = readDiff(base)
  const selection = repoSelection(changed, files)
  const edges = derivedEdges(files)
  const problems = auditConfiguration(files)
  const lines: string[] = [
    '## Test impact',
    '',
    `Strategy \`${DEFAULT_STRATEGY}\` — ${strategy(DEFAULT_STRATEGY).rule}.`,
    '',
    `- diff against \`${base}\`: **${String(changed.length)}** changed path(s)`,
    `- graph: ${String(files.length)} tracked files, ${String(edges.snapshots)} derived snapshot edge(s), ${String(edges.declared)} declared data-file edge(s)`,
    selection.ranAll
      ? `- selection: **the whole suite** (${String(suites.length)} files)`
      : `- selection: **${String(selection.suites.length)} of ${String(suites.length)}** suite(s)`,
    '',
  ]

  for (const reason of selection.reasons) lines.push(`  - ${reason}`)

  if (!selection.ranAll && selection.suites.length > 0) {
    lines.push('', '<details><summary>Selected suites</summary>', '')
    for (const suite of selection.suites) lines.push(`- \`${suite}\``)
    lines.push('', '</details>')
  }

  // The full run is what gates the merge. Saying so here, every time, is the
  // difference between a tool people trust and a number people quietly
  // start treating as the verdict.
  lines.push(
    '',
    'This is fast feedback, not the gate: `gates` runs the whole suite on every supported Node major. See `impact/README.md` for what selection misses and why.',
  )

  if (problems.length > 0) {
    lines.push('', '### Configuration problems', '')
    for (const problem of problems) lines.push(`- **${problem.kind}** — ${problem.detail}`)
  }

  let unrunnable: readonly string[] = []

  if (process.env['IMPACT_SKIP_COLLECT'] !== '1' && !selection.ranAll && selection.suites.length > 0) {
    const collected = new Set(Object.keys(collectVitest(null, mkdtempSync(join(tmpdir(), 'impact-collect-'))).counts))

    unrunnable = selection.suites.filter((suite) => !collected.has(suite))

    if (unrunnable.length > 0) {
      lines.push('', '### Selected files the runner would not collect', '')
      for (const suite of unrunnable) lines.push(`- \`${suite}\``)
    }
  }

  writeFileSync(SELECTION_FILE, selection.ranAll ? `${RUN_ALL}\n` : `${selection.suites.join('\n')}\n`)
  lines.push('', `Selection written to \`${SELECTION_FILE}\`.`)
  report(lines)

  return problems.length > 0 || unrunnable.length > 0 ? 1 : 0
}

process.exit(main())
