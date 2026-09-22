/**
 * `playwright test --list`, as a function.
 *
 * `--list` resolves the config, loads every spec file, applies `--shard` and
 * prints what would run — without starting a browser, a web server, or a
 * single test body. That is what makes the sharding half of this directory
 * measurable in `pnpm test` on a machine with no browser installed at all,
 * next to `intercept/`, which needs one.
 *
 * The JSON reporter is used rather than `--list`'s line output because the
 * line output does not name the project, and the project is half of what a
 * shard assignment is.
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { testId } from './shard.ts'

const run = promisify(execFile)

/**
 * The CLI, resolved to the binary rather than reached through `pnpm exec`.
 *
 * `pnpm exec` adds about half a second of package-manager startup to a call
 * that takes under one, and this suite makes two dozen of them.
 */
const PLAYWRIGHT_BIN = fileURLToPath(new URL('../node_modules/.bin/playwright', import.meta.url))

/** Shape of the `--list --reporter=json` payload, narrowed to what is read here. */
interface JsonSuite {
  readonly file?: string
  readonly specs?: readonly { readonly title: string; readonly tests: readonly { readonly projectName: string }[] }[]
  readonly suites?: readonly JsonSuite[]
}

function collect(suite: JsonSuite, file: string, into: string[]): void {
  const path = suite.file ?? file

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      into.push(testId(test.projectName, path, spec.title))
    }
  }

  for (const child of suite.suites ?? []) {
    collect(child, path, into)
  }
}

export interface ListOptions {
  readonly config: string
  /** `--shard=k/n`, or omitted for the whole run. */
  readonly shard?: { readonly current: number; readonly total: number }
  readonly fullyParallel: boolean
  readonly projects: 'single' | 'matrix'
}

/** Run the real CLI and return the test ids it would run, in reported order. */
export async function listTests(options: ListOptions): Promise<string[]> {
  const args = ['test', '--config', options.config, '--list', '--reporter=json']

  if (options.shard) {
    args.push(`--shard=${options.shard.current}/${options.shard.total}`)
  }

  const { stdout } = await run(PLAYWRIGHT_BIN, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      FIXTURE_FULLY_PARALLEL: options.fullyParallel ? '1' : '0',
      FIXTURE_PROJECTS: options.projects,
      // `forbidOnly` and friends are CI-only behaviour, and nothing here is a
      // run. Unsetting it keeps the listing identical on a laptop and on a
      // runner, which is the whole basis for comparing it to a fixed model.
      CI: '',
    },
  })

  const parsed = JSON.parse(stdout) as { readonly suites?: readonly JsonSuite[] }
  const ids: string[] = []

  for (const suite of parsed.suites ?? []) {
    collect(suite, suite.file ?? '', ids)
  }

  return ids
}
