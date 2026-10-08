/**
 * Posting the budget comment, and the three ways that goes wrong.
 *
 * ---------------------------------------------------------------------------
 * Why this is not two lines of `curl` in the workflow
 * ---------------------------------------------------------------------------
 * Lighthouse CI has a GitHub integration, and it does not do this. Its only
 * GitHub write is `POST /repos/{slug}/statuses/{sha}` — a **commit status**,
 * not a comment (`@lhci/cli/src/upload/upload.js`, `postStatusToGitHub`). That
 * is why `LHCI_GITHUB_APP_TOKEN` cannot satisfy this item: a status is a row in
 * the checks list with a 140-character description, and the budget table does
 * not fit in it.
 *
 * So the comment is ours, and the interesting part is not the POST. It is that
 * **a budget comment must never be the reason a build fails**. Three things
 * routinely stop it being posted, none of which says anything about the code
 * under review:
 *
 *   1. **A pull request from a fork.** `GITHUB_TOKEN` is read-only on
 *      `pull_request` runs from a fork, whatever the workflow's `permissions:`
 *      block says, so the POST comes back 403. This is the common case for an
 *      open-source template repository — the one this directory ships for.
 *   2. **No pull request.** The same workflow runs on `push` to the default
 *      branch, where there is no issue to comment on.
 *   3. **A missing or unreadable token**, which is what a consumer who copies
 *      the workflow without the `permissions:` block gets.
 *
 * In all three the gate's verdict still matters and is still reported by the
 * step's exit code; only the comment is lost. {@link postStickyComment}
 * therefore returns an outcome rather than throwing, and `check.ts` prints the
 * body to the log when it could not be posted so the information is not lost
 * with it. A 5xx or a malformed response *does* throw: that is a broken
 * workflow rather than an expected environment.
 *
 * `fetch` is injected so every branch above is a unit test rather than a thing
 * we hope is handled.
 */

import { STICKY_MARKER } from './comment.ts'

/** The subset of `fetch` this module uses, so tests can supply one. */
export type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
  },
) => Promise<FetchLikeResponse>

export interface FetchLikeResponse {
  readonly status: number
  text(): Promise<string>
}

export interface PostTarget {
  readonly owner: string
  readonly repo: string
  /** The pull request number, or `null` on a push build. */
  readonly pullNumber: number | null
  readonly token: string | null
  /** Override for GitHub Enterprise. */
  readonly apiBase?: string
}

export type PostOutcome =
  | { kind: 'created'; id: number }
  | { kind: 'updated'; id: number }
  | { kind: 'skipped'; reason: 'no-pull-request' | 'no-token' }
  | { kind: 'forbidden'; detail: string }

const DEFAULT_API_BASE = 'https://api.github.com'

/** An existing issue comment, to the depth this module reads. */
interface IssueComment {
  readonly id: number
  readonly body?: string
}

function headersFor(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'boilerplate-testing-lighthouse-budgets',
  }
}

/**
 * Find the comment this job owns, by marker.
 *
 * Paginates: a long-running pull request can carry more than one page of
 * comments, and the sticky comment is the *oldest* matching one — it was
 * created on the first run — so a search that only looked at the last page
 * would create a duplicate on every busy pull request.
 */
export async function findStickyComment(
  fetchImpl: FetchLike,
  target: PostTarget & { token: string; pullNumber: number },
): Promise<number | null> {
  const base = target.apiBase ?? DEFAULT_API_BASE
  const perPage = 100

  for (let page = 1; page <= 10; page += 1) {
    const url = `${base}/repos/${target.owner}/${target.repo}/issues/${target.pullNumber}/comments?per_page=${perPage}&page=${page}`
    const response = await fetchImpl(url, { method: 'GET', headers: headersFor(target.token) })

    if (response.status === 403 || response.status === 404) return null
    if (response.status !== 200) {
      throw new Error(`GitHub returned ${response.status} listing comments: ${await response.text()}`)
    }

    const body = await response.text()
    let comments: IssueComment[]
    try {
      comments = JSON.parse(body) as IssueComment[]
    } catch {
      throw new Error('GitHub returned a comment list that is not JSON')
    }

    const match = comments.find((comment) => comment.body?.includes(STICKY_MARKER) === true)
    if (match !== undefined) return match.id
    if (comments.length < perPage) return null
  }

  return null
}

