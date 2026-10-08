#!/usr/bin/env node
/**
 * `pnpm lighthouse:comment` — turn the last Lighthouse CI run into a PR comment.
 *
 * Runs after `pnpm lighthouse:ci`, reading the `assertion-results.json` that
 * run left in `.lighthouseci/`. Deliberately **not** a gate: `lhci autorun`
 * has already decided red or green by its own exit code, and a reporter that
 * can also fail the build gives a budget comment two jobs and makes the second
 * one everybody's problem. So this exits 0 whenever it managed to say
 * something, including when it had nobody to say it to.
 *
 * It exits non-zero for exactly one class of thing: being unable to do its job
 * at all — no results file, malformed results, an unexpected GitHub status.
 * Those are a broken workflow rather than a slow page.
 *
 * The body is printed to the log either way. A comment that could not be posted
 * — a fork's read-only token, a `push` build, a consumer who copied the
 * workflow without its `permissions:` block — should not take the table with
 * it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { renderComment, type CommentContext } from './comment.ts'
import { loadBudgets } from './load.ts'
import { buildBudgetReport, parseAssertionResults } from './report.ts'
import { describeOutcome, postStickyComment, targetFromEnv, type FetchLike } from './post.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** `lighthouserc.cjs` is CommonJS and has to be loaded as such. */
const require = createRequire(import.meta.url)

/** Where `lhci` writes its assertion results, relative to the repository root. */
export const RESULTS_PATH = join(here, '..', '.lighthouseci', 'assertion-results.json')

/** The audited URLs, as `lighthouserc.cjs` resolved them. */
function auditedUrls(): { urls: string[]; runs: number } {
  // Required through the same path LHCI uses, so `LH_URLS` is honoured here
  // exactly as it was during the run rather than guessed at.
  const rc = require(join(here, 'lighthouserc.cjs')) as {
    ci?: { collect?: { url?: string[]; numberOfRuns?: number } }
  }

  return { urls: rc.ci?.collect?.url ?? [], runs: rc.ci?.collect?.numberOfRuns ?? 1 }
}

export function shortSha(env: Readonly<Record<string, string | undefined>>): string {
  const sha = env['GITHUB_SHA']
  return sha === undefined || sha === '' ? 'working tree' : sha.slice(0, 7)
}

export function runUrl(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const server = env['GITHUB_SERVER_URL']
  const repo = env['GITHUB_REPOSITORY']
  const id = env['GITHUB_RUN_ID']

  if (server === undefined || repo === undefined || id === undefined) return undefined
  return `${server}/${repo}/actions/runs/${id}`
}

export function contextFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  urls: readonly string[],
  runs: number,
): CommentContext {
  const link = runUrl(env)
  const context: CommentContext = { sha: shortSha(env), runs, urls }

  return link === undefined ? context : { ...context, runUrl: link }
}

async function main(): Promise<void> {
  const resultsPath = resolve(process.argv[2] ?? RESULTS_PATH)

  if (!existsSync(resultsPath)) {
    process.stderr.write(
      `No assertion results at ${resultsPath}.\nRun \`pnpm lighthouse:ci\` first — this command reports on that run rather than performing one.\n`,
    )
    process.exitCode = 1
    return
  }

  const results = parseAssertionResults(readFileSync(resultsPath, 'utf8'), resultsPath)
  const { urls, runs } = auditedUrls()
  const report = buildBudgetReport(loadBudgets(), results)
  const body = renderComment(report, contextFromEnv(process.env, urls, runs))

  // Before the post, not after: if GitHub refuses, the table is already out.
  process.stdout.write(`${body}\n\n`)

  const outcome = await postStickyComment(
    globalThis.fetch as unknown as FetchLike,
    targetFromEnv(process.env),
    body,
  )

  process.stdout.write(`${describeOutcome(outcome)}\n`)
}

// Guarded, because `comment-pr.test.ts` imports the helpers above: without it,
// importing this module runs the whole reporter as a side effect of collecting
// a test file.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
