// @vitest-environment node
//
// Walks and parses the repository, so it needs a filesystem rather than a DOM.

import { describe, expect, it } from 'vitest'

import { findSites, findSourceFiles, scanRepository, SOURCE_KINDS } from './audit.ts'
import { group, reconcile } from './check.ts'
import {
  DISPOSITIONS,
  DISPOSITION_NOTES,
  describeProblem,
  entryFor,
  REGISTRY,
} from './registry.ts'

// Two things are checked here, and the second is the one that matters. The
// first is that the repository as it stands satisfies its own rule. The second
// is that the rule has teeth — every failure the gate can report is caused
// deliberately below and the message checked, because a gate that cannot fail
// is a gate nobody has tested.

describe('finding a site', () => {
  it('finds a wall-clock read', () => {
    expect(findSites('x.ts', 'const t = Date.now()')).toEqual([
      { file: 'x.ts', line: 1, kind: 'wall-clock', callee: 'Date.now' },
    ])
  })

  it('finds a bare `new Date()`', () => {
    expect(findSites('x.ts', 'const t = new Date()')[0]?.kind).toBe('wall-clock')
  })

  // `new Date(ms)` parses a value somebody already has. Counting it would put
  // a row in the registry for every date fixture in the repository and teach
  // everybody to stop reading the report.
  it('ignores `new Date(value)`, which reads no clock', () => {
    expect(findSites('x.ts', 'const t = new Date(1700000000000)')).toEqual([])
  })

  it('finds a monotonic read', () => {
    expect(findSites('x.ts', 'const t = performance.now()')[0]?.kind).toBe('monotonic-clock')
  })

  it('finds a draw, an identifier and a scheduled callback', () => {
    const source = 'Math.random(); crypto.randomUUID(); setTimeout(fn, 1)'

    expect(findSites('x.ts', source).map((site) => site.kind)).toEqual([
      'randomness',
      'identity',
      'scheduler',
    ])
  })

  // The whole reason this is a parser and not a regular expression. All three
  // of these appear in the repository today and all three would be reported by
  // a pattern match.
  it('ignores the call named inside a string literal', () => {
    expect(findSites('x.ts', "const was = 'Math.random()'")).toEqual([])
  })

  it('ignores the call named inside a comment', () => {
    expect(findSites('x.ts', '// it called new Date() and Math.random()\nconst a = 1')).toEqual([])
  })

  it('ignores the call named inside a test title', () => {
    expect(findSites('x.ts', "it('reads the wall clock, as `new Date()` did', () => {})")).toEqual(
      [],
    )
  })

  it('records the line a site is on', () => {
    expect(findSites('x.ts', '\n\nconst t = Date.now()')[0]?.line).toBe(3)
  })

  it('reads a .tsx file, where the parser needs to be told about JSX', () => {
    expect(findSites('x.tsx', 'const el = <div onClick={() => setTimeout(fn, 1)} />')).toHaveLength(
      1,
    )
  })

  // A computed member cannot be named, so it is not reported. Stated as a test
  // rather than left implicit, because it is the audit's one blind spot and a
  // reader deserves to find it here rather than discover it.
  it('says nothing about a computed call it cannot name', () => {
    expect(findSites('x.ts', 'const t = globalThis["Date"].now()')).toEqual([])
  })
})

describe('grouping sites', () => {
  it('folds a file kind into one group with its lines in order', () => {
    const sites = findSites('x.ts', 'Date.now()\nMath.random()\nDate.now()')

    expect(group(sites)).toEqual([
      { file: 'x.ts', source: 'wall-clock', lines: [1, 3] },
      { file: 'x.ts', source: 'randomness', lines: [2] },
    ])
  })
})

