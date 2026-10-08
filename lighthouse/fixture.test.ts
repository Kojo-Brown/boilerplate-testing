import { describe, expect, it } from 'vitest'

import { assertedCeiling, budgetLines, KIB } from './budgets.ts'
import {
  assetSizes,
  cssFiller,
  document,
  filler,
  HEAVY_PATH,
  LEAN_PATH,
  ORIGIN_PORT,
  OVERSHOOT,
  route,
  sizeCeiling,
  UNDERSHOOT,
} from './fixture.ts'
import { loadBudgets } from './load.ts'
import { portFromEnv } from './server.ts'

const budgets = loadBudgets()

describe('filler', () => {
  it('produces exactly the requested byte length', () => {
    for (const size of [10, 100, 4_096, 300 * KIB]) {
      expect(Buffer.byteLength(filler(size), 'utf8')).toBe(size)
    }
  })

  it('produces a valid comment, so the browser parses it as script', () => {
    expect(filler(1_000).startsWith('/*')).toBe(true)
    expect(filler(1_000).endsWith('*/')).toBe(true)
  })

  it('does not go negative on a size smaller than its wrapper', () => {
    expect(filler(1)).toBe('/**/')
  })
})

describe('cssFiller', () => {
  it('produces exactly the requested byte length', () => {
    for (const size of [100, 4_096, 100 * KIB]) {
      expect(Buffer.byteLength(cssFiller(size), 'utf8')).toBe(size)
    }
  })

  it('carries a real rule, so the stylesheet is not only a comment', () => {
    expect(cssFiller(10_000)).toContain('body{')
  })
})

describe('sizeCeiling', () => {
  it('reads a budgeted type in bytes', () => {
    expect(sizeCeiling(budgets, 'script')).toBe(
      assertedCeiling(
        budgetLines(budgets).find(
          (line) => line.kind === 'size' && line.resourceType === 'script',
        )!,
      ),
    )
  })

  it('returns null for a type the budget file does not size', () => {
    expect(sizeCeiling([{ path: '/*', timings: [{ metric: 'speed-index', budget: 1 }] }], 'script')).toBeNull()
  })
})

describe('assetSizes', () => {
  it('overshoots the script and stylesheet budgets by the declared factor', () => {
    const sizes = assetSizes(budgets, OVERSHOOT)

    expect(sizes.scriptBytes).toBe((sizeCeiling(budgets, 'script') ?? 0) * OVERSHOOT)
    expect(sizes.stylesheetBytes).toBe((sizeCeiling(budgets, 'stylesheet') ?? 0) * OVERSHOOT)
  })

  it('overshoots by enough that run-to-run noise cannot explain it', () => {
    expect(OVERSHOOT).toBeGreaterThanOrEqual(2)
  })

  it('stays well inside the budgets at the undershoot factor', () => {
    const sizes = assetSizes(budgets, UNDERSHOOT)

    expect(sizes.scriptBytes).toBeLessThan(sizeCeiling(budgets, 'script') ?? 0)
    expect(sizes.stylesheetBytes).toBeLessThan(sizeCeiling(budgets, 'stylesheet') ?? 0)
  })

  it('leaves room for the document itself under the total budget', () => {
    // The lean page must fit `total`, which includes the document and both
    // assets — so the undershoot has to be comfortable, not marginal.
    const sizes = assetSizes(budgets, UNDERSHOOT)
    const total = sizeCeiling(budgets, 'total') ?? 0
    const documentBytes = Buffer.byteLength(document({ heavy: false }), 'utf8')

    expect(sizes.scriptBytes + sizes.stylesheetBytes + documentBytes).toBeLessThan(total)
  })

  it('breaks the total budget on the heavy page, as a consequence rather than by aim', () => {
    const sizes = assetSizes(budgets, OVERSHOOT)
    const total = sizeCeiling(budgets, 'total') ?? 0

    expect(sizes.scriptBytes + sizes.stylesheetBytes).toBeGreaterThan(total)
  })

  it('falls back to a default when a budget file sizes neither asset', () => {
    const sizes = assetSizes([{ path: '/*', timings: [{ metric: 'speed-index', budget: 1 }] }], 1)

    expect(sizes.scriptBytes).toBeGreaterThan(0)
    expect(sizes.stylesheetBytes).toBeGreaterThan(0)
  })
})

