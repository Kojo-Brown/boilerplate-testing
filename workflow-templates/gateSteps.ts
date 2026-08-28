// Auditing which CI gate steps run under `--throw-deprecation`.
//
// Why this exists: `NODE_OPTIONS: --throw-deprecation` turns a Node runtime
// deprecation warning into a thrown error, which is the only way a
// `DeprecationWarning` — ours or a dependency's — fails a job instead of
// scrolling past in the log. It is set per step rather than job-wide, and a
// per-step setting is exactly the kind of thing a later edit drops silently:
// removing the `env:` block changes no observable behaviour until the day some
// dependency starts calling a deprecated API, at which point the warning is
// simply not seen. Nothing in the build fails in the meantime.
//
// So the enforcement is audited as text, the same way `actionPins.ts` audits
// action pins. `GATED_SCRIPTS` is the deliberate part: it lists the pnpm
// scripts whose CI step must carry the flag. A gate that loses its `env:`
// block, or a new gate added without one, fails `pnpm test`.
//
// The parser below reads the step shape this repository writes — a `- name:`
// / `run:` / `env:` block list — rather than pulling in a YAML dependency for
// one file. It is deliberately narrow: `parseRunSteps` only claims to find
// steps that have a `run:`, which is all this audit needs.

/** A `run:` step read out of a workflow file. */
export interface RunStep {
  /** The step's `name:`, or `null` for an unnamed step. */
  name: string | null
  /** The `run:` script, with a block scalar (`run: |`) joined by newlines. */
  run: string
  /** The step's `env:` mapping; empty when the step declares none. */
  env: Readonly<Record<string, string>>
  /** Path of the file the step was read from, as passed in by the caller. */
  file: string
  /** 1-indexed line number of the line the step starts on. */
  line: number
}

/** A gate step the audit refuses to vouch for, and why. */
export type GateProblem =
  | { kind: 'missing-node-options'; step: RunStep; script: string }
  | { kind: 'missing-flag'; step: RunStep; script: string }

/** The `NODE_OPTIONS` flag every gate step must carry. */
export const THROW_DEPRECATION = '--throw-deprecation'

/**
 * pnpm scripts whose CI step must run under {@link THROW_DEPRECATION}.
 *
 * These are the five gates CLAUDE.md prescribes minus `install`, which is
 * pnpm's own CLI rather than a Node process running this repository's code —
 * pnpm spawns the install under its own runtime and `NODE_OPTIONS` on that
 * step would police the package manager, not the build.
 *
 * `build` is on this list as of the Storybook 10 upgrade. Under 9.1.20 it
 * could not satisfy the flag: `getPortableStoriesFileCountUncached` passed an
 * argument array to execa with `shell: true`, which is DEP0190 on Node 24+,
 * and it runs during post-build metadata extraction — so `storybook build`
 * exited 7 with `storybook-static/` already complete. Storybook 10 calls
 * `execCommandCountLines('git', ['grep', ...])` with no shell, so the warning
 * is gone at the source.
 *
 * It also needs `patches/storybook@10.5.5.patch`, which clears the DEP0205
 * `module.register()` call that surfaced underneath DEP0190 on Node 26. That
 * patch is audited by `patchedDeps.ts` for the same reason this file exists:
 * losing it changes nothing observable until a gate quietly stops enforcing.
 *
 * `shape:check` joined the list with the test-suite shape gate. It spawns
 * `vitest list` and `playwright test --list` as child processes to count tests
 * exactly, so it is the one gate whose own work happens in a subprocess — the
 * flag still applies to the parent, which is where the census, the join and the
 * policy evaluation run.
 *
 * `mutation:check` joined it with the mutation-score gate, and it is the one
 * entry that lives in a different job from the rest — the mutation run is a
 * property of the tests rather than of the runtime, so it runs once instead of
 * once per Node major. That makes no difference to this audit, which reads
 * every `run:` step in the file regardless of the job it sits in, and it is
 * the reason the flag matters more there than anywhere else: it is the only
 * gate whose Node version is not covered by the matrix, so a deprecation it
 * would have caught has exactly one chance to be seen.
 */
export const GATED_SCRIPTS: readonly string[] = [
  'typecheck',
  'lint',
  'test',
  'shape:check',
  'build',
  'mutation:check',
]

// A step begins with a `- ` at the start of a list item; the key that follows
// may be any of `name`, `run` or `uses` depending on how the step is written.
const STEP_START = /^(\s*)-\s+(\w+):\s*(.*)$/
// A `key: value` line inside a step or an `env:` mapping.
const KEY_LINE = /^(\s*)([\w.-]+):\s*(.*)$/

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function isBlank(line: string): boolean {
  return line.trim() === '' || line.trimStart().startsWith('#')
}

/**
 * Extract every step that declares a `run:` from the text of one workflow file.
 *
 * Steps without a `run:` (`uses:` steps, for instance) are skipped: they
 * execute an action rather than a Node process of ours, so `NODE_OPTIONS` on
 * them would not be the same claim.
 */
