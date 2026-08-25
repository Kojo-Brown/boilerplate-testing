/**
 * Counting the tests — by asking the runners, not by reading the source.
 *
 * This is the part of the census that cannot live inside `pnpm test`, and the
 * reason is worth stating plainly, because the obvious design is to count
 * `it(...)` calls with the parser that `classify.ts` already uses and be done.
 *
 * That design is wrong here, and measurably so. A static count of this
 * repository's test cases comes out at 655 against a true 806 — 19% low — and
 * the error is not spread evenly, which is what makes it fatal to a *ratio*:
 *
 *   - `tdd/conventions/eslint-plugin/aaaStructure.test.ts` declares no `it(`
 *     at all. ESLint's `RuleTester` generates one test per entry in its
 *     `valid` / `invalid` arrays. Static count 0, true count 18.
 *   - `k6/config.test.ts` builds cases in a loop over a table. Static 29,
 *     true 53.
 *   - `tdd/schools/orderContract.test.ts` is a shared contract invoked twice,
 *     once per school. Static 0, true 28.
 *   - `tdd/katas.test.ts` uses `it.each(KATAS.map(...))`, whose row count is
 *     not knowable without evaluating the module.
 *
 * Every one of those under-counts a file that is *also* an integration test
 * under `boundaries.ts`, so a static census would report a tidier pyramid than
 * the one that exists. A gate that flatters the thing it measures is worse
 * than no gate.
 *
 * So the counts come from the collectors themselves — the same code paths that
 * decide what runs. Both support collection without execution (`vitest list`,
 * `playwright test --list`), neither needs a browser or a database to do it,
 * and both write JSON to a file rather than stdout so no banner has to be
 * parsed around.
 *
 * The cost is that this spawns child processes, which is why it is
 * `pnpm shape:check` and its own CI step rather than a `*.test.ts` inside the
 * unit run. `shape.test.ts` keeps the half that *is* cheap and deterministic —
 * the classification and its closed table — inside `pnpm test`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { REPO_ROOT } from './classify.ts'

/** Test counts per repo-relative file, from one runner. */
export interface CollectorResult {
  /** Which runner produced this, for the report and for error messages. */
  readonly runner: string
  /** Repo-relative file path → number of test cases the runner will run. */
  readonly counts: Readonly<Record<string, number>>
}

/**
 * Files that legitimately collect zero tests.
 *
 * A test file no runner collects anything from is normally dead code — it was
 * renamed out of an include glob, or its suite throws during collection — and
 * the census reports it. This is the one file where zero is correct:
 * `it.skipIf(!process.env['PROVIDER_BASE_URL'])` means the provider
 * verification is not declared at all unless a provider is running, and
 * `vitest list` omits skipped tests rather than listing them as pending.
 *
 * It is an exception rather than a special case in the code so that a second
 * one has to be argued for, in writing, here.
 */
export const EXPECTED_EMPTY: readonly string[] = [
  'pact/provider/users.provider.pact.verify.test.ts',
]

const toPosix = (path: string): string => path.split('\\').join('/')

function runnerEntry(relativePath: string, runner: string): string {
  const entry = join(REPO_ROOT, relativePath)

  if (!existsSync(entry)) {
    throw new Error(
      `Cannot collect ${runner} tests: ${relativePath} is missing. Run \`pnpm install\` first.`,
    )
  }

  return entry
}

/**
 * Run a collector and read the JSON it wrote.
 *
 * `process.execPath` rather than `pnpm exec` or `npx`: it inherits the exact
 * Node running this script, which matters on a version matrix, and it does not
 * depend on anything being on `PATH`. stdout is discarded — the payload is the
 * file — so a progress banner or a deprecation notice cannot corrupt the parse.
 */
