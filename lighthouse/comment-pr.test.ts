import { describe, expect, it } from 'vitest'

import { contextFromEnv, runUrl, shortSha } from './comment-pr.ts'

describe('shortSha', () => {
  it('abbreviates the commit to seven characters', () => {
    expect(shortSha({ GITHUB_SHA: 'a'.repeat(40) })).toBe('aaaaaaa')
  })

  it('says so when there is no commit, rather than rendering "undefined"', () => {
    expect(shortSha({})).toBe('working tree')
    expect(shortSha({ GITHUB_SHA: '' })).toBe('working tree')
  })
})

describe('runUrl', () => {
  it('builds the workflow run link from the Actions environment', () => {
    expect(
      runUrl({
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'octo/demo',
        GITHUB_RUN_ID: '123',
      }),
    ).toBe('https://github.com/octo/demo/actions/runs/123')
  })

  it('is undefined outside Actions, rather than a link to nowhere', () => {
    expect(runUrl({})).toBeUndefined()
    expect(runUrl({ GITHUB_SERVER_URL: 'https://github.com' })).toBeUndefined()
  })

  it('honours an enterprise server URL', () => {
    expect(
      runUrl({
        GITHUB_SERVER_URL: 'https://ghe.invalid',
        GITHUB_REPOSITORY: 'octo/demo',
        GITHUB_RUN_ID: '1',
      }),
    ).toContain('https://ghe.invalid/')
  })
})

describe('contextFromEnv', () => {
  it('carries the URLs and run count through', () => {
    const context = contextFromEnv({}, ['http://localhost/'], 3)

    expect(context.urls).toEqual(['http://localhost/'])
    expect(context.runs).toBe(3)
  })

  // exactOptionalPropertyTypes: the key must be absent, not set to undefined,
  // or the comment renders an empty link.
  it('omits runUrl entirely when there is no run to link', () => {
    expect('runUrl' in contextFromEnv({}, [], 1)).toBe(false)
  })

  it('includes runUrl when the environment supplies one', () => {
    const context = contextFromEnv(
      {
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'octo/demo',
        GITHUB_RUN_ID: '9',
      },
      [],
      1,
    )

    expect(context.runUrl).toBe('https://github.com/octo/demo/actions/runs/9')
  })
})
