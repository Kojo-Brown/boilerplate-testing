// @vitest-environment node
//
// Like actionPins.test.ts, this suite reads workflow files off disk and
// resolves them relative to `import.meta.url`. Under the project-default jsdom
// environment that URL is rewritten to an http: one and `fileURLToPath`
// throws, so this file opts back into the node environment.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  parseRunSteps,
  pnpmScriptOf,
  findGateProblems,
  formatGateProblem,
  GATED_SCRIPTS,
  THROW_DEPRECATION,
  type RunStep,
} from './gateSteps'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Build a step without repeating the unchanging fields at every call site. */
function step(overrides: Partial<RunStep> & Pick<RunStep, 'run'>): RunStep {
  return { name: null, env: {}, file: 'w.yml', line: 1, ...overrides }
}

// ---------------------------------------------------------------------------
// parseRunSteps
// ---------------------------------------------------------------------------

describe('parseRunSteps', () => {
  it('reads name, run and env from a step', () => {
    const yaml = [
      '      - name: Typecheck',
      '        run: pnpm typecheck',
      '        env:',
      '          NODE_OPTIONS: --throw-deprecation',
    ].join('\n')

    expect(parseRunSteps(yaml, 'ci.yml')).toEqual([
      {
        name: 'Typecheck',
        run: 'pnpm typecheck',
        env: { NODE_OPTIONS: '--throw-deprecation' },
        file: 'ci.yml',
        line: 1,
      },
    ])
  })

  it('reports the line the step starts on, not the line `run:` is on', () => {
    const yaml = ['', '      - name: Lint', '        run: pnpm lint'].join('\n')
    expect(parseRunSteps(yaml, 'ci.yml')[0]?.line).toBe(2)
  })

  it('reads a step whose first key is `run:`', () => {
    const [parsed] = parseRunSteps('      - run: pnpm test\n', 'ci.yml')
    expect(parsed).toMatchObject({ name: null, run: 'pnpm test' })
  })

  it('skips a step that has no `run:`', () => {
    const yaml = ['      - name: Checkout', '        uses: actions/checkout@v7'].join('\n')
    expect(parseRunSteps(yaml, 'ci.yml')).toEqual([])
  })

  it('reads every env entry of a multi-key mapping', () => {
    const yaml = [
      '      - name: Unit tests',
      '        run: pnpm test',
      '        env:',
      '          NODE_OPTIONS: --throw-deprecation',
      '          CI: "true"',
    ].join('\n')

    expect(parseRunSteps(yaml, 'ci.yml')[0]?.env).toEqual({
      NODE_OPTIONS: '--throw-deprecation',
      CI: '"true"',
    })
  })

  it('joins a block scalar into one run string', () => {
    const yaml = [
      '      - name: Guard',
      '        run: |',
      '          echo one',
      '          echo two',
      '      - name: After',
      '        run: pnpm test',
    ].join('\n')

    const steps = parseRunSteps(yaml, 'ci.yml')
    expect(steps).toHaveLength(2)
    expect(steps[0]?.run).toBe('echo one\necho two')
    expect(steps[1]?.run).toBe('pnpm test')
  })

  it('does not leak one step’s env onto the next', () => {
    const yaml = [
      '      - name: Typecheck',
      '        run: pnpm typecheck',
      '        env:',
      '          NODE_OPTIONS: --throw-deprecation',
      '',
      '      - name: Build',
      '        run: pnpm build',
    ].join('\n')

    const steps = parseRunSteps(yaml, 'ci.yml')
    expect(steps).toHaveLength(2)
    expect(steps[1]?.env).toEqual({})
  })

  it('reads steps from more than one job', () => {
    const yaml = [
      'jobs:',
      '  a:',
      '    steps:',
      '      - run: pnpm test',
      '  b:',
      '    steps:',
      '      - run: pnpm build',
    ].join('\n')

    expect(parseRunSteps(yaml, 'ci.yml').map((s) => s.run)).toEqual(['pnpm test', 'pnpm build'])
  })

  it('returns nothing for a workflow with no steps', () => {
    expect(parseRunSteps('name: CI\non: [push]\n', 'ci.yml')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// pnpmScriptOf
// ---------------------------------------------------------------------------

describe('pnpmScriptOf', () => {
  it('reads the script name from a plain invocation', () => {
    expect(pnpmScriptOf('pnpm typecheck')).toBe('typecheck')
  })

  it('reads the script name through an explicit `run`', () => {
    expect(pnpmScriptOf('pnpm run build')).toBe('build')
  })

  it('reads a script name containing a colon', () => {
    expect(pnpmScriptOf('pnpm test:e2e --project=chromium')).toBe('test:e2e')
  })

  it('resolves `pnpm install` to install rather than to a gate', () => {
    expect(pnpmScriptOf('pnpm install --frozen-lockfile --strict-peer-dependencies')).toBe(
      'install',
    )
  })

  it('resolves `pnpm exec` to exec rather than to the binary it runs', () => {
    expect(pnpmScriptOf('pnpm exec playwright install')).toBe('exec')
  })

  it('reads the leading command of a block scalar', () => {
    expect(pnpmScriptOf('pnpm build\necho done')).toBe('build')
  })

  it('returns null for a command that is not pnpm', () => {
    expect(pnpmScriptOf('echo "All CI jobs passed"')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findGateProblems
// ---------------------------------------------------------------------------

describe('findGateProblems', () => {
  it('passes a gate step that sets the flag', () => {
    const gated = step({ run: 'pnpm build', env: { NODE_OPTIONS: THROW_DEPRECATION } })
    expect(findGateProblems([gated])).toEqual([])
  })

  it('flags a gate step with no env block at all', () => {
    const problems = findGateProblems([step({ name: 'Build', run: 'pnpm build' })])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ kind: 'missing-node-options', script: 'build' })
  })

  it('flags a gate step whose NODE_OPTIONS omits the flag', () => {
    const problems = findGateProblems([
      step({ run: 'pnpm test', env: { NODE_OPTIONS: '--max-old-space-size=4096' } }),
    ])
    expect(problems[0]).toMatchObject({ kind: 'missing-flag', script: 'test' })
  })

  it('accepts the flag alongside other NODE_OPTIONS', () => {
    const gated = step({
      run: 'pnpm test',
      env: { NODE_OPTIONS: `--max-old-space-size=4096 ${THROW_DEPRECATION}` },
    })
    expect(findGateProblems([gated])).toEqual([])
  })

  it('does not accept a flag that merely contains the name as a substring', () => {
    const near = step({ run: 'pnpm lint', env: { NODE_OPTIONS: '--no-throw-deprecation' } })
    expect(findGateProblems([near])[0]).toMatchObject({ kind: 'missing-flag' })
  })

  it('ignores a step that runs no gate script', () => {
    expect(findGateProblems([step({ run: 'pnpm install --frozen-lockfile' })])).toEqual([])
    expect(findGateProblems([step({ run: 'echo hello' })])).toEqual([])
  })

  it('honours a caller-supplied script list', () => {
    const problems = findGateProblems([step({ run: 'pnpm coverage' })], ['coverage'])
    expect(problems[0]).toMatchObject({ script: 'coverage' })
  })

  it('returns no problems for an empty step list', () => {
    expect(findGateProblems([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// formatGateProblem
// ---------------------------------------------------------------------------

describe('formatGateProblem', () => {
  const build = step({
    name: 'Build',
    run: 'pnpm build',
    file: '.github/workflows/ci.yml',
    line: 140,
  })

  it('names the file, line and step, and says what to add', () => {
    const message = formatGateProblem({ kind: 'missing-node-options', step: build, script: 'build' })
    expect(message).toContain('.github/workflows/ci.yml:140')
    expect(message).toContain('"Build"')
    expect(message).toContain(THROW_DEPRECATION)
  })

  it('quotes the NODE_OPTIONS that were set when the flag is missing', () => {
    const message = formatGateProblem({
      kind: 'missing-flag',
      step: { ...build, env: { NODE_OPTIONS: '--enable-source-maps' } },
      script: 'build',
    })
    expect(message).toContain('--enable-source-maps')
  })

  it('falls back to the script name for an unnamed step', () => {
    const message = formatGateProblem({
      kind: 'missing-node-options',
      step: { ...build, name: null },
      script: 'build',
    })
    expect(message).toContain('pnpm build')
  })
})

// ---------------------------------------------------------------------------
// The real workflow — this is the assertion the item exists for
// ---------------------------------------------------------------------------

describe('.github/workflows/ci.yml', () => {
  const file = '.github/workflows/ci.yml'
  const steps = parseRunSteps(readFileSync(join(repoRoot, file), 'utf8'), file)
  const gateScripts = steps
    .map((s) => pnpmScriptOf(s.run))
    .filter((script): script is string => script !== null && GATED_SCRIPTS.includes(script))

  it('still runs every gate script', () => {
    // Guards against the audit passing because a gate was deleted rather than
    // because every gate is covered.
    expect([...gateScripts].sort()).toEqual([...GATED_SCRIPTS].sort())
  })

  it('runs every gate step under --throw-deprecation', () => {
    const problems = findGateProblems(steps)
    expect(problems.map(formatGateProblem)).toEqual([])
  })
})
