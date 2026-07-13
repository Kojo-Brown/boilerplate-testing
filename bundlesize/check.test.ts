import { describe, it, expect } from 'vitest'
import {
  parseSize,
  formatSize,
  formatResult,
  buildReport,
  defaultLimits,
  type BundleCheckResult,
  type BundleReport,
} from './config'

// ---------------------------------------------------------------------------
// parseSize
// ---------------------------------------------------------------------------

describe('parseSize', () => {
  it('parses bytes', () => {
    expect(parseSize('512 B')).toBe(512)
    expect(parseSize('1 B')).toBe(1)
  })

  it('parses kB (decimal, 1 kB = 1000 B)', () => {
    expect(parseSize('1 kB')).toBe(1_000)
    expect(parseSize('250 kB')).toBe(250_000)
    expect(parseSize('50 kB')).toBe(50_000)
  })

  it('parses kB case-insensitively (KB, kB)', () => {
    expect(parseSize('250 KB')).toBe(250_000)
    expect(parseSize('250 kB')).toBe(250_000)
  })

  it('parses MB', () => {
    expect(parseSize('1 MB')).toBe(1_000_000)
    expect(parseSize('1.5 MB')).toBe(1_500_000)
  })

  it('parses GB', () => {
    expect(parseSize('1 GB')).toBe(1_000_000_000)
  })

  it('rounds fractional bytes', () => {
    expect(parseSize('1.6 B')).toBe(2)
    expect(parseSize('1.4 B')).toBe(1)
  })

  it('accepts sizes without a space before the unit', () => {
    expect(parseSize('250kB')).toBe(250_000)
    expect(parseSize('50MB')).toBe(50_000_000)
  })

  it('throws on missing unit', () => {
    expect(() => parseSize('250')).toThrow('Invalid size format')
  })

  it('throws on unknown unit', () => {
    expect(() => parseSize('250 TB')).toThrow('Invalid size format')
  })

  it('throws on non-numeric value', () => {
    expect(() => parseSize('big kB')).toThrow('Invalid size format')
  })

  it('throws on empty string', () => {
    expect(() => parseSize('')).toThrow('Invalid size format')
  })
})

// ---------------------------------------------------------------------------
// formatSize
// ---------------------------------------------------------------------------

describe('formatSize', () => {
  it('formats bytes below 1 kB', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(999)).toBe('999 B')
  })

  it('formats kB (1 000 – 999 999)', () => {
    expect(formatSize(1_000)).toBe('1.00 kB')
    expect(formatSize(51_200)).toBe('51.20 kB')
    expect(formatSize(250_000)).toBe('250.00 kB')
  })

  it('formats MB (1 000 000 – 999 999 999)', () => {
    expect(formatSize(1_000_000)).toBe('1.00 MB')
    expect(formatSize(2_100_000)).toBe('2.10 MB')
  })

  it('formats GB (≥ 1 000 000 000)', () => {
    expect(formatSize(1_000_000_000)).toBe('1.00 GB')
    expect(formatSize(2_500_000_000)).toBe('2.50 GB')
  })

  it('round-trips with parseSize for common values', () => {
    for (const input of ['512 B', '250 kB', '50 kB', '1 MB']) {
      const bytes = parseSize(input)
      const formatted = formatSize(bytes)
      expect(parseSize(formatted)).toBe(bytes)
    }
  })
})

// ---------------------------------------------------------------------------
// formatResult
// ---------------------------------------------------------------------------

