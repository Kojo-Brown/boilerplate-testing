import { describe, expect, it } from 'vitest'

import { STICKY_MARKER } from './comment.ts'
import {
  describeOutcome,
  findStickyComment,
  postStickyComment,
  targetFromEnv,
  type FetchLike,
  type PostTarget,
} from './post.ts'

interface Call {
  readonly url: string
  readonly method: string
  readonly body?: string
  readonly headers: Record<string, string>
}

interface Stub {
  readonly fetch: FetchLike
  readonly calls: Call[]
}

/** A fetch that replays the given responses in order. */
function stubFetch(responses: readonly { status: number; body: string }[]): Stub {
  const calls: Call[] = []
  let index = 0

  const fetch: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) })
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1

    return Promise.resolve({
      status: response?.status ?? 500,
      text: () => Promise.resolve(response?.body ?? ''),
    })
  }

  return { fetch, calls }
}

const target: PostTarget = {
  owner: 'octo',
  repo: 'demo',
  pullNumber: 7,
  token: 'mock-github-token',
}

describe('findStickyComment', () => {
  it('finds the comment carrying the marker', async () => {
    const stub = stubFetch([
      {
        status: 200,
        body: JSON.stringify([
          { id: 1, body: 'unrelated' },
          { id: 2, body: `${STICKY_MARKER}\nold table` },
        ]),
      },
    ])

    await expect(
      findStickyComment(stub.fetch, { ...target, token: 'mock-github-token', pullNumber: 7 }),
    ).resolves.toBe(2)
  })

  it('returns null when no comment carries the marker', async () => {
    const stub = stubFetch([{ status: 200, body: JSON.stringify([{ id: 1, body: 'hello' }]) }])

    await expect(
      findStickyComment(stub.fetch, { ...target, token: 'mock-github-token', pullNumber: 7 }),
    ).resolves.toBeNull()
  })

  it('tolerates a comment with no body at all', async () => {
    const stub = stubFetch([{ status: 200, body: JSON.stringify([{ id: 1 }]) }])

    await expect(
      findStickyComment(stub.fetch, { ...target, token: 'mock-github-token', pullNumber: 7 }),
    ).resolves.toBeNull()
  })

  // A busy pull request runs past one page, and the sticky comment is the
  // oldest match — so stopping at page one would duplicate it every run.
  it('pages until it runs out of comments', async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: 'noise' }))
    const stub = stubFetch([
      { status: 200, body: JSON.stringify(full) },
      { status: 200, body: JSON.stringify([{ id: 200, body: `${STICKY_MARKER} here` }]) },
    ])

    await expect(
      findStickyComment(stub.fetch, { ...target, token: 'mock-github-token', pullNumber: 7 }),
    ).resolves.toBe(200)
    expect(stub.calls).toHaveLength(2)
    expect(stub.calls[1]?.url).toContain('page=2')
  })

  it('stops paging on a short page', async () => {
    const stub = stubFetch([{ status: 200, body: JSON.stringify([{ id: 1, body: 'x' }]) }])

    await findStickyComment(stub.fetch, { ...target, token: 'mock-github-token', pullNumber: 7 })

    expect(stub.calls).toHaveLength(1)
  })

  it('treats a 403 as "no comment" rather than an error', async () => {
    const stub = stubFetch([{ status: 403, body: 'forbidden' }])

    await expect(
      findStickyComment(stub.fetch, { ...target, token: 'mock-github-token', pullNumber: 7 }),
    ).resolves.toBeNull()
  })

  it('throws on an unexpected status, which is a broken workflow', async () => {
    const stub = stubFetch([{ status: 500, body: 'boom' }])

    await expect(
      findStickyComment(stub.fetch, { ...target, token: 'mock-github-token', pullNumber: 7 }),
    ).rejects.toThrow('500')
  })
})

