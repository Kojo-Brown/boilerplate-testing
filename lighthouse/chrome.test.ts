import { describe, expect, it } from 'vitest'

import { resolveChrome } from './chrome.ts'

/** A path that certainly exists on any machine running this suite. */
const REAL_PATH = process.execPath

describe('resolveChrome', () => {
  it('prefers CHROME_PATH when it points at something that exists', () => {
    expect(resolveChrome({ CHROME_PATH: REAL_PATH })).toEqual({
      path: REAL_PATH,
      source: 'CHROME_PATH',
    })
  })

  // The bug this check exists for: `chromium.executablePath()` reports the path
  // for the revision Playwright pins whether or not it was downloaded, so a
  // machine with a different revision installed gets a path that is not there.
  it('ignores a CHROME_PATH that does not exist', () => {
    expect(resolveChrome({ CHROME_PATH: '/nope/chrome' }).source).toBe('chrome-launcher')
  })

  it('ignores an empty CHROME_PATH', () => {
    expect(resolveChrome({ CHROME_PATH: '' }).source).toBe('chrome-launcher')
  })

  it('falls back to Playwright when its browser is on disk', () => {
    expect(resolveChrome({}, () => REAL_PATH)).toEqual({ path: REAL_PATH, source: 'playwright' })
  })

  it('ignores a Playwright path that is not on disk', () => {
    expect(resolveChrome({}, () => '/nope/pw-chrome').source).toBe('chrome-launcher')
  })

  it('ignores Playwright throwing, which is what an absent install looks like', () => {
    expect(
      resolveChrome({}, () => {
        throw new Error('not installed')
      }).source,
    ).toBe('chrome-launcher')
  })

  it('hands off to chrome-launcher with no path when nothing else resolved', () => {
    expect(resolveChrome({})).toEqual({ path: null, source: 'chrome-launcher' })
  })

  it('prefers CHROME_PATH over Playwright when both exist', () => {
    expect(resolveChrome({ CHROME_PATH: REAL_PATH }, () => REAL_PATH).source).toBe('CHROME_PATH')
  })
})
