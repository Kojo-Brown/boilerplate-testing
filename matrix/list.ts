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
 *
 * It is pointed at a *file* rather than read off stdout, which is what
 * `shape/collect.ts` already does — "stdout is discarded, the payload is the
 * file, so a progress banner or a deprecation notice cannot corrupt the
 * parse" — and which this directory earned the hard way. `merge.test.ts` was
 * green on a laptop and failed on CI parsing 145,872 characters with a 40,096-
 * character line in them; the report these commands actually write is 27 KB
 * pretty-printed with no line over 88 characters, so whatever CI read was not
 * only the report. Reading the file removes the question rather than answering
 * it, and that is the right trade for a measurement: stdout is a shared
 * channel and the report is not the only thing entitled to write to it.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/**
 * Read one of these reports, and say what went wrong when it cannot be read.
 *
 * A bare `JSON.parse` failure names a character offset and nothing else, which
 * is exactly the message that made the CI failure above take a detour. This
 * one names the file and shows both ends of what it found.
 */
export function parseReport<T>(outputFile: string): T {
  const raw = readFileSync(outputFile, 'utf8')

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    const head = raw.slice(0, 200)
    const tail = raw.length > 400 ? raw.slice(-200) : ''

    throw new Error(
      `${outputFile} is not the JSON report playwright was asked for ` +
        `(${raw.length} characters).\n` +
        `starts: ${JSON.stringify(head)}\n` +
        (tail === '' ? '' : `ends: ${JSON.stringify(tail)}\n`),
      { cause: error },
    )
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

  const scratch = mkdtempSync(join(tmpdir(), 'matrix-list-'))
  const outputFile = join(scratch, 'report.json')

  try {
    await run(PLAYWRIGHT_BIN, args, {
      encoding: 'utf8',
      // Whatever lands on stdout is read and thrown away: the payload is the
      // file. `execFile` has no `stdio` option to decline it with, so the
      // buffer is sized to hold anything the child cares to print.
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_NAME: outputFile,
        FIXTURE_FULLY_PARALLEL: options.fullyParallel ? '1' : '0',
        FIXTURE_PROJECTS: options.projects,
        // `forbidOnly` and friends are CI-only behaviour, and nothing here is
        // a run. Unsetting it keeps the listing identical on a laptop and on a
        // runner, which is the whole basis for comparing it to a fixed model.
        CI: '',
      },
    })

    const parsed = parseReport<{ readonly suites?: readonly JsonSuite[] }>(outputFile)
    const ids: string[] = []

    for (const suite of parsed.suites ?? []) {
      collect(suite, suite.file ?? '', ids)
    }

    return ids
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