describe('postStickyComment', () => {
  it('creates a comment when none exists', async () => {
    const stub = stubFetch([
      { status: 200, body: '[]' },
      { status: 201, body: JSON.stringify({ id: 99 }) },
    ])

    await expect(postStickyComment(stub.fetch, target, 'body')).resolves.toEqual({
      kind: 'created',
      id: 99,
    })
    expect(stub.calls[1]?.method).toBe('POST')
    expect(stub.calls[1]?.url).toBe('https://api.github.com/repos/octo/demo/issues/7/comments')
  })

  it('updates in place when one exists, rather than appending a second', async () => {
    const stub = stubFetch([
      { status: 200, body: JSON.stringify([{ id: 5, body: STICKY_MARKER }]) },
      { status: 200, body: JSON.stringify({ id: 5 }) },
    ])

    await expect(postStickyComment(stub.fetch, target, 'body')).resolves.toEqual({
      kind: 'updated',
      id: 5,
    })
    expect(stub.calls[1]?.method).toBe('PATCH')
    expect(stub.calls[1]?.url).toBe('https://api.github.com/repos/octo/demo/issues/comments/5')
  })

  it('sends the body as JSON', async () => {
    const stub = stubFetch([
      { status: 200, body: '[]' },
      { status: 201, body: JSON.stringify({ id: 1 }) },
    ])

    await postStickyComment(stub.fetch, target, 'the table')

    expect(JSON.parse(stub.calls[1]?.body ?? '{}')).toEqual({ body: 'the table' })
  })

  it('authorises with a bearer token and pins the API version', async () => {
    const stub = stubFetch([
      { status: 200, body: '[]' },
      { status: 201, body: JSON.stringify({ id: 1 }) },
    ])

    await postStickyComment(stub.fetch, target, 'x')

    expect(stub.calls[0]?.headers['authorization']).toBe('Bearer mock-github-token')
    expect(stub.calls[0]?.headers['x-github-api-version']).toBe('2022-11-28')
  })

  // The three expected environments. None of them may fail a build.
  it('skips when there is no pull request', async () => {
    const stub = stubFetch([])

    await expect(
      postStickyComment(stub.fetch, { ...target, pullNumber: null }, 'x'),
    ).resolves.toEqual({ kind: 'skipped', reason: 'no-pull-request' })
    expect(stub.calls).toHaveLength(0)
  })

  it('skips when there is no token', async () => {
    const stub = stubFetch([])

    await expect(postStickyComment(stub.fetch, { ...target, token: null }, 'x')).resolves.toEqual({
      kind: 'skipped',
      reason: 'no-token',
    })
    expect(stub.calls).toHaveLength(0)
  })

  it('treats an empty token as no token', async () => {
    const stub = stubFetch([])

    await expect(postStickyComment(stub.fetch, { ...target, token: '' }, 'x')).resolves.toEqual({
      kind: 'skipped',
      reason: 'no-token',
    })
  })

  // A fork's GITHUB_TOKEN is read-only whatever the permissions block says.
  it('reports a 403 as forbidden rather than throwing', async () => {
    const stub = stubFetch([
      { status: 200, body: '[]' },
      { status: 403, body: 'Resource not accessible by integration' },
    ])

    const outcome = await postStickyComment(stub.fetch, target, 'x')

    expect(outcome.kind).toBe('forbidden')
  })

  it('throws on a 5xx, which is not an expected environment', async () => {
    const stub = stubFetch([
      { status: 200, body: '[]' },
      { status: 502, body: 'bad gateway' },
    ])

    await expect(postStickyComment(stub.fetch, target, 'x')).rejects.toThrow('502')
  })

  it('throws when the posted comment comes back unparseable', async () => {
    const stub = stubFetch([
      { status: 200, body: '[]' },
      { status: 201, body: 'not json' },
    ])

    await expect(postStickyComment(stub.fetch, target, 'x')).rejects.toThrow('not JSON')
  })

  it('honours an enterprise API base', async () => {
    const stub = stubFetch([
      { status: 200, body: '[]' },
      { status: 201, body: JSON.stringify({ id: 1 }) },
    ])

    await postStickyComment(stub.fetch, { ...target, apiBase: 'https://ghe.invalid/api/v3' }, 'x')

    expect(stub.calls[0]?.url.startsWith('https://ghe.invalid/api/v3/')).toBe(true)
  })
})

describe('targetFromEnv', () => {
  it('splits GITHUB_REPOSITORY into owner and repo', () => {
    const resolved = targetFromEnv({ GITHUB_REPOSITORY: 'octo/demo', LH_PR_NUMBER: '7' })

    expect(resolved.owner).toBe('octo')
    expect(resolved.repo).toBe('demo')
    expect(resolved.pullNumber).toBe(7)
  })

  it('has no pull number when the variable is absent', () => {
    expect(targetFromEnv({ GITHUB_REPOSITORY: 'octo/demo' }).pullNumber).toBeNull()
  })

  it('has no pull number when the variable is empty', () => {
    expect(targetFromEnv({ LH_PR_NUMBER: '' }).pullNumber).toBeNull()
  })

  it('rejects a non-numeric pull number rather than sending NaN to GitHub', () => {
    expect(targetFromEnv({ LH_PR_NUMBER: '42/merge' }).pullNumber).toBeNull()
  })

  it('rejects zero and negatives', () => {
    expect(targetFromEnv({ LH_PR_NUMBER: '0' }).pullNumber).toBeNull()
    expect(targetFromEnv({ LH_PR_NUMBER: '-1' }).pullNumber).toBeNull()
  })

  it('reads the token', () => {
    expect(targetFromEnv({ GITHUB_TOKEN: 'mock-github-token' }).token).toBe('mock-github-token')
  })

  it('picks up GITHUB_API_URL for an enterprise host', () => {
    expect(targetFromEnv({ GITHUB_API_URL: 'https://ghe.invalid/api/v3' }).apiBase).toBe(
      'https://ghe.invalid/api/v3',
    )
  })

  it('leaves apiBase unset when GITHUB_API_URL is empty', () => {
    expect(targetFromEnv({ GITHUB_API_URL: '' }).apiBase).toBeUndefined()
  })
})

describe('describeOutcome', () => {
  it('names the comment id when it posted', () => {
    expect(describeOutcome({ kind: 'created', id: 3 })).toContain('3')
    expect(describeOutcome({ kind: 'updated', id: 3 })).toContain('3')
  })

  it('explains a 403 as the fork case rather than as a failure', () => {
    const message = describeOutcome({ kind: 'forbidden', detail: 'nope' })

    expect(message).toContain('fork')
    expect(message).toContain('read-only')
  })

  it('distinguishes the two skip reasons', () => {
    expect(describeOutcome({ kind: 'skipped', reason: 'no-pull-request' })).toContain('No pull request')
    expect(describeOutcome({ kind: 'skipped', reason: 'no-token' })).toContain('GITHUB_TOKEN')
  })
})