/**
 * Create or update the budget comment.
 *
 * Returns what happened. Never throws for the three expected environments
 * documented at the top of this file.
 */
export async function postStickyComment(
  fetchImpl: FetchLike,
  target: PostTarget,
  body: string,
): Promise<PostOutcome> {
  if (target.pullNumber === null) return { kind: 'skipped', reason: 'no-pull-request' }
  if (target.token === null || target.token === '') return { kind: 'skipped', reason: 'no-token' }

  const resolved = { ...target, token: target.token, pullNumber: target.pullNumber }
  const base = target.apiBase ?? DEFAULT_API_BASE
  const existing = await findStickyComment(fetchImpl, resolved)

  const url =
    existing === null
      ? `${base}/repos/${target.owner}/${target.repo}/issues/${target.pullNumber}/comments`
      : `${base}/repos/${target.owner}/${target.repo}/issues/comments/${existing}`

  const response = await fetchImpl(url, {
    method: existing === null ? 'POST' : 'PATCH',
    headers: headersFor(resolved.token),
    body: JSON.stringify({ body }),
  })

  if (response.status === 403) return { kind: 'forbidden', detail: await response.text() }

  // 201 for a create, 200 for an update.
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`GitHub returned ${response.status} posting the comment: ${await response.text()}`)
  }

  const text = await response.text()
  let posted: IssueComment
  try {
    posted = JSON.parse(text) as IssueComment
  } catch {
    throw new Error('GitHub returned a comment that is not JSON')
  }

  return existing === null ? { kind: 'created', id: posted.id } : { kind: 'updated', id: posted.id }
}

/**
 * Read the post target out of the environment a GitHub Actions job provides.
 *
 * `GITHUB_REPOSITORY` is `owner/repo`. The pull request number is not in a
 * variable of its own: it has to come from the event payload, which is why the
 * workflow passes it explicitly as `LH_PR_NUMBER`. Reading
 * `GITHUB_REF_NAME` (`"42/merge"`) instead would be one fewer line in the
 * workflow and wrong on `push`, on `workflow_dispatch`, and on a merge group.
 */
export function targetFromEnv(env: Readonly<Record<string, string | undefined>>): PostTarget {
  const [owner = '', repo = ''] = (env['GITHUB_REPOSITORY'] ?? '').split('/')
  const raw = env['LH_PR_NUMBER']
  const parsed = raw === undefined || raw === '' ? Number.NaN : Number(raw)

  const target: PostTarget = {
    owner,
    repo,
    pullNumber: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    token: env['GITHUB_TOKEN'] ?? null,
  }

  const apiBase = env['GITHUB_API_URL']
  return apiBase === undefined || apiBase === '' ? target : { ...target, apiBase }
}

/** One line for the CI log, so the outcome is visible without the comment. */
export function describeOutcome(outcome: PostOutcome): string {
  switch (outcome.kind) {
    case 'created':
      return `Posted budget comment (id ${outcome.id}).`
    case 'updated':
      return `Updated budget comment (id ${outcome.id}).`
    case 'skipped':
      return outcome.reason === 'no-pull-request'
        ? 'No pull request for this run — budget comment skipped.'
        : 'No GITHUB_TOKEN — budget comment skipped.'
    case 'forbidden':
      return 'GitHub refused the comment (403). This is expected for a pull request from a fork, where GITHUB_TOKEN is read-only. The table is printed above instead.'
  }
}