export function parseRunSteps(content: string, file: string): RunStep[] {
  const lines = content.split('\n')
  const steps: RunStep[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue

    const start = STEP_START.exec(line)
    if (!start) continue

    const dashIndent = start[1]?.length ?? 0
    const keyIndent = dashIndent + 2
    const startLine = index + 1

    let name: string | null = null
    let run: string | null = null
    const env: Record<string, string> = {}

    // Re-read the step's first key as though it sat on its own line, so
    // `- name: X` and a following `run: Y` are handled by one code path.
    let cursor = index
    let pending: [string, string] | null = [start[2] ?? '', start[3] ?? '']

    while (cursor < lines.length) {
      let key: string
      let value: string

      if (pending) {
        ;[key, value] = pending
        pending = null
      } else {
        cursor += 1
        const next = lines[cursor]
        if (next === undefined) break
        if (isBlank(next)) continue
        // Dedent to the step list, or a new `- ` item, ends this step.
        if (indentOf(next) < keyIndent) break
        if (STEP_START.test(next)) break

        const keyed = KEY_LINE.exec(next)
        if (!keyed || (keyed[1]?.length ?? 0) !== keyIndent) continue
        key = keyed[2] ?? ''
        value = keyed[3] ?? ''
      }

      if (key === 'name') {
        name = value.trim() || null
      } else if (key === 'run') {
        run = value === '|' || value === '|-' ? readBlock(lines, cursor, keyIndent) : value.trim()
        if (value === '|' || value === '|-') cursor = skipBlock(lines, cursor, keyIndent)
      } else if (key === 'env') {
        readMapping(lines, cursor, keyIndent, env)
        cursor = skipBlock(lines, cursor, keyIndent)
      }
    }

    if (run !== null) {
      steps.push({ name, run, env, file, line: startLine })
    }

    // Resume scanning from the line after the step's first line. Nested
    // content is re-examined, but only a `- key:` line can open a step, so a
    // mapping entry inside `env:` cannot be mistaken for one.
  }

  return steps
}

/** Collect the indented lines following a block-scalar or mapping key. */
function blockLines(lines: readonly string[], keyIndex: number, keyIndent: number): string[] {
  const collected: string[] = []
  for (let index = keyIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) break
    if (isBlank(line)) continue
    if (indentOf(line) <= keyIndent) break
    collected.push(line)
  }
  return collected
}

function readBlock(lines: readonly string[], keyIndex: number, keyIndent: number): string {
  return blockLines(lines, keyIndex, keyIndent)
    .map((line) => line.trim())
    .join('\n')
}

function skipBlock(lines: readonly string[], keyIndex: number, keyIndent: number): number {
  return keyIndex + blockLines(lines, keyIndex, keyIndent).length
}

function readMapping(
  lines: readonly string[],
  keyIndex: number,
  keyIndent: number,
  into: Record<string, string>,
): void {
  for (const line of blockLines(lines, keyIndex, keyIndent)) {
    const keyed = KEY_LINE.exec(line)
    if (!keyed) continue
    const key = keyed[2]
    if (key === undefined) continue
    into[key] = (keyed[3] ?? '').trim()
  }
}

/**
 * Return the pnpm script a `run:` line invokes, or `null` if it does not
 * invoke one.
 *
 * `pnpm install`, `pnpm exec …` and `pnpm dlx …` resolve to `install`, `exec`
 * and `dlx` — none of which are in {@link GATED_SCRIPTS}, so they are not
 * audited. Only the first command in the line is read; a `&&` chain resolves
 * to the script that leads it.
 */
export function pnpmScriptOf(run: string): string | null {
  const first = run.split('\n')[0]?.trim() ?? ''
  const match = /^pnpm(?:\s+run)?\s+([\w:.-]+)/.exec(first)
  return match?.[1] ?? null
}

/**
 * Audit gate steps for {@link THROW_DEPRECATION}.
 *
 * Returns one problem per offending step; an empty array means every step
 * running a script in `scripts` promotes Node deprecation warnings to errors.
 */
export function findGateProblems(
  steps: readonly RunStep[],
  scripts: readonly string[] = GATED_SCRIPTS,
): GateProblem[] {
  const problems: GateProblem[] = []

  for (const step of steps) {
    const script = pnpmScriptOf(step.run)
    if (script === null || !scripts.includes(script)) continue

    const nodeOptions = step.env['NODE_OPTIONS']
    if (nodeOptions === undefined) {
      problems.push({ kind: 'missing-node-options', step, script })
      continue
    }

    if (!nodeOptions.split(/\s+/).includes(THROW_DEPRECATION)) {
      problems.push({ kind: 'missing-flag', step, script })
    }
  }

  return problems
}

/** Render a problem as a single actionable line for a test failure message. */
export function formatGateProblem(problem: GateProblem): string {
  const { step, script } = problem
  const where = `${step.file}:${step.line}`
  const label = step.name === null ? `\`pnpm ${script}\`` : `"${step.name}"`

  switch (problem.kind) {
    case 'missing-node-options':
      return `${where} — gate step ${label} declares no NODE_OPTIONS, so a Node deprecation warning would not fail the job; add \`env: { NODE_OPTIONS: ${THROW_DEPRECATION} }\``
    case 'missing-flag':
      return `${where} — gate step ${label} sets NODE_OPTIONS to "${step.env['NODE_OPTIONS'] ?? ''}", which does not include ${THROW_DEPRECATION}`
  }
}
