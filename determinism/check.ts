/**
 * Reconciling what the parser found against what `registry.ts` blesses.
 *
 * Deliberately a pure function of a site list and a registry, with the reading
 * of the repository left to the caller. That is what lets `audit.test.ts`
 * cause every one of the three failures on synthetic input and check the
 * message, rather than editing a real file and putting it back.
 */

import { SOURCE_KINDS, type Site, type SourceKind } from './audit.ts'
import { REGISTRY, type RegistryEntry, type RegistryProblem } from './registry.ts'

interface Group {
  readonly file: string
  readonly source: SourceKind
  readonly lines: readonly number[]
}

/** Sites folded into one group per file and kind, in file then kind order. */
export function group(sites: readonly Site[]): readonly Group[] {
  const groups = new Map<string, { file: string; source: SourceKind; lines: number[] }>()

  for (const site of sites) {
    const key = `${site.file}#${site.kind}`
    const existing = groups.get(key)

    if (existing === undefined) {
      groups.set(key, { file: site.file, source: site.kind, lines: [site.line] })
    } else {
      existing.lines.push(site.line)
    }
  }

  return [...groups.values()]
    .map((entry) => ({ ...entry, lines: [...entry.lines].sort((a, b) => a - b) }))
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        SOURCE_KINDS.indexOf(left.source) - SOURCE_KINDS.indexOf(right.source),
    )
}

/**
 * Every disagreement between the repository and the registry.
 *
 * Order is deliberate: unregistered reads first, because that is the failure
 * somebody has just caused, then stale rows, then counts. A report that leads
 * with bookkeeping buries the thing the reader needs.
 */
export function reconcile(
  sites: readonly Site[],
  registry: readonly RegistryEntry[] = REGISTRY,
): readonly RegistryProblem[] {
  const groups = group(sites)
  const problems: RegistryProblem[] = []
  const seen = new Set<string>()

  for (const { file, source, lines } of groups) {
    const entry = registry.find((row) => row.file === file && row.kind === source)

    seen.add(`${file}#${source}`)

    if (entry === undefined) {
      problems.push({ kind: 'unregistered', file, source, lines })

      continue
    }

    if (entry.count !== lines.length) {
      problems.push({
        kind: 'count-changed',
        file,
        source,
        registered: entry.count,
        found: lines.length,
        lines,
      })
    }
  }

  for (const entry of registry) {
    if (!seen.has(`${entry.file}#${entry.kind}`)) {
      problems.push({ kind: 'stale-row', file: entry.file, source: entry.kind })
    }
  }

  return [
    ...problems.filter((problem) => problem.kind === 'unregistered'),
    ...problems.filter((problem) => problem.kind === 'stale-row'),
    ...problems.filter((problem) => problem.kind === 'count-changed'),
  ]
}
