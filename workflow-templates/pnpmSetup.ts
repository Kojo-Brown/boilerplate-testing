// Auditing how this repository's own workflows set pnpm up.
//
// Why this exists: `pnpm/action-setup` resolves the pnpm version from two
// places — a `version:` input on the step, and the `packageManager` field in
// package.json. Under v6 supplying *both* is a hard error:
//
//     Error: Multiple versions of pnpm specified:
//       - version 10 in the GitHub Action config with the key "version"
//       - version pnpm@10.33.0 in the package.json with the key "packageManager"
//
// The step fails before `pnpm install` runs, so every step after it is skipped
// and the job is red from its second action onwards. That is a loud failure in
// a workflow something watches and a silent one in a workflow nothing does:
// `flake.yml` is nightly with no pull-request trigger — deliberately, because
// while the quarantine registry is empty it is the main suite run twice — so
// the pull request that introduced it was green, and all 42 scheduled runs
// between 2026-10-14 and 2026-11-25 failed at this step without ever
// executing the quarantine suite, the dashboard, or either artifact upload.
// Nothing in `pnpm test` could see it and nothing in `ci.yml` could either.
//
// So the agreement is audited as text, the same way `actionPins.ts` audits
// action pins and `gateSteps.ts` audits per-step `env:` blocks. The invariant
// is two-sided, because exactly one of the two sources must supply the
// version: with `packageManager` pinned a `version:` input is the error above,
// and without it a step carrying no `version:` has nothing to resolve.
//
// ---------------------------------------------------------------------------
// Scope: this repository's live workflows only
// ---------------------------------------------------------------------------
// `.github/workflows` is audited and `workflow-templates/` is not, and the
// difference is the point rather than an omission. The templates are generic
// files for a consumer to copy into a repository this audit knows nothing
// about; a consumer whose package.json does not pin `packageManager` needs the
// `version:` input those templates carry, and passing it is correct there. The
// rule below is a claim about a workflow and the package.json beside it, so it
// can only be checked where both are known — which is here.

/** A `uses:` step read out of a workflow file, with its `with:` inputs. */
export interface UsesStep {
  /** The step's `name:`, or `null` for an unnamed step. */
  name: string | null
  /** The action reference, e.g. `pnpm/action-setup@v6`. */
  uses: string
  /** The action without its `@ref`, e.g. `pnpm/action-setup`. */
  action: string
  /** The step's `with:` mapping; empty when the step declares none. */
  with: Readonly<Record<string, string>>
  /** Path of the file the step was read from, as passed in by the caller. */
  file: string
  /** 1-indexed line number of the line the step starts on. */
  line: number
}

/** A pnpm setup step the audit refuses to vouch for, and why. */
export type PnpmSetupProblem =
  /** Both sources supply a version: the hard error quoted above. */
  | { kind: 'version-and-package-manager'; step: UsesStep; version: string; packageManager: string }
  /** Neither source supplies one, so the action has nothing to resolve. */
  | { kind: 'no-version-source'; step: UsesStep }

/** The action this audit is about. */
export const PNPM_SETUP_ACTION = 'pnpm/action-setup'

/** The `with:` input that names a pnpm version explicitly. */
export const VERSION_INPUT = 'version'

// A step begins with a `- ` at the start of a list item; the key that follows
// may be `name` or `uses` depending on how the step is written.
const STEP_START = /^(\s*)-\s+(\w+):\s*(.*)$/
// A `key: value` line inside a step or a `with:` mapping.
const KEY_LINE = /^(\s*)([\w.-]+):\s*(.*)$/
// An inline flow mapping: `with: { version: "10" }`.
const INLINE_PAIR = /([\w.-]+)\s*:\s*("[^"]*"|'[^']*'|[^,}]+)/g

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function isBlank(line: string): boolean {
  return line.trim() === '' || line.trimStart().startsWith('#')
}

/** Strip one layer of matching quotes from a scalar, if present. */
function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  return quoted && trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed
}

/** Read the `key: value` pairs out of an inline flow mapping's braces. */
function parseInlineMapping(text: string): Record<string, string> {
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  if (open === -1 || close <= open) return {}

  const inputs: Record<string, string> = {}
  for (const match of text.slice(open + 1, close).matchAll(INLINE_PAIR)) {
    const [, key, value] = match
    if (key !== undefined && value !== undefined) inputs[key] = unquote(value)
  }
  return inputs
}

/**
 * Extract every step that declares a `uses:` from the text of one workflow
 * file, together with the inputs under its `with:`.
 *
 * Steps without a `uses:` (`run:` steps, for instance) are skipped — they are
 * `gateSteps.ts`'s subject, not this one's. Commented-out steps are skipped
 * too: a step behind a `#` runs nothing, so it cannot fail, and `codecov.yml`
 * carries one as documentation.
 *
 * The parser is deliberately narrow, as `gateSteps.ts`'s is: it reads the step
 * shape this repository writes rather than pulling in a YAML dependency for
 * one audit, and it claims only to find steps that have a `uses:`.
 */
