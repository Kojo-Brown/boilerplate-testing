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
  type Manifest,
} from './patchedDeps'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

/** A manifest with one documented, well-formed patch pin. */
function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    devDependencies: { storybook: '^10.5.5' },
    pnpm: { patchedDependencies: { 'storybook@10.5.5': 'patches/storybook@10.5.5.patch' } },
    ...overrides,
  }
}

const installed = (version: string) => () => version
const fileExists = () => true

// ---------------------------------------------------------------------------
// parsePatchPins
// ---------------------------------------------------------------------------

describe('parsePatchPins', () => {
  it('splits a name@version key', () => {
    expect(parsePatchPins(manifest())).toEqual([
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
  it('accepts a documented, pinned, installed patch', () => {
    expect(findPatchProblems(manifest(), installed('10.5.5'), fileExists)).toEqual([])
  })

  it('reports a pin that no longer matches the installed version', () => {
    const problems = findPatchProblems(manifest(), installed('10.5.6'), fileExists)
    expect(problems).toEqual([
      {
        kind: 'version-drift',
        pin: { name: 'storybook', version: '10.5.5', file: 'patches/storybook@10.5.5.patch' },
        installed: '10.5.6',
      },
    ])
  })

  it('reports a missing patch file', () => {
    const problems = findPatchProblems(manifest(), installed('10.5.5'), () => false)
    expect(problems.map((p) => p.kind)).toEqual(['missing-patch-file'])
  })

  it('reports a version-less key, and does not also claim it drifted', () => {
    const pins = { storybook: 'patches/storybook.patch' }
    const problems = findPatchProblems(
      manifest({ pnpm: { patchedDependencies: pins } }),
      installed('10.5.5'),
      fileExists,
    )
    expect(problems.map((p) => p.kind)).toEqual(['unpinned-version'])
  })

  it('reports a patch for a package the manifest does not depend on', () => {
    const problems = findPatchProblems(
      manifest({ devDependencies: {} }),
      installed('10.5.5'),
      fileExists,
    )
    expect(problems.map((p) => p.kind)).toEqual(['not-a-dependency'])
  })

  it('reports a patch with no recorded reason', () => {
    const problems = findPatchProblems(
      {
        devDependencies: { vite: '^7.0.0' },
        pnpm: { patchedDependencies: { 'vite@7.3.6': 'patches/vite@7.3.6.patch' } },
      },
      installed('7.3.6'),
      fileExists,
    )
    // The storybook reason is orphaned in this fixture because nothing pins it.
    expect(problems.map((p) => p.kind).sort()).toEqual(['orphaned-reason', 'undocumented'])
  })

  it('tolerates a package that cannot be resolved rather than inventing drift', () => {
    // `pnpm test` runs after `pnpm install`, but a partially-installed tree
    // should fail on the missing dependency, not on a bogus drift report.
    expect(findPatchProblems(manifest(), () => null, fileExists)).toEqual([])
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
})
