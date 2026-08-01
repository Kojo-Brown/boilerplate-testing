// @vitest-environment node
//
// This suite reads the workflow files off disk and resolves them relative to
// `import.meta.url`. Under the project-default jsdom environment that URL is
// rewritten to an http: one and `fileURLToPath` throws, so this file opts back
// into the node environment — it needs a filesystem, not a DOM.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  parseActionPins,
  findPinProblems,
  formatPinProblem,
  NODE24_MAJOR_FLOOR,
  type ActionPin,
} from './actionPins'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// ---------------------------------------------------------------------------
// parseActionPins
// ---------------------------------------------------------------------------

describe('parseActionPins', () => {
  it('reads owner, repo, ref and major from a step reference', () => {
    const [pin] = parseActionPins('      - uses: actions/checkout@v7\n', 'w.yml')
    expect(pin).toMatchObject({
      action: 'actions/checkout',
      ref: 'v7',
      major: 7,
      file: 'w.yml',
      line: 1,
      commented: false,
    })
  })

  it('reads a named step whose `uses:` is on its own line', () => {
    const yaml = ['      - name: Checkout', '        uses: actions/checkout@v7'].join('\n')
    const pins = parseActionPins(yaml, 'w.yml')
    expect(pins).toHaveLength(1)
    expect(pins[0]?.line).toBe(2)
  })

  it('strips a sub-action path down to owner/repo', () => {
    const [pin] = parseActionPins('    uses: github/codeql-action/init@v4\n', 'w.yml')
    expect(pin?.action).toBe('github/codeql-action')
    expect(pin?.ref).toBe('v4')
  })

  it('parses a full three-part version ref', () => {
    const [pin] = parseActionPins('    uses: pnpm/action-setup@v6.0.9\n', 'w.yml')
    expect(pin?.major).toBe(6)
    expect(pin?.ref).toBe('v6.0.9')
  })

  it('reports major as null for a SHA pin', () => {
    const sha = 'a'.repeat(40)
    const [pin] = parseActionPins(`    uses: actions/checkout@${sha}\n`, 'w.yml')
    expect(pin?.major).toBeNull()
    expect(pin?.ref).toBe(sha)
  })

  it('reports major as null for a branch ref', () => {
    const [pin] = parseActionPins('    uses: actions/checkout@main\n', 'w.yml')
    expect(pin?.major).toBeNull()
  })

  it('flags a commented-out reference as commented', () => {
    const [pin] = parseActionPins('  #     - uses: actions/checkout@v7\n', 'w.yml')
    expect(pin?.commented).toBe(true)
    expect(pin?.action).toBe('actions/checkout')
  })

  it('skips local action references', () => {
    expect(parseActionPins('    uses: ./.github/actions/setup\n', 'w.yml')).toEqual([])
  })

  it('skips Docker action references', () => {
    expect(parseActionPins('    uses: docker://alpine:3.20\n', 'w.yml')).toEqual([])
  })

  it('skips a reference with no @ref at all', () => {
    expect(parseActionPins('    uses: actions/checkout\n', 'w.yml')).toEqual([])
  })

  it('ignores lines that are not `uses:` steps', () => {
    const yaml = ['jobs:', '  build:', '    runs-on: ubuntu-latest'].join('\n')
    expect(parseActionPins(yaml, 'w.yml')).toEqual([])
  })

  it('returns every pin in a multi-step file, in order', () => {
    const yaml = [
      '      - uses: actions/checkout@v7',
      '      - uses: pnpm/action-setup@v6',
      '      - uses: actions/setup-node@v7',
    ].join('\n')
    expect(parseActionPins(yaml, 'w.yml').map((p) => p.action)).toEqual([
      'actions/checkout',
      'pnpm/action-setup',
      'actions/setup-node',
    ])
  })
})

// ---------------------------------------------------------------------------
// findPinProblems
// ---------------------------------------------------------------------------

