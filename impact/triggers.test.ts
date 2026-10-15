// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { firedTriggers, globToRegExp, matchesGlob, REPO_TRIGGERS, FIXTURE_TRIGGERS } from './triggers.ts'

describe('the glob matcher', () => {
  it('matches a literal path exactly', () => {
    expect(matchesGlob('package.json', 'package.json')).toBe(true)
    expect(matchesGlob('src/package.json', 'package.json')).toBe(false)
  })

  it('keeps a single star inside one segment', () => {
    expect(matchesGlob('a/b.test.ts', 'a/*.test.ts')).toBe(true)
    expect(matchesGlob('a/b/c.test.ts', 'a/*.test.ts')).toBe(false)
  })

  it('crosses segments with a double star', () => {
    expect(matchesGlob('a/b/c/d.ts', 'a/**')).toBe(true)
  })

  // `a/**/b` meaning only `a/x/b` and not `a/b` is the mistake that makes a
  // trigger silently match nothing at the one depth that matters.
  it('matches zero intermediate segments for a double star in the middle', () => {
    expect(matchesGlob('tsconfig.json', '**/tsconfig*.json')).toBe(true)
    expect(matchesGlob('k6/tsconfig.k6.json', '**/tsconfig*.json')).toBe(true)
  })

  it('treats a dot as a literal rather than any character', () => {
    expect(matchesGlob('packageXjson', 'package.json')).toBe(false)
  })

  it('anchors at both ends', () => {
    expect(globToRegExp('a.ts').source).toBe('^a\\.ts$')
  })
})

describe('firing a trigger', () => {
  it('reports the trigger a changed lockfile fires', () => {
    expect(firedTriggers(['pnpm-lock.yaml'], REPO_TRIGGERS).map((trigger) => trigger.id)).toEqual(['lockfile'])
  })

  it('reports nothing for an ordinary source change', () => {
    expect(firedTriggers(['flake/history.ts'], REPO_TRIGGERS)).toEqual([])
  })

  it('reports every trigger a diff fires, in declaration order', () => {
    expect(
      firedTriggers(['pnpm-lock.yaml', 'package.json', '.github/workflows/ci.yml'], REPO_TRIGGERS).map(
        (trigger) => trigger.id,
      ),
    ).toEqual(['manifest', 'lockfile', 'workflows'])
  })

  it('fires on the selector itself, which cannot be trusted to analyse its own change', () => {
    expect(firedTriggers(['impact/select.ts'], REPO_TRIGGERS).map((trigger) => trigger.id)).toEqual(['impact'])
  })

  it('fires on the fixture setup file, the fault the fixture triggers exist for', () => {
    expect(firedTriggers(['setup.ts'], FIXTURE_TRIGGERS).map((trigger) => trigger.id)).toEqual(['fixture-setup'])
  })
})

describe('the declared triggers', () => {
  it('carry a reason each, because the list is the argument', () => {
    expect([...REPO_TRIGGERS, ...FIXTURE_TRIGGERS].filter((trigger) => trigger.why.trim() === '')).toEqual([])
  })

  it('are uniquely identified', () => {
    const ids = REPO_TRIGGERS.map((trigger) => trigger.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})
