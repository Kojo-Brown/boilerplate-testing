/**
 * Gathering attempts from a directory of runs, and asking the runners what
 * tests exist.
 *
 * ---------------------------------------------------------------------------
 * Where the history comes from
 * ---------------------------------------------------------------------------
 * One CI run produces one attempts file. A flake rate needs many, so the shape
 * on disk is a directory of them — in CI, the artifacts of the last N runs
 * downloaded into one place:
 *
 *   .flake/
 *     2026-10-11T03-02-run-1841.jsonl
 *     2026-10-12T03-01-run-1856.jsonl
 *     …
 *
 * Files are read in sorted order, which is why the names begin with a
 * timestamp: `history.ts`'s `passStreak`, `flips` and `timeline` are all
 * order-sensitive, and the filesystem's idea of order is not chronological.
 *
 * Playwright's JSON reports are collected too, because that runner's own
 * report already is an attempt record (`matrix.ts` measures that) and
 * translating it is cheaper than making every project add a reporter to a
 * runner that does not need one.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { attemptsFromJsonl, attemptsFromPlaywrightJson, type Attempt } from './attempts.ts'

/** Read every attempts file and Playwright report in a directory. */
export function collectAttempts(directory: string): readonly Attempt[] {
  if (!existsSync(directory)) return []

  const attempts: Attempt[] = []

  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name)

    if (name.endsWith('.jsonl')) {
      attempts.push(...attemptsFromJsonl(readFileSync(path, 'utf8')))
      continue
    }

    if (name.endsWith('.json')) {
      // A Playwright report, named after the run it came from: the report has
      // no run identifier in it, so the file name is the only thing that can
      // separate two runs of the same suite.
      attempts.push(...attemptsFromPlaywrightJson(JSON.parse(readFileSync(path, 'utf8')), name.replace(/\.json$/, '')))
    }
  }

  return attempts
}

/**
 * Every `module::name` Vitest collects, from the files given.
 *
 * `vitest list --json`, the same instrument `snapshot/check.ts` and
 * `shape/collect.ts` use, and for the same reason: whether a test exists is a
 * question only the collector can answer, and a grep over source files answers
 * a different one — it cannot tell a `test()` call from a string in a comment,
 * and cannot see a parameterised title at all. The payload goes to a file
 * rather than stdout so that a banner or a deprecation notice cannot corrupt
 * the parse.
 *
 * `files` narrows the collection, and callers should narrow it: listing this
 * repository's 3,800 tests takes the better part of a minute, and the only
 * files a registry entry can be checked against are the ones its entries
 * name. An empty list means the whole suite, which is what a caller with no
 * particular file in mind wants and nobody should ask for twice.
 */
export function collectVitestNames(root: string, files: readonly string[] = []): ReadonlySet<string> {
  const entry = join(root, 'node_modules/vitest/vitest.mjs')

  if (!existsSync(entry)) {
    throw new Error('Cannot list tests: node_modules/vitest is missing. Run `pnpm install` first.')
  }

  const directory = mkdtempSync(join(tmpdir(), 'flake-list-'))
  const output = join(directory, 'tests.json')

  try {
    execFileSync(process.execPath, [entry, 'list', `--json=${output}`, ...files], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    const payload = JSON.parse(readFileSync(output, 'utf8')) as readonly { name?: unknown; file?: unknown }[]

    return new Set(
      payload
        .filter((test): test is { name: string; file: string } => typeof test.name === 'string' && typeof test.file === 'string')
        .map((test) => `${relative(root, test.file).replaceAll('\\', '/')}::${test.name}`),
    )
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? ''

    throw new Error(`vitest list failed:\n${stderr.trim()}`, { cause: error })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Every `module::name` Playwright collects, across the configs given.
 *
 * One `--list` per config, because a Playwright project has no equivalent of
 * Vitest's single root: this repository has eight configs, and a test that is
 * only in `playwright-visual.config.ts` is invisible to a listing of the
 * default one. An entry in the registry naming such a test would otherwise be
 * reported as an orphan.
 *
 * `files` narrows each listing to the paths given, for the reason it does next
 * door. A config that owns none of them lists nothing and costs its startup.
 */
export function collectPlaywrightNames(
  root: string,
  configs: readonly string[],
  files: readonly string[] = [],
): ReadonlySet<string> {
  const cli = join(root, 'node_modules/@playwright/test/cli.js')

  if (!existsSync(cli)) {
    throw new Error('Cannot list tests: node_modules/@playwright/test is missing. Run `pnpm install` first.')
  }

  const names = new Set<string>()

  for (const config of configs) {
    const raw = execFileSync(process.execPath, [cli, 'test', '--config', config, '--list', '--reporter=json', ...files], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    })

    interface Spec {
      readonly title?: unknown
      readonly file?: unknown
      readonly specs?: readonly Spec[]
      readonly suites?: readonly Spec[]
    }

    const walk = (suite: Spec, titles: readonly string[]): void => {
      for (const spec of suite.specs ?? []) {
        if (typeof spec.title !== 'string') continue

        const file = typeof spec.file === 'string' ? spec.file : typeof suite.file === 'string' ? suite.file : ''

        names.add(`${file.replaceAll('\\', '/')}::${[...titles, spec.title].join(' > ')}`)
      }

      for (const child of suite.suites ?? []) {
        walk(child, [...titles, typeof child.title === 'string' ? child.title : ''])
      }
    }

    for (const suite of (JSON.parse(raw) as { suites?: readonly Spec[] }).suites ?? []) {
      walk(suite, [])
    }
  }

  return names
}
