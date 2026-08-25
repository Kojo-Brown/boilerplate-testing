/**
 * `pnpm shape:check` — the CI gate for the ratio policy.
 *
 * Prints the census and exits non-zero when the suite has drifted outside the
 * declared bands, changed shape, or when the census itself found something it
 * will not vouch for.
 *
 * The report is written to be read in a CI log by someone who has just been
 * told their pull request is red and does not know what this gate is. So it
 * prints the whole picture — the shape, the bands, the per-layer counts, and
 * the files behind each layer with the boundary that put them there — rather
 * than a bare assertion message. A gate that says only "integration is 41%"
 * sends the reader looking for the tool; one that shows which seventeen files
 * are integration and why sends them straight at the decision.
 */

import { LAYERS, type Layer } from './boundaries.ts'
import { runCensus, type FullCensus } from './census.ts'
import { percent, POLICY, SHAPES } from './policy.ts'

const BAR_WIDTH = 40

const pad = (value: string | number, width: number): string => String(value).padStart(width)

/** A proportional bar, so the shape is visible at a glance in a log. */
function bar(share: number): string {
  const filled = Math.round((share / 100) * BAR_WIDTH)

  return '█'.repeat(filled) + '·'.repeat(Math.max(0, BAR_WIDTH - filled))
}

function renderLayer(census: FullCensus, layer: Layer): string[] {
  const files = census.files
    .filter((file) => file.layer === layer && file.count > 0)
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))

  return files.map((file) => {
    const reason =
      file.evidence.length === 0
        ? 'crosses nothing'
        : file.evidence
            .map((e) => (e.binding === null ? e.specifier : `${e.specifier}#${e.binding}`))
            .join(', ')

    return `    ${pad(file.count, 4)}  ${file.file}  (${reason})`
  })
}

export function render(census: FullCensus): string {
  const shape = SHAPES[POLICY.shape]
  const lines: string[] = []

  lines.push('')
  lines.push(`Test suite shape — policy: ${shape.name.toLowerCase()}`)
  lines.push(`  ${shape.claim}`)
  lines.push('')
  lines.push(`  ${census.measurement.total} tests across ${census.files.length} files`)
  lines.push('')

  for (const layer of LAYERS) {
    const share = census.measurement.share[layer]
    const band = POLICY.bands[layer]
    const within = share >= band.min && share <= band.max

    lines.push(
      `  ${layer.padEnd(12)} ${pad(census.measurement.counts[layer], 4)}  ${bar(share)} ` +
        `${pad(percent(share), 6)}   band ${`${band.min}–${band.max}%`.padEnd(7)} ` +
        `${within ? 'ok' : 'OUT'}`,
    )
  }

  lines.push('')

  for (const layer of LAYERS) {
    const files = renderLayer(census, layer)

    if (files.length > 0) {
      lines.push(`  ${layer}:`)
      lines.push(...files)
      lines.push('')
    }
  }

  // Executions, not declarations. The Playwright projects multiply the e2e
  // layer by five or six, which is the pyramid's cost argument stated in the
  // one number the ratio deliberately does not use.
  const playwright = census.collected.results.find((result) => result.runner === 'playwright')

  if (playwright !== undefined) {
    const declarations = Object.values(playwright.counts).reduce((sum, n) => sum + n, 0)

    lines.push(
      `  note: the ${declarations} end-to-end tests above are declarations. ` +
        `playwright.config.ts runs them across its project matrix, so the wall-clock ` +
        `cost is a multiple of this count while the ratio is not.`,
    )
    lines.push('')
  }

  if (census.problems.length > 0) {
    lines.push(`  ${census.problems.length} census problem(s):`)

    for (const problem of census.problems) {
      lines.push(`    [${problem.kind}] ${problem.detail}`)
    }

    lines.push('')
  }

  if (census.violations.length > 0) {
    lines.push(`  ${census.violations.length} policy violation(s):`)

    for (const violation of census.violations) {
      lines.push(`    [${violation.kind}] ${violation.detail}`)
    }

    lines.push('')
    lines.push('  See shape/README.md for what the bands mean and how to change them.')
    lines.push('')
  }

  return lines.join('\n')
}

function main(): void {
  const census = runCensus()

  process.stdout.write(render(census))

  const failed = census.problems.length + census.violations.length

  if (failed > 0) {
    process.stdout.write(`shape: FAILED (${failed} finding(s))\n`)
    process.exitCode = 1

    return
  }

  process.stdout.write('shape: ok\n')
}

main()
