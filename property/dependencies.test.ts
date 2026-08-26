// @vitest-environment node
//
// Reads package.json off disk, so it needs a filesystem rather than a DOM.

/**
 * The dependency pin the measurements in this directory rest on.
 *
 * Every number in `README.md` — the overlap percentages, the shrink sizes, the
 * detection matrix, the situation-pair counts — is a property of one seed run
 * through one generator. The seed is written down in `config.ts`. The
 * generator is fast-check, and the value stream it derives from a seed is not
 * part of its public API: it changes between minor releases whenever the
 * library improves its distributions, which it does regularly and for good
 * reasons.
 *
 * A caret range would therefore make this directory's documentation correct on
 * the commit that recorded it and quietly wrong after the next automated
 * dependency bump, with a red build and no explanation. The pin is the
 * alternative, and it comes with an obligation rather than a free lunch:
 * upgrading fast-check here means re-running the measurements and updating the
 * README in the same commit. This test is what makes that obligation visible
 * to whoever removes the pin.
 *
 * It deliberately does not pin anything else. Every other measurement-bearing
 * suite in this repository reads files or runs a linter, both of which are
 * stable across a patch bump; a pseudo-random generator is the one dependency
 * whose *output* is the thing being depended on.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

const dependencyRange = (name: string): string | undefined => {
  if (typeof manifest !== 'object' || manifest === null) {
    return undefined
  }

  const { dependencies, devDependencies } = manifest as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  return dependencies?.[name] ?? devDependencies?.[name]
}

describe('fast-check', () => {
  it('is declared as a dependency of this repository', () => {
    expect(dependencyRange('fast-check')).toEqual(expect.any(String))
  })

  it('is pinned to one exact version, with no range operator', () => {
    // `^4.9.0` would let a minor bump change the generated value stream, and
    // with it every measurement in property/README.md.
    expect(dependencyRange('fast-check')).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('is the version the measurements were taken against', () => {
    expect(dependencyRange('fast-check')).toBe('4.9.0')
  })
})

describe('the rest of the manifest', () => {
  it('leaves other dependencies on ranges, since only this one is depended on for its output', () => {
    // Stated so the pin above reads as a decision about fast-check rather than
    // as the beginning of a policy nobody agreed to.
    expect(dependencyRange('vitest')).toMatch(/^\^/)
    expect(dependencyRange('typescript')).toMatch(/^\^/)
  })
})