describe('formatResult', () => {
  const passing: BundleCheckResult = {
    file: 'dist/assets/index-abc.js',
    compressedBytes: 142_300,
    maxBytes: 250_000,
    compression: 'gzip',
    passed: true,
  }

  const failing: BundleCheckResult = {
    file: 'dist/assets/index-abc.js',
    compressedBytes: 262_000,
    maxBytes: 250_000,
    compression: 'gzip',
    passed: false,
  }

  it('starts with ✓ for a passing result', () => {
    expect(formatResult(passing)).toMatch(/^✓/)
  })

  it('starts with ✗ for a failing result', () => {
    expect(formatResult(failing)).toMatch(/^✗/)
  })

  it('includes the file name', () => {
    expect(formatResult(passing)).toContain('dist/assets/index-abc.js')
  })

  it('includes the compression algorithm', () => {
    expect(formatResult(passing)).toContain('gzip')
  })

  it('shows "remaining" for a passing result', () => {
    expect(formatResult(passing)).toContain('remaining')
  })

  it('shows "OVER LIMIT" for a failing result', () => {
    expect(formatResult(failing)).toContain('OVER LIMIT')
  })

  it('includes actual and max sizes', () => {
    const line = formatResult(passing)
    expect(line).toContain('142.30 kB')
    expect(line).toContain('250.00 kB')
  })

  it('formats brotli compression', () => {
    const result: BundleCheckResult = { ...passing, compression: 'brotli' }
    expect(formatResult(result)).toContain('brotli')
  })

  it('formats none compression', () => {
    const result: BundleCheckResult = { ...passing, compression: 'none' }
    expect(formatResult(result)).toContain('none')
  })
})

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

describe('buildReport', () => {
  const pass: BundleCheckResult = {
    file: 'dist/assets/main.js',
    compressedBytes: 100_000,
    maxBytes: 250_000,
    compression: 'gzip',
    passed: true,
  }

  const fail: BundleCheckResult = {
    file: 'dist/assets/vendor.js',
    compressedBytes: 300_000,
    maxBytes: 250_000,
    compression: 'gzip',
    passed: false,
  }

  it('returns passed: true when all results pass', () => {
    const report = buildReport([pass])
    expect(report.passed).toBe(true)
    expect(report.failedFiles).toBe(0)
  })

  it('returns passed: false when any result fails', () => {
    const report = buildReport([pass, fail])
    expect(report.passed).toBe(false)
    expect(report.failedFiles).toBe(1)
  })

  it('counts total and failed files correctly', () => {
    const report: BundleReport = buildReport([pass, fail, pass])
    expect(report.totalFiles).toBe(3)
    expect(report.failedFiles).toBe(1)
  })

  it('returns passed: true for an empty result set', () => {
    const report = buildReport([])
    expect(report.passed).toBe(true)
    expect(report.totalFiles).toBe(0)
    expect(report.failedFiles).toBe(0)
  })

  it('preserves the results array verbatim', () => {
    const results = [pass, fail]
    const report = buildReport(results)
    expect(report.results).toStrictEqual(results)
  })
})

// ---------------------------------------------------------------------------
// defaultLimits
// ---------------------------------------------------------------------------

describe('defaultLimits', () => {
  it('has at least one JS limit', () => {
    const js = defaultLimits.filter((l) => l.path.includes('.js'))
    expect(js.length).toBeGreaterThanOrEqual(1)
  })

  it('has at least one CSS limit', () => {
    const css = defaultLimits.filter((l) => l.path.includes('.css'))
    expect(css.length).toBeGreaterThanOrEqual(1)
  })

  it('all paths start with "./"', () => {
    for (const limit of defaultLimits) {
      expect(limit.path.startsWith('./')).toBe(true)
    }
  })

  it('all maxSize values are parseable', () => {
    for (const limit of defaultLimits) {
      expect(() => parseSize(limit.maxSize)).not.toThrow()
    }
  })

  it('all compression values are valid when set', () => {
    const valid = new Set<string>(['gzip', 'brotli', 'none'])
    for (const limit of defaultLimits) {
      if (limit.compression !== undefined) {
        expect(valid.has(limit.compression)).toBe(true)
      }
    }
  })

  it('JS limit maxSize is at most 1 MB (reasonable default)', () => {
    const js = defaultLimits.find((l) => l.path.includes('.js'))
    expect(js).toBeDefined()
    expect(parseSize(js!.maxSize)).toBeLessThanOrEqual(1_000_000)
  })

  it('CSS limit maxSize is at most 200 kB (reasonable default)', () => {
    const css = defaultLimits.find((l) => l.path.includes('.css'))
    expect(css).toBeDefined()
    expect(parseSize(css!.maxSize)).toBeLessThanOrEqual(200_000)
  })
})
