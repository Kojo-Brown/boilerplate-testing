#!/usr/bin/env node
/**
 * Bundle size regression checker — Node.js 22 CLI script.
 *
 * Run after `pnpm build` to verify that output chunks don't exceed
 * the limits defined in .bundlesize.json (project root).
 *
 * Usage:
 *   node bundlesize/check.js                        # reads .bundlesize.json
 *   node bundlesize/check.js --config my.json       # reads custom config
 *
 * Or add to package.json scripts:
 *   "bundlesize:check": "node bundlesize/check.js"
 *
 * Requires Node 22+ (uses fs.globSync). Compile with tsconfig.bundlesize.json.
 */
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { readFileSync, globSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import process from 'node:process'

import {
  buildReport,
  formatResult,
  parseSize,
  type BundleLimit,
  type BundleCheckResult,
  type Compression,
} from './config.js'

function compressBuffer(buf: Buffer, compression: Compression): Buffer {
  if (compression === 'gzip')   return gzipSync(buf, { level: 9 })
  if (compression === 'brotli') return brotliCompressSync(buf)
  return buf
}

function measureCompressed(filePath: string, compression: Compression): number {
  const content = readFileSync(filePath)
  return compressBuffer(content, compression).byteLength
}

function loadLimits(configPath: string): readonly BundleLimit[] {
  const raw = readFileSync(configPath, 'utf8')
  return JSON.parse(raw) as BundleLimit[]
}

function checkFile(
  filePath: string,
  limit: BundleLimit,
  cwd: string,
): BundleCheckResult {
  const compression: Compression = limit.compression ?? 'gzip'
  return {
    file: relative(cwd, filePath),
    compressedBytes: measureCompressed(filePath, compression),
    maxBytes: parseSize(limit.maxSize),
    compression,
    passed: measureCompressed(filePath, compression) <= parseSize(limit.maxSize),
  }
}

function run(): void {
  const argv = process.argv.slice(2)
  const configIdx = argv.indexOf('--config')
  const configPath =
    configIdx >= 0
      ? resolve(argv[configIdx + 1] ?? '.bundlesize.json')
      : resolve('.bundlesize.json')

  let limits: readonly BundleLimit[]
  try {
    limits = loadLimits(configPath)
  } catch {
    console.error(`✗ Could not read bundle size config: ${configPath}`)
    console.error('  Run `pnpm build` first and ensure .bundlesize.json exists.')
    process.exit(1)
  }

  const cwd = process.cwd()
  const results: BundleCheckResult[] = []

  for (const limit of limits) {
    const files = globSync(limit.path, { cwd })
    if (files.length === 0) {
      console.warn(`⚠  No files matched: ${limit.path}`)
    }
    for (const file of files) {
      const abs = resolve(cwd, file)
      if (statSync(abs).isFile()) {
        results.push(checkFile(abs, limit, cwd))
      }
    }
  }

  const report = buildReport(results)
  for (const result of report.results) {
    console.log(formatResult(result))
  }
  console.log()

  if (report.passed) {
    console.log(`✓ All ${report.totalFiles} bundle size checks passed.`)
  } else {
    console.error(
      `✗ ${report.failedFiles} of ${report.totalFiles} bundle size checks failed.`,
    )
    process.exit(1)
  }
}

run()