export function parseUsesSteps(content: string, file: string): UsesStep[] {
  const lines = content.split('\n')
  const steps: UsesStep[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue

    const start = STEP_START.exec(line)
    if (!start || line.trimStart().startsWith('#')) continue

    const [, indent = '', firstKey, firstValue = ''] = start
    const stepIndent = indent.length
    // The keys of a step sit one list-marker's width in from the `- `.
    const bodyIndent = stepIndent + 2

    let name: string | null = null
    let uses: string | null = null
    let inputs: Record<string, string> = {}

    if (firstKey === 'name') name = unquote(firstValue)
    else if (firstKey === 'uses') uses = unquote(firstValue)
    else continue

    // Walk the rest of the step's body, stopping at the next list item or at
    // any line that dedents out of it.
    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const body = lines[cursor]
      if (body === undefined) break
      if (isBlank(body)) continue
      if (indentOf(body) < bodyIndent) break
      if (STEP_START.test(body) && indentOf(body) === stepIndent) break

      const key = KEY_LINE.exec(body)
      if (!key || indentOf(body) !== bodyIndent) continue

      const [, , keyName, keyValue = ''] = key
      if (keyName === 'name') name = unquote(keyValue)
      else if (keyName === 'uses') uses = unquote(keyValue)
      else if (keyName === 'with') {
        if (keyValue.trim().startsWith('{')) {
          inputs = parseInlineMapping(keyValue)
        } else {
          // A block mapping: every `key: value` indented past `with:`.
          for (let w = cursor + 1; w < lines.length; w += 1) {
            const input = lines[w]
            if (input === undefined) break
            if (isBlank(input)) continue
            if (indentOf(input) <= bodyIndent) break

            const pair = KEY_LINE.exec(input)
            const [, , inputKey, inputValue = ''] = pair ?? []
            if (inputKey !== undefined) inputs[inputKey] = unquote(inputValue)
          }
        }
      }
    }

    if (uses !== null) {
      const at = uses.indexOf('@')
      steps.push({
        name,
        uses,
        action: at === -1 ? uses : uses.slice(0, at),
        with: inputs,
        file,
        line: index + 1,
      })
    }

    index = cursor - 1
  }

  return steps
}

/**
 * Audit the pnpm setup steps among `steps` against the `packageManager` pin.
 *
 * `packageManager` is the field as package.json declares it (for example
 * `pnpm@10.33.0`), or `null`/`undefined` when the repository does not pin one.
 * Steps for other actions are ignored.
 *
 * Returns one problem per offending step; an empty array means exactly one of
 * the two version sources is in play on every pnpm setup step.
 */
export function findPnpmSetupProblems(
  steps: readonly UsesStep[],
  packageManager: string | null | undefined,
): PnpmSetupProblem[] {
  const problems: PnpmSetupProblem[] = []

  for (const step of steps) {
    if (step.action !== PNPM_SETUP_ACTION) continue

    const version = Object.prototype.hasOwnProperty.call(step.with, VERSION_INPUT)
      ? step.with[VERSION_INPUT]
      : undefined
    const pinned = packageManager ?? null

    if (version !== undefined && pinned !== null) {
      problems.push({ kind: 'version-and-package-manager', step, version, packageManager: pinned })
    } else if (version === undefined && pinned === null) {
      problems.push({ kind: 'no-version-source', step })
    }
  }

  return problems
}

/** Render a problem as the one-line message a failing audit prints. */
export function formatPnpmSetupProblem(problem: PnpmSetupProblem): string {
  const { step } = problem
  const where = `${step.file}:${step.line}`
  const which = step.name === null ? step.uses : `"${step.name}"`

  switch (problem.kind) {
    case 'version-and-package-manager':
      return (
        `${where}: step ${which} passes \`${VERSION_INPUT}: ${problem.version}\` to ` +
        `${PNPM_SETUP_ACTION} while package.json pins \`packageManager: ` +
        `${problem.packageManager}\`. Supplying both is a hard error under v6 and the ` +
        `step fails before \`pnpm install\` runs. Drop the \`${VERSION_INPUT}:\` input.`
      )
    case 'no-version-source':
      return (
        `${where}: step ${which} passes no \`${VERSION_INPUT}:\` input to ` +
        `${PNPM_SETUP_ACTION} and package.json pins no \`packageManager\`, so the action ` +
        `has no version to resolve. Pin \`packageManager\` in package.json.`
      )
  }
}