describe('the gate, made to fail', () => {
  const site = (file: string, line: number, kind: (typeof SOURCE_KINDS)[number]) => ({
    file,
    line,
    kind,
    callee: 'Date.now',
  })

  it('refuses a read with no row', () => {
    const problems = reconcile([site('new.ts', 4, 'wall-clock')], [])

    expect(problems).toHaveLength(1)
    expect(describeProblem(problems[0]!)).toBe(
      'new.ts reads wall-clock at line(s) 4 with no row in determinism/registry.ts',
    )
  })

  it('refuses a row whose read has gone', () => {
    const problems = reconcile(
      [],
      [{ file: 'gone.ts', kind: 'randomness', count: 1, disposition: 'inert', why: 'x' }],
    )

    expect(problems).toHaveLength(1)
    expect(describeProblem(problems[0]!)).toBe(
      'determinism/registry.ts has a row for gone.ts reading randomness, but no such read exists any more',
    )
  })

  // The case a per-file allowlist waves through: the file is already blessed,
  // so a second read in it changes nothing anybody sees.
  it('refuses a second read in an already-registered file', () => {
    const problems = reconcile(
      [site('known.ts', 4, 'wall-clock'), site('known.ts', 9, 'wall-clock')],
      [{ file: 'known.ts', kind: 'wall-clock', count: 1, disposition: 'inert', why: 'x' }],
    )

    expect(problems).toHaveLength(1)
    expect(describeProblem(problems[0]!)).toBe(
      'known.ts now reads wall-clock 2 time(s) at line(s) 4, 9, but its row says 1',
    )
  })

  it('refuses a read of a new kind in an already-registered file', () => {
    const problems = reconcile(
      [site('known.ts', 4, 'wall-clock'), site('known.ts', 9, 'randomness')],
      [{ file: 'known.ts', kind: 'wall-clock', count: 1, disposition: 'inert', why: 'x' }],
    )

    expect(problems.map((problem) => problem.kind)).toEqual(['unregistered'])
  })

  it('reports the read somebody just caused before the bookkeeping', () => {
    const problems = reconcile(
      [site('new.ts', 1, 'wall-clock')],
      [{ file: 'gone.ts', kind: 'randomness', count: 1, disposition: 'inert', why: 'x' }],
    )

    expect(problems.map((problem) => problem.kind)).toEqual(['unregistered', 'stale-row'])
  })

  it('passes a repository whose reads all match their rows', () => {
    expect(
      reconcile(
        [site('known.ts', 4, 'wall-clock')],
        [{ file: 'known.ts', kind: 'wall-clock', count: 1, disposition: 'inert', why: 'x' }],
      ),
    ).toEqual([])
  })
})

describe('the registry', () => {
  it('explains every disposition it defines', () => {
    expect(Object.keys(DISPOSITION_NOTES).sort()).toEqual([...DISPOSITIONS].sort())
  })

  it('uses only dispositions it defines, and gives a reason for every row', () => {
    for (const entry of REGISTRY) {
      expect(DISPOSITIONS).toContain(entry.disposition)
      expect(SOURCE_KINDS).toContain(entry.kind)
      expect(entry.count).toBeGreaterThan(0)
      expect(entry.why.length).toBeGreaterThan(60)
    }
  })

  it('holds at most one row per file and kind', () => {
    const keys = REGISTRY.map((entry) => `${entry.file}#${entry.kind}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('finds the row for a registered read', () => {
    expect(entryFor('msw/db.ts', 'wall-clock')?.disposition).toBe('seam-default')
    expect(entryFor('msw/db.ts', 'randomness')).toBeUndefined()
  })

  // `measured` is the only disposition that argues *for* ambient
  // nondeterminism rather than tolerating it, so it is confined to the
  // directories whose subject is the runtime's own behaviour: this one, and
  // `concurrency/`, whose free strategies exist to measure what the untouched
  // microtask queue does with two overlapping operations. Anywhere else, a read
  // that cannot be controlled is a read to be argued about, not a measurement.
  it('confines the measured disposition to the directories doing the measuring', () => {
    const measuring = ['determinism/', 'concurrency/']

    for (const entry of REGISTRY.filter((row) => row.disposition === 'measured')) {
      expect({
        file: entry.file,
        measuring: measuring.some((directory) => entry.file.startsWith(directory)),
      }).toEqual({ file: entry.file, measuring: true })
    }
  })
})

describe('the repository as it stands', () => {
  it('walks every TypeScript file outside the ignored directories', () => {
    const files = findSourceFiles()

    expect(files).toContain('determinism/session.ts')
    expect(files).toContain('playwright/visual.spec.ts')
    expect(files.some((file) => file.includes('node_modules'))).toBe(false)
    expect(files.some((file) => file.includes('.stryker-tmp'))).toBe(false)
  })

  it('registers every ambient read it contains, with none left over', () => {
    expect(reconcile(scanRepository()).map(describeProblem)).toEqual([])
  })

  it('finds fewer reads than a pattern match would, because five of them are prose', () => {
    // A regular expression over the repository matches twenty-one lines outside
    // `determinism/`; five are a call named in a comment, in two string
    // literals, in a test title, and in the paragraph of
    // `concurrency/strategies.ts` explaining why it does not draw its delays
    // from `Math.random()` — which arrived after this claim was first written
    // and is exactly the false positive it is about. The parser reports sixteen.
    const outside = scanRepository().filter((site) => !site.file.startsWith('determinism/'))

    expect(outside).toHaveLength(16)
  })
})