function collectJson(
  entry: string,
  args: readonly string[],
  outputFile: string,
  env: NodeJS.ProcessEnv,
  runner: string,
): unknown {
  try {
    execFileSync(process.execPath, [entry, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? ''

    // The runner's own stderr is what a reader needs, so it goes in the
    // message; the original keeps the stack and the exit code.
    throw new Error(`${runner} collection failed:\n${stderr.trim()}`, { cause: error })
  }

  if (!existsSync(outputFile)) {
    throw new Error(`${runner} collection produced no output at ${outputFile}`)
  }

  return JSON.parse(readFileSync(outputFile, 'utf8'))
}

/**
 * Collect from one Vitest project.
 *
 * `vitest list` resolves the same include and exclude globs the run uses, so
 * the default project reports the unit suite (which excludes `pact/**` and
 * `playwright/**`) and the pact project reports its own. Asking both is how
 * the census covers `pnpm test` and `pnpm test:pact` without hardcoding either
 * config's globs a second time.
 */
export function collectVitest(config: string | null, outputDir: string): CollectorResult {
  const runner = config === null ? 'vitest' : `vitest (${config})`
  const outputFile = join(outputDir, `vitest-${config === null ? 'default' : 'pact'}.json`)
  const args = ['list', `--json=${outputFile}`]

  if (config !== null) {
    args.push('--config', config)
  }

  const payload = collectJson(runnerEntry('node_modules/vitest/vitest.mjs', runner), args, outputFile, {}, runner)

  if (!Array.isArray(payload)) {
    throw new Error(`${runner} produced ${typeof payload}, expected an array of tests`)
  }

  const counts: Record<string, number> = {}

  for (const test of payload as { file?: unknown }[]) {
    if (typeof test.file !== 'string') {
      throw new Error(`${runner} listed a test with no file`)
    }

    const file = toPosix(relative(REPO_ROOT, test.file))

    counts[file] = (counts[file] ?? 0) + 1
  }

  return { runner, counts }
}

/** One node of Playwright's reported suite tree. */
interface PlaywrightSuite {
  readonly file?: string
  readonly specs?: readonly { readonly title?: string; readonly line?: number }[]
  readonly suites?: readonly PlaywrightSuite[]
}

/**
 * Collect from Playwright.
 *
 * The subtlety here is projects. `playwright.config.ts` declares six — five
 * browser/device projects plus a visual one — and the JSON reporter repeats
 * the whole suite tree once per project, so a naive count reports 5× the
 * declarations (and 6× for the specs the visual project also picks up). The
 * ratio is a statement about tests *written*, not test *executions*, so specs
 * are deduplicated by file, line and title.
 *
 * That the two numbers differ by 5× is itself the pyramid's argument, and
 * `report.ts` prints both for exactly that reason: 51 end-to-end tests are
 * 251 end-to-end runs.
 */
export function collectPlaywright(outputDir: string): CollectorResult {
  const runner = 'playwright'
  const outputFile = join(outputDir, 'playwright.json')
  const entry = runnerEntry('node_modules/@playwright/test/cli.js', runner)
  const payload = collectJson(
    entry,
    ['test', '--list', '--reporter=json'],
    outputFile,
    { PLAYWRIGHT_JSON_OUTPUT_NAME: outputFile },
    runner,
  )

  const root = payload as { rootDir?: unknown; suites?: readonly PlaywrightSuite[] }
  const config = (payload as { config?: { rootDir?: unknown } }).config
  const rootDir = typeof config?.rootDir === 'string' ? config.rootDir : String(root.rootDir ?? '')

  if (rootDir === '') {
    throw new Error('playwright reported no rootDir, so spec paths cannot be resolved')
  }

  const counts: Record<string, number> = {}
  const seen = new Set<string>()

  const walk = (suite: PlaywrightSuite, inherited: string | undefined): void => {
    const file = suite.file ?? inherited

    if (file !== undefined) {
      for (const spec of suite.specs ?? []) {
        const key = `${file}::${spec.line ?? '?'}::${spec.title ?? ''}`

        if (seen.has(key)) {
          continue
        }

        seen.add(key)

        const absolute = join(rootDir, file)
        const relativeFile = toPosix(relative(REPO_ROOT, absolute))

        counts[relativeFile] = (counts[relativeFile] ?? 0) + 1
      }
    }

    for (const child of suite.suites ?? []) {
      walk(child, file)
    }
  }

  for (const suite of root.suites ?? []) {
    walk(suite, undefined)
  }

  return { runner, counts }
}

/** A file counted by more than one runner, which would double it in the ratio. */
export interface DoubleCounted {
  readonly file: string
  readonly runners: readonly string[]
}

/** Every runner's counts, merged. */
export interface Census {
  readonly results: readonly CollectorResult[]
  /** Repo-relative file → test count, across all runners. */
  readonly counts: Readonly<Record<string, number>>
  readonly doubleCounted: readonly DoubleCounted[]
}

/**
 * Ask every runner, and merge.
 *
 * A file claimed by two runners is reported rather than summed. It would mean
 * the vitest and pact include globs overlap, and the honest reading of that is
 * "the configuration is wrong", not "this file has twice as many tests".
 */
export function collectCensus(): Census {
  const outputDir = mkdtempSync(join(tmpdir(), 'shape-census-'))

  try {
    const results = [
      collectVitest(null, outputDir),
      collectVitest('pact/vitest.config.ts', outputDir),
      collectPlaywright(outputDir),
    ]

    const counts: Record<string, number> = {}
    const owners = new Map<string, string[]>()

    for (const result of results) {
      for (const [file, count] of Object.entries(result.counts)) {
        counts[file] = (counts[file] ?? 0) + count
        owners.set(file, [...(owners.get(file) ?? []), result.runner])
      }
    }

    const doubleCounted = [...owners]
      .filter(([, runners]) => runners.length > 1)
      .map(([file, runners]) => ({ file, runners }))

    return { results, counts, doubleCounted }
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
}
