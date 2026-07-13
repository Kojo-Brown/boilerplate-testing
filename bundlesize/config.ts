/**
 * Bundle size regression check — types and pure utilities.
 *
 * No Node.js imports: safe to import from Vitest, browsers, or CI scripts.
 * For the CLI runner see check.ts (requires Node 22, excluded from jsdom tests).
 */

export type Compression = 'gzip' | 'brotli' | 'none'

export interface BundleLimit {
  /** Glob pattern relative to the project root. Must start with './'. */
  readonly path: string
  /** Max allowed compressed size. Examples: '250 kB', '50 kB', '1 MB'. */
  readonly maxSize: string
  /** Compression applied before measuring. Defaults to 'gzip'. */
  readonly compression?: Compression
}

export interface BundleCheckResult {
  readonly file: string
  readonly compressedBytes: number
  readonly maxBytes: number
  readonly compression: Compression
  readonly passed: boolean
}

export interface BundleReport {
  readonly results: readonly BundleCheckResult[]
  readonly passed: boolean
  readonly totalFiles: number
  readonly failedFiles: number
}

const SIZE_PATTERN = /^([\d.]+)\s*(B|kB|KB|MB|GB)$/i

/**
 * Parse a human-readable size string to bytes.
 * Uses decimal units: 1 kB = 1000 B, 1 MB = 1 000 000 B.
 * Supports: B, kB, KB, MB, GB (case-insensitive).
 *
 * @throws if the string doesn't match the expected format.
 */
export function parseSize(size: string): number {
  const match = SIZE_PATTERN.exec(size.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      `Invalid size format: "${size}". Expected e.g. "250 kB", "1.5 MB", "512 B".`,
    )
  }
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  switch (unit) {
    case 'B':  return Math.round(value)
    case 'KB': return Math.round(value * 1_000)
    case 'MB': return Math.round(value * 1_000_000)
    case 'GB': return Math.round(value * 1_000_000_000)
    default:   throw new Error(`Unknown size unit: "${unit}"`)
  }
}

/**
 * Format a byte count as a human-readable decimal string.
 * Examples: 512 → '512 B', 51_200 → '51.20 kB', 2_100_000 → '2.10 MB'
 */
export function formatSize(bytes: number): string {
  if (bytes < 1_000)         return `${bytes} B`
  if (bytes < 1_000_000)     return `${(bytes / 1_000).toFixed(2)} kB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`
}

/**
 * Format a single check result as a human-readable status line.
 *
 * Example (pass): ✓ dist/assets/index-Bx2k.js  142.30 kB / 250 kB gzip  (107.70 kB remaining)
 * Example (fail): ✗ dist/assets/index-Bx2k.js  262.00 kB / 250 kB gzip  (12.00 kB OVER LIMIT)
 */
export function formatResult(result: BundleCheckResult): string {
  const icon = result.passed ? '✓' : '✗'
  const actual = formatSize(result.compressedBytes)
  const max = formatSize(result.maxBytes)
  const delta = result.maxBytes - result.compressedBytes
  const deltaLabel =
    delta >= 0
      ? `${formatSize(delta)} remaining`
      : `${formatSize(-delta)} OVER LIMIT`
  return `${icon} ${result.file}  ${actual} / ${max} ${result.compression}  (${deltaLabel})`
}

/**
 * Aggregate an array of check results into a BundleReport.
 */
export function buildReport(
  results: readonly BundleCheckResult[],
): BundleReport {
  const failedFiles = results.filter((r) => !r.passed).length
  return {
    results,
    passed: failedFiles === 0,
    totalFiles: results.length,
    failedFiles,
  }
}

/**
 * Default size limits for a Vite SPA, gzip-compressed.
 * Copy to .bundlesize.json in your project and tune maxSize values
 * to match your actual build output.
 */
export const defaultLimits: readonly BundleLimit[] = [
  // Main JS entry + lazy-loaded chunks (gzip target for fast FCP)
  { path: './dist/assets/*.js',  maxSize: '250 kB', compression: 'gzip' },
  // TailwindCSS v4 purged stylesheet
  { path: './dist/assets/*.css', maxSize: '50 kB',  compression: 'gzip' },
]
