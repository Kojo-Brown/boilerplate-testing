/**
 * The files that invalidate the whole idea.
 *
 * ---------------------------------------------------------------------------
 * Why a selector needs an escape hatch
 * ---------------------------------------------------------------------------
 * A dependency graph answers one question: which files would notice if this
 * file changed? For most of a repository that is the right question. For a
 * handful of files it is the wrong one, because they reach every test by a
 * route that is not an import:
 *
 *   - **The runner's config** decides the environment, the globals, the
 *     reporters and the pool. Nothing imports it.
 *   - **Setup files** run before every test file. Named by the config, not
 *     imported by the tests. `fixture/setup.ts` is this case, and the
 *     `setup-matcher` fault shows what missing it costs: a change that breaks
 *     all six suites, a selection of nothing, and a green run.
 *   - **The lockfile and the manifest** change what the code under test *is*.
 *     An upgraded dependency touches no source file at all.
 *   - **The compiler and linter configs** decide whether the code compiles.
 *   - **The workflow files** decide what runs. A selector that does not rerun
 *     everything when the thing doing the selecting changes is reporting on a
 *     pipeline that no longer exists.
 *
 * Each of these is cheap to list and expensive to forget, and the asymmetry is
 * the argument for a list: forgetting one costs a silent miss, and adding one
 * too many costs a full run that was already the status quo.
 *
 * ---------------------------------------------------------------------------
 * Why a hand-written matcher
 * ---------------------------------------------------------------------------
 * The patterns need `**`, `*` and a literal path, and nothing else. A
 * dependency for that would be a dependency this directory's own argument
 * about dependency changes then applies to, and `globToRegExp` is fifteen
 * lines.
 */

export interface Trigger {
  readonly id: string
  /** A glob: `*` matches within a segment, `**` across segments. */
  readonly pattern: string
  /** The route by which this file reaches tests that no import records. */
  readonly why: string
}

/**
 * This repository's triggers.
 *
 * Audited by `check.ts`: a pattern that matches no tracked file fails the
 * gate, because a trigger that matches nothing is indistinguishable from a
 * trigger that is working until the day it is needed.
 */
export const REPO_TRIGGERS: readonly Trigger[] = [
  { id: 'manifest', pattern: 'package.json', why: 'scripts, dependency ranges and the pnpm settings every gate runs under' },
  { id: 'lockfile', pattern: 'pnpm-lock.yaml', why: 'the resolved versions of everything under test' },
  { id: 'patches', pattern: 'patches/**', why: 'a patched dependency changes the code under test without changing a source file' },
  { id: 'tsconfig', pattern: '**/tsconfig*.json', why: 'compiler options and path aliases: the typecheck gate in one file' },
  { id: 'eslint', pattern: 'eslint.config.js', why: 'the lint gate, which runs over every file' },
  { id: 'vitest-config', pattern: '**/vitest*.config.ts', why: 'the environment, globals, setup files and exclude list of the unit run' },
  { id: 'vitest-setup', pattern: 'vitest/setup.ts', why: 'loaded before every unit test file; imported by none of them' },
  { id: 'playwright-config', pattern: '**/playwright*.config.ts', why: 'projects, fixtures and web servers for every browser suite' },
  { id: 'workflows', pattern: '.github/workflows/**', why: 'what CI runs, including this selection' },
  { id: 'impact', pattern: 'impact/**', why: 'the selector itself: its own change is the one it cannot be trusted to analyse' },
]

/** The fixture's triggers: the same shape, scoped to the subject. */
export const FIXTURE_TRIGGERS: readonly Trigger[] = [
  { id: 'fixture-config', pattern: 'vitest.config.ts', why: 'the fixture runner: include globs, environment and setup files' },
  { id: 'fixture-setup', pattern: 'setup.ts', why: 'the shared matcher, loaded before every fixture test' },
]

/** Compile a glob to an anchored regular expression. `**` crosses `/`, `*` does not. */
export function globToRegExp(pattern: string): RegExp {
  let source = ''

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? ''

    if (character === '*') {
      if (pattern[index + 1] === '*') {
        // `a/**/b` must also match `a/b`, so the slash that follows is
        // optional rather than required.
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 2
          continue
        }

        source += '.*'
        index += 1
        continue
      }

      source += '[^/]*'
      continue
    }

    if (character === '?') {
      source += '[^/]'
      continue
    }

    source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }

  return new RegExp(`^${source}$`)
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path)
}

/** The triggers a set of changed paths fires, in the order they are declared. */
export function firedTriggers(paths: readonly string[], triggers: readonly Trigger[]): readonly Trigger[] {
  return triggers.filter((trigger) => paths.some((path) => matchesGlob(path, trigger.pattern)))
}
