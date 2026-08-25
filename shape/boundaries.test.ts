import { describe, expect, it } from 'vitest'
import {
  classifyModule,
  LAYER_RANK,
  LAYERS,
  MODULES,
  moduleKey,
  type Layer,
} from './boundaries.ts'

describe('layer ranking', () => {
  it('orders layers by how wide a boundary they cross', () => {
    expect(LAYER_RANK.unit).toBeLessThan(LAYER_RANK.integration)
    expect(LAYER_RANK.integration).toBeLessThan(LAYER_RANK.e2e)
  })

  it('ranks every declared layer', () => {
    for (const layer of LAYERS) {
      expect(LAYER_RANK[layer]).toBeTypeOf('number')
    }
  })
})

describe('the module table', () => {
  it('gives every entry a reason a reader can disagree with', () => {
    for (const [key, entry] of Object.entries(MODULES)) {
      expect(entry.why, `${key} has no rationale`).not.toBe('')
      expect(entry.why.length, `${key}'s rationale is too short to be a reason`).toBeGreaterThan(20)
    }
  })

  it('names the real resource behind every boundary', () => {
    for (const [key, entry] of Object.entries(MODULES)) {
      if (entry.kind === 'boundary') {
        expect(entry.resource, `${key} declares no resource`).not.toBe('')
        expect(LAYERS).toContain(entry.layer)
      }
    }
  })

  it('puts @playwright/test alone at the end-to-end layer', () => {
    const e2e = Object.entries(MODULES).filter(
      ([, entry]) => entry.kind === 'boundary' && entry.layer === 'e2e',
    )

    expect(e2e.map(([key]) => key)).toEqual(['@playwright/test'])
  })

  it('never classifies a boundary as the unit layer, which would be a contradiction', () => {
    for (const [key, entry] of Object.entries(MODULES)) {
      if (entry.kind === 'boundary') {
        expect(entry.layer, `${key} is a boundary at the unit layer`).not.toBe(
          'unit' satisfies Layer,
        )
      }
    }
  })

  it('leaves bare `eslint` unclassified so a namespace import has to pick a side', () => {
    // The two halves of the package disagree — `ESLint` reads config and files,
    // `RuleTester` lints strings in memory — so `import * as eslint` has no
    // honest answer and must fail rather than resolve to whichever key exists.
    expect(MODULES['eslint']).toBeUndefined()
    expect(MODULES['eslint#ESLint']).toBeDefined()
    expect(MODULES['eslint#RuleTester']).toBeDefined()
  })
})

describe('classifyModule', () => {
  it('prefers a binding-specific entry over the bare specifier', () => {
    const linting = classifyModule('eslint', 'ESLint')
    const inMemory = classifyModule('eslint', 'RuleTester')

    expect(linting?.kind).toBe('boundary')
    expect(inMemory?.kind).toBe('pure')
  })

  it('falls back to the bare specifier for a binding with no entry of its own', () => {
    expect(classifyModule('node:fs', 'readFileSync')?.kind).toBe('boundary')
    expect(classifyModule('node:fs', 'writeFileSync')?.kind).toBe('boundary')
  })

  it('resolves a side-effect import against the bare specifier', () => {
    expect(classifyModule('vitest', null)?.kind).toBe('pure')
  })

  it('returns null for a module nobody has classified', () => {
    expect(classifyModule('some-new-dependency', null)).toBeNull()
  })

  it('returns null for a namespace import of a per-binding module', () => {
    expect(classifyModule('eslint', '*')).toBeNull()
    expect(classifyModule('eslint', 'default')).toBeNull()
  })

  it('distinguishes a package from its subpath', () => {
    expect(classifyModule('msw', null)?.kind).toBe('pure')
    expect(classifyModule('msw/node', null)?.kind).toBe('boundary')
  })
})

describe('moduleKey', () => {
  it('reports the binding-specific key when one matched', () => {
    expect(moduleKey('eslint', 'ESLint')).toBe('eslint#ESLint')
  })

  it('reports the bare specifier when the binding had no entry', () => {
    expect(moduleKey('node:fs', 'readFileSync')).toBe('node:fs')
  })

  it('collapses four bindings of one module to one key, so evidence counts boundaries', () => {
    const keys = ['test', 'expect', 'Page', 'Browser'].map((binding) =>
      moduleKey('@playwright/test', binding),
    )

    expect(new Set(keys).size).toBe(1)
  })

  it('returns null when nothing in the table matched', () => {
    expect(moduleKey('unlisted', 'thing')).toBeNull()
  })
})
