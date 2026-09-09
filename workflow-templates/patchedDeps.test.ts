// @vitest-environment node
//
// Like actionPins.test.ts and gateSteps.test.ts, this suite reads files off
// disk and resolves them relative to `import.meta.url`. Under the
// project-default jsdom environment that URL is rewritten to an http: one and
// `fileURLToPath` throws, so this file opts back into the node environment.

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  parsePatchPins,
  findPatchProblems,
  formatPatchProblem,
  PATCH_REASONS,
  TRANSITIVE_PATCHES,
  type Manifest,
} from './patchedDeps'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

/**
 * A manifest carrying every patch this repository actually applies.
 *
 * It has to carry all of them, because two of the rules — `orphaned-reason`
 * and `orphaned-parent` — compare module-level tables against the *given*
 * manifest, so a fixture pinning a subset reports the rest as orphans. That is
 * the rules working, not a fixture problem: an entry in either table with
 * nothing pinning it is exactly what they are for.
 */
function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    devDependencies: { storybook: '^10.5.5', '@pact-foundation/pact': '^13.0.0' },
    pnpm: {
      patchedDependencies: {
        'storybook@10.5.5': 'patches/storybook@10.5.5.patch',
        'http-proxy@1.18.1': 'patches/http-proxy@1.18.1.patch',
      },
    },
    ...overrides,
  }
}

/** Installed versions by package name; anything unlisted is unresolvable. */
const installedVersions =
  (versions: Record<string, string>) =>
  (name: string): string | null =>
    versions[name] ?? null

/** The versions the fixture's pins name. */
const installed = () =>
  installedVersions({ storybook: '10.5.5', 'http-proxy': '1.18.1' })

const fileExists = () => true

/** Problems about one package, so a test can speak about one pin. */
const about = (name: string) => (problem: { pin?: { name: string }; name?: string }) =>
  (problem.pin?.name ?? problem.name) === name

// ---------------------------------------------------------------------------
// parsePatchPins
// ---------------------------------------------------------------------------

