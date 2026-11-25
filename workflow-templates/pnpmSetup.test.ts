// @vitest-environment node
//
// Like actionPins.test.ts and gateSteps.test.ts, this suite reads workflow
// files off disk and resolves them relative to `import.meta.url`. Under the
// project-default jsdom environment that URL is rewritten to an http: one and
// `fileURLToPath` throws, so this file opts back into the node environment —
// it needs a filesystem, not a DOM.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  parseUsesSteps,
  findPnpmSetupProblems,
  formatPnpmSetupProblem,
  PNPM_SETUP_ACTION,
  VERSION_INPUT,
  type UsesStep,
} from './pnpmSetup'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Build a step without repeating the unchanging fields at every call site. */
function step(overrides: Partial<UsesStep> & Pick<UsesStep, 'uses'>): UsesStep {
  const at = overrides.uses.indexOf('@')
  return {
    name: null,
    action: at === -1 ? overrides.uses : overrides.uses.slice(0, at),
    with: {},
    file: 'w.yml',
    line: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseUsesSteps
// ---------------------------------------------------------------------------

describe('parseUsesSteps', () => {
  it('reads name, uses and with from a step', () => {
    const yaml = [
      '      - name: Setup pnpm',
      '        uses: pnpm/action-setup@v6',
      '        with:',
      '          version: 10',
    ].join('\n')

    expect(parseUsesSteps(yaml, 'flake.yml')).toEqual([
      {
        name: 'Setup pnpm',
        uses: 'pnpm/action-setup@v6',
        action: 'pnpm/action-setup',
        with: { version: '10' },
        file: 'flake.yml',
        line: 1,
      },
    ])
  })

  it('reads a step whose first key is `uses:`', () => {
    const [parsed] = parseUsesSteps('      - uses: pnpm/action-setup@v6\n', 'ci.yml')
    expect(parsed).toMatchObject({ name: null, action: 'pnpm/action-setup', with: {} })
  })

  it('reports the line the step starts on, not the line `uses:` is on', () => {
    const yaml = ['', '      - name: Setup pnpm', '        uses: pnpm/action-setup@v6'].join('\n')
    expect(parseUsesSteps(yaml, 'ci.yml')[0]?.line).toBe(2)
  })

  it('records an empty `with:` for a step that declares none', () => {
    const yaml = ['      - name: Setup pnpm', '        uses: pnpm/action-setup@v6'].join('\n')
    expect(parseUsesSteps(yaml, 'ci.yml')[0]?.with).toEqual({})
  })

  it('reads a `with:` written as an inline flow mapping', () => {
    const yaml = [
      '      - uses: pnpm/action-setup@v6',
      '        with: { version: "10", run_install: false }',
    ].join('\n')
    expect(parseUsesSteps(yaml, 'ci.yml')[0]?.with).toEqual({
      version: '10',
      run_install: 'false',
    })
  })

  it('strips quotes from a scalar value', () => {
    const yaml = ['      - uses: pnpm/action-setup@v6', '        with:', "          version: '10'"].join(
      '\n',
    )
    expect(parseUsesSteps(yaml, 'ci.yml')[0]?.with).toEqual({ version: '10' })
  })

  it('keeps an expression value intact', () => {
    const yaml = [
      '      - uses: pnpm/action-setup@v6',
      '        with:',
      '          version: ${{ env.PNPM_VERSION }}',
    ].join('\n')
    expect(parseUsesSteps(yaml, 'ci.yml')[0]?.with).toEqual({
      version: '${{ env.PNPM_VERSION }}',
    })
  })

  it('does not leak one step’s `with:` into the next step', () => {
    const yaml = [
      '      - name: Setup pnpm',
      '        uses: pnpm/action-setup@v6',
      '        with:',
      '          version: 10',
      '      - name: Setup Node',
      '        uses: actions/setup-node@v7',
      '        with:',
      '          node-version: 22',
    ].join('\n')

    const steps = parseUsesSteps(yaml, 'ci.yml')
    expect(steps).toHaveLength(2)
    expect(steps[0]?.with).toEqual({ version: '10' })
    expect(steps[1]?.with).toEqual({ 'node-version': '22' })
  })

  it('reads a step that follows one with no `with:` at all', () => {
    const yaml = [
      '      - name: Checkout',
      '        uses: actions/checkout@v7',
      '',
      '      - name: Setup pnpm',
      '        uses: pnpm/action-setup@v6',
    ].join('\n')

    const steps = parseUsesSteps(yaml, 'ci.yml')
    expect(steps.map((s) => s.action)).toEqual(['actions/checkout', 'pnpm/action-setup'])
  })

  it('skips `run:` steps', () => {
    const yaml = ['      - name: Install', '        run: pnpm install'].join('\n')
    expect(parseUsesSteps(yaml, 'ci.yml')).toEqual([])
  })

  it('skips a commented-out step', () => {
    const yaml = [
      '  #     - uses: pnpm/action-setup@v6',
      '  #       with: { version: "10" }',
    ].join('\n')
    expect(parseUsesSteps(yaml, 'codecov.yml')).toEqual([])
  })

  it('ignores a comment line inside a step body', () => {
    const yaml = [
      '      - name: Setup pnpm',
      '        # No `version:` input — the pin lives in package.json.',
      '        uses: pnpm/action-setup@v6',
    ].join('\n')
    expect(parseUsesSteps(yaml, 'ci.yml')[0]).toMatchObject({
      action: 'pnpm/action-setup',
      with: {},
    })
  })

  it('reads an action reference with no @ref as its own action', () => {
    const [parsed] = parseUsesSteps('      - uses: ./.github/actions/setup\n', 'ci.yml')
    expect(parsed?.action).toBe('./.github/actions/setup')
  })

  it('ignores lines that are not steps', () => {
    const yaml = ['jobs:', '  build:', '    runs-on: ubuntu-latest'].join('\n')
    expect(parseUsesSteps(yaml, 'ci.yml')).toEqual([])
  })

  it('returns nothing for empty content', () => {
    expect(parseUsesSteps('', 'ci.yml')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findPnpmSetupProblems
// ---------------------------------------------------------------------------

describe('findPnpmSetupProblems', () => {
  const setup = (inputs: Record<string, string> = {}) =>
    step({ uses: 'pnpm/action-setup@v6', name: 'Setup pnpm', with: inputs })

  it('accepts `packageManager` alone', () => {
    expect(findPnpmSetupProblems([setup()], 'pnpm@10.33.0')).toEqual([])
  })

  it('accepts a `version:` input alone', () => {
    expect(findPnpmSetupProblems([setup({ version: '10' })], null)).toEqual([])
  })

  it('rejects both sources at once', () => {
    const problems = findPnpmSetupProblems([setup({ version: '10' })], 'pnpm@10.33.0')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      kind: 'version-and-package-manager',
      version: '10',
      packageManager: 'pnpm@10.33.0',
    })
  })

  it('rejects both sources when the version is an expression', () => {
    const problems = findPnpmSetupProblems(
      [setup({ version: '${{ env.PNPM_VERSION }}' })],
      'pnpm@10.33.0',
    )
    expect(problems[0]).toMatchObject({ kind: 'version-and-package-manager' })
  })

  it('rejects neither source being present', () => {
    const problems = findPnpmSetupProblems([setup()], null)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ kind: 'no-version-source' })
  })

  it('treats an absent `packageManager` the same whether null or undefined', () => {
    expect(findPnpmSetupProblems([setup()], undefined)).toEqual(
      findPnpmSetupProblems([setup()], null),
    )
  })

  it('rejects every offending step, not just the first', () => {
    const problems = findPnpmSetupProblems(
      [setup({ version: '10' }), setup({ version: '9' })],
      'pnpm@10.33.0',
    )
    expect(problems).toHaveLength(2)
  })

  it('ignores steps for other actions', () => {
    const other = step({ uses: 'actions/setup-node@v7', with: { 'node-version': '22' } })
    expect(findPnpmSetupProblems([other], 'pnpm@10.33.0')).toEqual([])
  })

  it('does not read an inherited Object.prototype key as a `version:` input', () => {
    // `{}.constructor` is truthy, so a naive `step.with[VERSION_INPUT]` lookup
    // would see a version on a step that declares none.
    const problems = findPnpmSetupProblems([setup()], 'pnpm@10.33.0')
    expect(problems).toEqual([])
  })

  it('returns no problems for an empty step list', () => {
    expect(findPnpmSetupProblems([], 'pnpm@10.33.0')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// formatPnpmSetupProblem
// ---------------------------------------------------------------------------

describe('formatPnpmSetupProblem', () => {
  it('names the file, line and step for the both-sources case', () => {
    const [problem] = findPnpmSetupProblems(
      [
        step({
          uses: 'pnpm/action-setup@v6',
          name: 'Setup pnpm',
          with: { version: '10' },
          file: '.github/workflows/flake.yml',
          line: 68,
        }),
      ],
      'pnpm@10.33.0',
    )

    const message = formatPnpmSetupProblem(problem!)
    expect(message).toContain('.github/workflows/flake.yml:68')
    expect(message).toContain('"Setup pnpm"')
    expect(message).toContain(VERSION_INPUT)
    expect(message).toContain('pnpm@10.33.0')
  })

  it('falls back to the action reference for an unnamed step', () => {
    const [problem] = findPnpmSetupProblems(
      [step({ uses: 'pnpm/action-setup@v6', with: { version: '10' } })],
      'pnpm@10.33.0',
    )
    expect(formatPnpmSetupProblem(problem!)).toContain('pnpm/action-setup@v6')
  })

  it('explains the no-version case', () => {
    const [problem] = findPnpmSetupProblems([step({ uses: 'pnpm/action-setup@v6' })], null)
    expect(formatPnpmSetupProblem(problem!)).toContain('packageManager')
  })
})

// ---------------------------------------------------------------------------
// This repository's live workflows
// ---------------------------------------------------------------------------
//
// Only `.github/workflows` — see the header of pnpmSetup.ts for why
// `workflow-templates/` is deliberately out of scope.

function liveWorkflowFiles(): string[] {
  const dir = join(repoRoot, '.github', 'workflows')
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => join(dir, name))
    .sort()
}

function packageManagerPin(): string | null {
  const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  if (typeof manifest !== 'object' || manifest === null) return null
  const { packageManager } = manifest as { packageManager?: unknown }
  return typeof packageManager === 'string' ? packageManager : null
}

describe('repository workflows', () => {
  const files = liveWorkflowFiles()
  const steps = files.flatMap((file) =>
    parseUsesSteps(readFileSync(file, 'utf8'), relative(repoRoot, file)),
  )
  const pnpmSteps = steps.filter((s) => s.action === PNPM_SETUP_ACTION)

  it('finds workflow files to audit', () => {
    // Guards against the audit silently passing because the glob went stale.
    expect(files.length).toBeGreaterThan(0)
  })

  it('finds pnpm setup steps to audit', () => {
    // Guards against the audit silently passing because the parser went stale
    // against a step shape someone rewrote.
    expect(pnpmSteps.length).toBeGreaterThan(0)
  })

  it('finds a pnpm setup step in every workflow that installs dependencies', () => {
    // Every live workflow here runs `pnpm install`, so every one of them needs
    // a setup step; a file missing from this list is one the audit never sees.
    const withPnpmSetup = new Set(pnpmSteps.map((s) => s.file))
    expect([...withPnpmSetup].sort()).toEqual(files.map((f) => relative(repoRoot, f)).sort())
  })

  it('pins the pnpm version in exactly one place on every setup step', () => {
    const problems = findPnpmSetupProblems(steps, packageManagerPin())
    expect(problems.map(formatPnpmSetupProblem)).toEqual([])
  })
})
