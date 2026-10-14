/**
 * `pnpm flake:check` — the quarantine gate, and the dashboard it prints.
 *
 * ---------------------------------------------------------------------------
 * What it does
 * ---------------------------------------------------------------------------
 * Reads the attempt history (a directory of the files `reporter.ts` writes,
 * plus any Playwright JSON reports beside them), reads the quarantine registry,
 * asks both runners which tests actually exist, and then:
 *
 *   - prints the flakiness dashboard, into `$GITHUB_STEP_SUMMARY` when it is
 *     set and to stdout always;
 *   - exits non-zero when the registry needs attention — an entry past its
 *     expiry, an entry naming a test that is gone, an entry for a test the
 *     history says is fixed (it should come out) or permanently broken (it was
 *     never flaky), or more entries than the policy allows.
 *
 * ---------------------------------------------------------------------------
 * Why this is a script and not a test
 * ---------------------------------------------------------------------------
 * The same split the rest of the repository makes. Two of its inputs are
 * outside the repository — the history, which is assembled from CI artifacts,
 * and the collected test names, which need both runners to walk the whole
 * suite — so it is a CI step of its own. Everything that *decides* anything
 * (`history.ts`, `quarantine.ts`, `dashboard.ts`) is pure and is covered by
 * `pnpm test` against inputs no run of this repository produces.
 *
 * The listing is skipped when the registry is empty, which is the normal state
 * of a healthy suite: there is nothing to check a name against, and thirty
 * seconds of `--list` to prove that an empty list contains no errors is thirty
 * seconds nobody should wait for.
 */

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectAttempts, collectPlaywrightNames, collectVitestNames } from './collect.ts'
import { renderDashboard } from './dashboard.ts'
import { summarise } from './history.ts'
import { audit, keyOf, type QuarantineEntry } from './quarantine.ts'
import { loadRegistry } from './registry.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Every Playwright config in the repository that owns tests.
 *
 * Listed rather than globbed: the fixture configs that live in a `fixture`
 * subdirectory are subjects of other measurements and collect tests that
 * deliberately fail, and a glob would quietly start including the next one
 * somebody adds.
 */
const PLAYWRIGHT_CONFIGS: readonly string[] = [
  'playwright.config.ts',
  'ct/playwright-ct.config.ts',
  'a11y/playwright-a11y.config.ts',
  'intercept/playwright-intercept.config.ts',
  'matrix/playwright-matrix.config.ts',
  'visual/playwright-visual.config.ts',
  'authstate/playwright-authstate.config.ts',
  'trace/playwright-trace.config.ts',
]

const modulesFor = (entries: readonly QuarantineEntry[], runner: QuarantineEntry['runner']): readonly string[] => [
  ...new Set(entries.filter((entry) => entry.runner === runner).map((entry) => entry.module)),
]

function main(): number {
  const historyDirectory = process.env['FLAKE_HISTORY'] ?? join(REPO_ROOT, '.flake')
  const registry = loadRegistry()
  const attempts = collectAttempts(historyDirectory)
  const histories = summarise(attempts)
  const runs = new Set(attempts.map((attempt) => attempt.run)).size

  // Only the files the registry names are listed. Collecting the whole suite
  // to check a handful of names is the better part of a minute per runner, and
  // an entry can only ever be checked against the file it points at.
  const vitestFiles = modulesFor(registry.entries, 'vitest')
  const playwrightFiles = modulesFor(registry.entries, 'playwright')

  const known = new Set([
    ...(vitestFiles.length === 0 ? [] : collectVitestNames(REPO_ROOT, vitestFiles)),
    ...(playwrightFiles.length === 0 ? [] : collectPlaywrightNames(REPO_ROOT, PLAYWRIGHT_CONFIGS, playwrightFiles)),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const { judgements, violations } = audit(registry, { histories, known, today })

  const dashboard = renderDashboard({ histories, judgements, runs, generatedOn: today })

  console.log(dashboard)

  const summary = process.env['GITHUB_STEP_SUMMARY']

  if (summary !== undefined && summary !== '') appendFileSync(summary, `${dashboard}\n`)

  if (attempts.length === 0) {
    console.log(
      [
        '',
        `No attempt records in ${historyDirectory}.`,
        '',
        'The history is a directory of the files `flake/reporter.ts` writes, one per run:',
        '',
        '  FLAKE_ATTEMPTS=.flake/$(date -u +%Y-%m-%dT%H-%M).jsonl \\',
        '    pnpm vitest run --reporter=default --reporter=./flake/reporter.ts',
        '',
        'In CI, download the artifacts of the last N runs into one directory first.',
      ].join('\n'),
    )
  }

  if (violations.length === 0) {
    console.log(
      registry.entries.length === 0
        ? '\nQuarantine registry is empty — nothing to review.'
        : `\n${String(registry.entries.length)} quarantined ${registry.entries.length === 1 ? 'test' : 'tests'}, all within policy.`,
    )

    return 0
  }

  console.error(`\n${String(violations.length)} quarantine violation${violations.length === 1 ? '' : 's'}:\n`)

  for (const violation of violations) console.error(`  • ${violation}`)

  console.error(
    [
      '',
      'Each line is one of five things:',
      '',
      '  expired      the entry is past its `expiresOn`. Fix the test, or renew the',
      '               entry deliberately with a reason in the commit message.',
      '  orphan       the entry names a test no runner collects. It was renamed or',
      '               deleted — update the entry or remove it.',
      '  release      the history says this test has stopped failing. Delete the',
      '               entry; the test goes back into the suite with its name, its id',
      '               and its history intact.',
      '  escalate     the history says this test fails every attempt. Quarantine is',
      '               hiding a plain failure rather than smoothing a flake.',
      '  unevidenced  nothing has measured this test flaking. Run the suite with',
      '               `flake/reporter.ts` attached, or remove the entry.',
      '',
      `Registered tests: ${registry.entries.map((entry) => keyOf(entry)).join(', ')}`,
    ].join('\n'),
  )

  return 1
}

process.exit(main())