describe('parsePatchPins', () => {
  it('splits a name@version key', () => {
    const pins = parsePatchPins({
      pnpm: { patchedDependencies: { 'storybook@10.5.5': 'patches/storybook@10.5.5.patch' } },
    })
    expect(pins).toEqual([
      { name: 'storybook', version: '10.5.5', file: 'patches/storybook@10.5.5.patch' },
    ])
  })

  it('splits on the last @ so a scoped name keeps its own', () => {
    const pins = parsePatchPins({
      pnpm: { patchedDependencies: { '@storybook/react@10.5.5': 'patches/p.patch' } },
    })
    expect(pins).toEqual([
      { name: '@storybook/react', version: '10.5.5', file: 'patches/p.patch' },
    ])
  })

  it('reads a scoped, version-less key as a name with no pin', () => {
    const pins = parsePatchPins({
      pnpm: { patchedDependencies: { '@storybook/react': 'patches/p.patch' } },
    })
    expect(pins).toEqual([{ name: '@storybook/react', version: null, file: 'patches/p.patch' }])
  })

  it('is empty when nothing is patched', () => {
    expect(parsePatchPins({})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findPatchProblems
// ---------------------------------------------------------------------------

describe('findPatchProblems', () => {
  it('accepts documented, pinned, installed patches', () => {
    expect(findPatchProblems(manifest(), installed(), fileExists)).toEqual([])
  })

  it('reports a pin that no longer matches the installed version', () => {
    const drifted = installedVersions({ storybook: '10.5.6', 'http-proxy': '1.18.1' })
    expect(findPatchProblems(manifest(), drifted, fileExists)).toEqual([
      {
        kind: 'version-drift',
        pin: { name: 'storybook', version: '10.5.5', file: 'patches/storybook@10.5.5.patch' },
        installed: '10.5.6',
      },
    ])
  })

  it('reports a missing patch file for every pin that has one', () => {
    const problems = findPatchProblems(manifest(), installed(), () => false)
    expect(problems.map((p) => p.kind)).toEqual(['missing-patch-file', 'missing-patch-file'])
  })

  it('reports a version-less key, and does not also claim it drifted', () => {
    const problems = findPatchProblems(
      manifest({
        pnpm: {
          patchedDependencies: {
            storybook: 'patches/storybook.patch',
            'http-proxy@1.18.1': 'patches/http-proxy@1.18.1.patch',
          },
        },
      }),
      installed(),
      fileExists,
    )
    expect(problems.map((p) => p.kind)).toEqual(['unpinned-version'])
  })

  it('reports a patch for a package the manifest does not depend on', () => {
    const problems = findPatchProblems(
      manifest({ devDependencies: { '@pact-foundation/pact': '^13.0.0' } }),
      installed(),
      fileExists,
    )
    expect(problems.filter(about('storybook')).map((p) => p.kind)).toEqual(['not-a-dependency'])
  })

  it('reports a transitive patch whose parent the manifest does not depend on', () => {
    // `http-proxy` is never declared here and must not be: what the rule
    // checks for it is the package that pulls it in.
    const problems = findPatchProblems(
      manifest({ devDependencies: { storybook: '^10.5.5' } }),
      installed(),
      fileExists,
    )
    expect(problems.filter(about('http-proxy'))).toEqual([
      {
        kind: 'unknown-parent',
        pin: {
          name: 'http-proxy',
          version: '1.18.1',
          file: 'patches/http-proxy@1.18.1.patch',
        },
        via: '@pact-foundation/pact',
      },
    ])
  })

  it('does not ask a transitive patch to be a direct dependency', () => {
    // The regression this rule was widened for: before `TRANSITIVE_PATCHES`,
    // the only way to patch `http-proxy` was to declare a dependency on it
    // that nothing imports.
    const problems = findPatchProblems(manifest(), installed(), fileExists)
    expect(problems.map((p) => p.kind)).not.toContain('not-a-dependency')
  })

  it('reports a patch with no recorded reason', () => {
    const problems = findPatchProblems(
      {
        devDependencies: { vite: '^7.0.0' },
        pnpm: { patchedDependencies: { 'vite@7.3.6': 'patches/vite@7.3.6.patch' } },
      },
      installedVersions({ vite: '7.3.6' }),
      fileExists,
    )
    // Both recorded reasons are orphaned in this fixture because nothing pins
    // them, and so is the one transitive parent.
    expect(problems.map((p) => p.kind).sort()).toEqual([
      'orphaned-parent',
      'orphaned-reason',
      'orphaned-reason',
      'undocumented',
    ])
  })

  it('tolerates a package that cannot be resolved rather than inventing drift', () => {
    // `pnpm test` runs after `pnpm install`, but a partially-installed tree
    // should fail on the missing dependency, not on a bogus drift report.
    expect(findPatchProblems(manifest(), () => null, fileExists)).toEqual([])
  })
})

describe('TRANSITIVE_PATCHES', () => {
  it('names a parent only for packages the repository does not declare', () => {
    // An entry here for a package the repository declares would make the
    // `not-a-dependency` rule unreachable for it.
    const real = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Manifest
    const declared = new Set([
      ...Object.keys(real.dependencies ?? {}),
      ...Object.keys(real.devDependencies ?? {}),
    ])
    for (const name of Object.keys(TRANSITIVE_PATCHES)) {
      expect(declared.has(name), `${name} is a direct dependency`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// formatPatchProblem
// ---------------------------------------------------------------------------

describe('formatPatchProblem', () => {
  const pin = { name: 'storybook', version: '10.5.5', file: 'patches/storybook@10.5.5.patch' }

  it('names both versions when a pin has drifted', () => {
    const message = formatPatchProblem({ kind: 'version-drift', pin, installed: '10.5.6' })
    expect(message).toContain('10.5.5')
    expect(message).toContain('10.5.6')
  })

  it('names the file that is missing', () => {
    expect(formatPatchProblem({ kind: 'missing-patch-file', pin })).toContain(pin.file)
  })

  it('names a package that has an unpinned patch', () => {
    const message = formatPatchProblem({ kind: 'unpinned-version', pin: { ...pin, version: null } })
    expect(message).toContain('"storybook"')
  })

  it('names the package whose reason is orphaned', () => {
    expect(formatPatchProblem({ kind: 'orphaned-reason', name: 'storybook' })).toContain('storybook')
  })

  it('names the parent a transitive patch could not find', () => {
    const message = formatPatchProblem({
      kind: 'unknown-parent',
      pin: { name: 'http-proxy', version: '1.18.1', file: 'patches/http-proxy@1.18.1.patch' },
      via: '@pact-foundation/pact',
    })
    expect(message).toContain('http-proxy@1.18.1')
    expect(message).toContain('@pact-foundation/pact')
  })

  it('names the package whose transitive parent is orphaned', () => {
    expect(formatPatchProblem({ kind: 'orphaned-parent', name: 'http-proxy' })).toContain(
      'http-proxy',
    )
  })
})

// ---------------------------------------------------------------------------
// The real manifest — this is the assertion the item exists for
// ---------------------------------------------------------------------------

describe('package.json patchedDependencies', () => {
  const real = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Manifest

  function installedVersionOf(name: string): string | null {
    try {
      const pkg = require(`${name}/package.json`) as { version: string }
      return pkg.version
    } catch {
      return null
    }
  }

  it('pins, documents and ships every patch it declares', () => {
    const problems = findPatchProblems(real, installedVersionOf, (file) =>
      existsSync(join(repoRoot, file)),
    )
    expect(problems.map(formatPatchProblem)).toEqual([])
  })

  it('still patches storybook, because the Build gate depends on it', () => {
    // Dropping the patch does not fail anything until CI reaches the Build
    // step on the Node 26 leg, so assert the pin directly. Delete this
    // expectation together with the patch when Storybook fixes DEP0205
    // upstream — not before.
    expect(parsePatchPins(real).map((pin) => pin.name)).toContain('storybook')
    expect(PATCH_REASONS.storybook).toContain('DEP0205')
  })

  it('still patches http-proxy, because the Contract gates depend on it', () => {
    // Same reasoning as the storybook pin above, one deprecation along:
    // without it `pnpm test:pact` reports every test passing and then fails
    // the job on an unhandled DEP0060 thrown inside pact-js's proxy. There is
    // no upstream fix to wait for — http-proxy 1.18.1 is the last release.
    expect(parsePatchPins(real).map((pin) => pin.name)).toContain('http-proxy')
    expect(PATCH_REASONS['http-proxy']).toContain('DEP0060')
    expect(TRANSITIVE_PATCHES['http-proxy']).toBe('@pact-foundation/pact')
  })
})
