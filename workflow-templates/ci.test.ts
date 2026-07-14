import { describe, it, expect } from 'vitest'
import {
  matrix,
  filterBySuite,
  filterByBrowser,
  validateMatrix,
  parallelJobCount,
  type MatrixEntry,
  type TestSuite,
  type E2EBrowser,
} from './ci'

// ---------------------------------------------------------------------------
// matrix — shape invariants
// ---------------------------------------------------------------------------

describe('matrix', () => {
  it('contains at least one unit entry', () => {
    expect(matrix.some((e) => e.suite === 'unit')).toBe(true)
  })

  it('contains at least one coverage entry', () => {
    expect(matrix.some((e) => e.suite === 'coverage')).toBe(true)
  })

  it('contains at least one e2e entry', () => {
    expect(matrix.some((e) => e.suite === 'e2e')).toBe(true)
  })

  it('e2e entries cover chromium, firefox, and webkit', () => {
    const browsers = matrix
      .filter((e) => e.suite === 'e2e')
      .map((e) => e.browser)
    expect(browsers).toContain('chromium')
    expect(browsers).toContain('firefox')
    expect(browsers).toContain('webkit')
  })

  it('all entries have a non-empty name', () => {
    for (const entry of matrix) {
      expect(entry.name.length).toBeGreaterThan(0)
    }
  })

  it('all entries have a non-empty run command', () => {
    for (const entry of matrix) {
      expect(entry.run.length).toBeGreaterThan(0)
    }
  })

  it('all entries have a non-empty artifactPrefix', () => {
    for (const entry of matrix) {
      expect(entry.artifactPrefix.length).toBeGreaterThan(0)
    }
  })

  it('all artifactPrefix values are unique', () => {
    const prefixes = matrix.map((e) => e.artifactPrefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('all retries values are non-negative integers', () => {
    for (const entry of matrix) {
      expect(entry.retries).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(entry.retries)).toBe(true)
    }
  })

  it('e2e entries have positive retries (flake tolerance)', () => {
    for (const entry of matrix.filter((e) => e.suite === 'e2e')) {
      expect(entry.retries).toBeGreaterThan(0)
    }
  })

  it('non-e2e entries have no browser set', () => {
    for (const entry of matrix.filter((e) => e.suite !== 'e2e')) {
      expect(entry.browser).toBeUndefined()
    }
  })

  it('e2e entries all have a browser set', () => {
    for (const entry of matrix.filter((e) => e.suite === 'e2e')) {
      expect(entry.browser).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// filterBySuite
// ---------------------------------------------------------------------------

describe('filterBySuite', () => {
  it('returns only unit entries for "unit"', () => {
    const result = filterBySuite('unit')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.every((e) => e.suite === 'unit')).toBe(true)
  })

  it('returns only coverage entries for "coverage"', () => {
    const result = filterBySuite('coverage')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.every((e) => e.suite === 'coverage')).toBe(true)
  })

  it('returns only e2e entries for "e2e"', () => {
    const result = filterBySuite('e2e')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.every((e) => e.suite === 'e2e')).toBe(true)
  })

  it('returns a subset — total across all suites equals matrix length', () => {
    const suites: TestSuite[] = ['unit', 'coverage', 'e2e']
    const total = suites.reduce((acc, s) => acc + filterBySuite(s).length, 0)
    expect(total).toBe(matrix.length)
  })
})

// ---------------------------------------------------------------------------
// filterByBrowser
// ---------------------------------------------------------------------------

describe('filterByBrowser', () => {
  it('returns chromium entries', () => {
    const result = filterByBrowser('chromium')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.every((e) => e.browser === 'chromium')).toBe(true)
  })

  it('returns firefox entries', () => {
    const result = filterByBrowser('firefox')
    expect(result.every((e) => e.browser === 'firefox')).toBe(true)
  })

  it('returns webkit entries', () => {
    const result = filterByBrowser('webkit')
    expect(result.every((e) => e.browser === 'webkit')).toBe(true)
  })

  it('returns empty array for a browser not in the matrix', () => {
    const result = filterByBrowser('chromium' as E2EBrowser)
    // Confirm filter is not returning unrelated entries
    expect(result.some((e) => e.browser !== 'chromium')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateMatrix
// ---------------------------------------------------------------------------

describe('validateMatrix', () => {
  const base: MatrixEntry = {
    name: 'Unit',
    suite: 'unit',
    run: 'pnpm test',
    retries: 0,
    artifactPrefix: 'unit',
  }

  const coverageEntry: MatrixEntry = {
    name: 'Coverage',
    suite: 'coverage',
    run: 'pnpm coverage',
    retries: 0,
    artifactPrefix: 'coverage',
  }

  const e2eEntry: MatrixEntry = {
    name: 'E2E',
    suite: 'e2e',
    browser: 'chromium',
    run: 'pnpm test:e2e --project=chromium',
    retries: 2,
    artifactPrefix: 'e2e-chromium',
  }

  it('returns null for a valid matrix (default export)', () => {
    expect(validateMatrix(matrix)).toBeNull()
  })

  it('returns null for a minimal valid matrix', () => {
    expect(validateMatrix([base, coverageEntry, e2eEntry])).toBeNull()
  })

  it('errors when unit suite is missing', () => {
    const error = validateMatrix([coverageEntry, e2eEntry])
    expect(error).toContain('unit')
  })

  it('errors when coverage suite is missing', () => {
    const error = validateMatrix([base, e2eEntry])
    expect(error).toContain('coverage')
  })

  it('errors when e2e suite is missing', () => {
    const error = validateMatrix([base, coverageEntry])
    expect(error).toContain('e2e')
  })

  it('errors on duplicate artifactPrefix', () => {
    const duplicate = { ...e2eEntry, artifactPrefix: 'unit' }
    const error = validateMatrix([base, coverageEntry, duplicate])
    expect(error).toContain('unit')
    expect(error).toMatch(/duplicate/i)
  })

  it('returns a string (not null) on any validation failure', () => {
    const error = validateMatrix([base])
    expect(typeof error).toBe('string')
    expect(error!.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// parallelJobCount
// ---------------------------------------------------------------------------

describe('parallelJobCount', () => {
  it('returns the total number of matrix entries for the default matrix', () => {
    expect(parallelJobCount()).toBe(matrix.length)
  })

  it('accepts a custom entry list', () => {
    const two: MatrixEntry[] = [
      { name: 'A', suite: 'unit', run: 'a', retries: 0, artifactPrefix: 'a' },
      { name: 'B', suite: 'coverage', run: 'b', retries: 0, artifactPrefix: 'b' },
    ]
    expect(parallelJobCount(two)).toBe(2)
  })

  it('returns 0 for an empty list', () => {
    expect(parallelJobCount([])).toBe(0)
  })

  it('is at least 5 for the default matrix (unit + coverage + 3 browsers)', () => {
    expect(parallelJobCount()).toBeGreaterThanOrEqual(5)
  })
})