describe('findPinProblems', () => {
  const pin = (action: string, ref: string, major: number | null): ActionPin => ({
    action,
    ref,
    major,
    file: 'w.yml',
    line: 1,
    commented: false,
  })

  it('accepts a pin at its floor', () => {
    expect(findPinProblems([pin('actions/checkout', 'v5', 5)])).toEqual([])
  })

  it('accepts a pin above its floor', () => {
    expect(findPinProblems([pin('actions/checkout', 'v7', 7)])).toEqual([])
  })

  it('rejects a pin below its floor', () => {
    const problems = findPinProblems([pin('actions/checkout', 'v4', 4)])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ kind: 'below-floor', floor: 5 })
  })

  it('rejects every below-floor pin, not just the first', () => {
    const problems = findPinProblems([
      pin('actions/checkout', 'v4', 4),
      pin('pnpm/action-setup', 'v4', 4),
    ])
    expect(problems).toHaveLength(2)
    expect(problems.every((p) => p.kind === 'below-floor')).toBe(true)
  })

  it('rejects an action missing from the floor table', () => {
    const problems = findPinProblems([pin('some/new-action', 'v1', 1)])
    expect(problems[0]).toMatchObject({ kind: 'unknown-action' })
  })

  it('accepts any major for an action with no Node runtime', () => {
    expect(findPinProblems([pin('codecov/codecov-action', 'v5', 5)])).toEqual([])
  })

  it('rejects a ref whose major cannot be read', () => {
    const problems = findPinProblems([pin('actions/checkout', 'main', null)])
    expect(problems[0]).toMatchObject({ kind: 'unresolvable-ref' })
  })

  it('does not treat an inherited Object.prototype key as a classified action', () => {
    const problems = findPinProblems([pin('constructor', 'v1', 1)])
    expect(problems[0]).toMatchObject({ kind: 'unknown-action' })
  })

  it('honours a caller-supplied floor table', () => {
    const problems = findPinProblems([pin('actions/checkout', 'v7', 7)], {
      'actions/checkout': 9,
    })
    expect(problems[0]).toMatchObject({ kind: 'below-floor', floor: 9 })
  })

  it('returns no problems for an empty pin list', () => {
    expect(findPinProblems([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// formatPinProblem
// ---------------------------------------------------------------------------

describe('formatPinProblem', () => {
  const stale: ActionPin = {
    action: 'actions/checkout',
    ref: 'v4',
    major: 4,
    file: '.github/workflows/ci.yml',
    line: 92,
    commented: false,
  }

  it('names the file, line, pin and required floor for a stale pin', () => {
    const message = formatPinProblem({ kind: 'below-floor', pin: stale, floor: 5 })
    expect(message).toContain('.github/workflows/ci.yml:92')
    expect(message).toContain('actions/checkout@v4')
    expect(message).toContain('v5')
  })

  it('tells the reader to classify an unknown action', () => {
    const message = formatPinProblem({ kind: 'unknown-action', pin: stale })
    expect(message).toContain('NODE24_MAJOR_FLOOR')
  })

  it('explains that an unreadable ref cannot be audited', () => {
    const message = formatPinProblem({ kind: 'unresolvable-ref', pin: stale })
    expect(message).toContain('cannot be audited')
  })
})

// ---------------------------------------------------------------------------
// The real workflows — this is the assertion the item exists for
// ---------------------------------------------------------------------------

/** Every workflow YAML shipped by this repo: live CI plus consumable templates. */
function workflowFiles(): string[] {
  return ['.github/workflows', 'workflow-templates']
    .flatMap((dir) =>
      readdirSync(join(repoRoot, dir))
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
        .map((name) => join(repoRoot, dir, name)),
    )
    .sort()
}

describe('repository workflows', () => {
  const files = workflowFiles()
  const pins = files.flatMap((file) =>
    parseActionPins(readFileSync(file, 'utf8'), relative(repoRoot, file)),
  )

  it('finds workflow files to audit', () => {
    // Guards against the audit silently passing because the glob went stale.
    expect(files.length).toBeGreaterThan(0)
  })

  it('finds action pins to audit', () => {
    expect(pins.length).toBeGreaterThan(0)
  })

  it('pins every action to a major that runs on Node 24', () => {
    const problems = findPinProblems(pins)
    expect(problems.map(formatPinProblem)).toEqual([])
  })

  it('classifies exactly the actions the workflows use, with no stale entries', () => {
    // A floor entry for an action nobody uses is dead weight that will rot;
    // drop it when the last reference goes away.
    const used = new Set(pins.map((p) => p.action))
    expect([...Object.keys(NODE24_MAJOR_FLOOR)].sort()).toEqual([...used].sort())
  })
})