describe('document', () => {
  // A page that also failed color-contrast or document-title would make every
  // red run ambiguous between "over budget" and "bad markup".
  it('declares a language, a title and a description', () => {
    const html = document({ heavy: true })

    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<title>')
    expect(html).toContain('name="description"')
  })

  it('has exactly one h1', () => {
    expect(document({ heavy: false }).match(/<h1>/g)).toHaveLength(1)
  })

  it('labels its one form control', () => {
    const html = document({ heavy: false })

    expect(html).toContain('<label for="q">')
    expect(html).toContain('id="q"')
  })

  it('declares a viewport, which Lighthouse audits on mobile', () => {
    expect(document({ heavy: true })).toContain('name="viewport"')
  })

  it('points at the heavy assets only on the heavy page', () => {
    expect(document({ heavy: true })).toContain('/heavy.js')
    expect(document({ heavy: true })).not.toContain('/lean.js')
    expect(document({ heavy: false })).toContain('/lean.js')
    expect(document({ heavy: false })).not.toContain('/heavy.js')
  })

  it('fits the document size budget on its own', () => {
    const budget = sizeCeiling(budgets, 'document') ?? 0

    expect(Buffer.byteLength(document({ heavy: true }), 'utf8')).toBeLessThan(budget)
  })
})

describe('route', () => {
  it('serves the heavy page at / and at /heavy', () => {
    for (const path of ['/', HEAVY_PATH]) {
      const reply = route(path, budgets)

      expect(reply.status).toBe(200)
      expect(reply.contentType).toContain('text/html')
      expect(reply.body).toContain('heavy')
    }
  })

  it('serves the lean page', () => {
    const reply = route(LEAN_PATH, budgets)

    expect(reply.status).toBe(200)
    expect(reply.body).toContain('lean')
  })

  it('serves each asset with the right content type', () => {
    expect(route('/heavy.js', budgets).contentType).toBe('text/javascript')
    expect(route('/heavy.css', budgets).contentType).toBe('text/css')
    expect(route('/lean.js', budgets).contentType).toBe('text/javascript')
    expect(route('/lean.css', budgets).contentType).toBe('text/css')
  })

  it('serves the heavy assets over budget and the lean ones under it', () => {
    const scriptBudget = sizeCeiling(budgets, 'script') ?? 0

    expect(Buffer.byteLength(route('/heavy.js', budgets).body, 'utf8')).toBeGreaterThan(scriptBudget)
    expect(Buffer.byteLength(route('/lean.js', budgets).body, 'utf8')).toBeLessThan(scriptBudget)
  })

  it('404s an unknown path', () => {
    expect(route('/nope', budgets).status).toBe(404)
  })
})

describe('portFromEnv', () => {
  it('falls back to the published port', () => {
    expect(portFromEnv(undefined)).toBe(ORIGIN_PORT)
    expect(portFromEnv('')).toBe(ORIGIN_PORT)
  })

  it('reads an override', () => {
    expect(portFromEnv('9123')).toBe(9123)
  })

  // 0 is how check.ts and this suite ask the OS for a free port.
  it('allows 0', () => {
    expect(portFromEnv('0')).toBe(0)
  })

  it('rejects a non-numeric or negative port', () => {
    expect(() => portFromEnv('http://nope')).toThrow('LH_ORIGIN_PORT')
    expect(() => portFromEnv('-1')).toThrow('LH_ORIGIN_PORT')
  })
})
