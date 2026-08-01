// GitHub Actions pin auditing.
//
// Why this exists: an action declares its own JavaScript runtime in its
// `action.yml` (`runs.using: node20` / `node24`). When a pinned major is old
// enough to still declare `node20`, the runner prints
//
//     ##[warning] Node.js 20 is deprecated. Please update ...
//
// and *nothing in the build fails*. Every other warning class in this repo is
// already fatal — `--max-warnings 0` for lint, `--frozen-lockfile` for
// dependency drift, `strict-dep-builds` for postinstall scripts,
// `NODE_OPTIONS=--throw-deprecation` for Node runtime deprecations — but that
// one is emitted by the runner *about* the workflow, so no gate running
// *inside* the workflow can observe it. This module closes that hole by
// auditing the pins as text, which is something a unit test can do.
//
// The floor table below is the deliberate part: each entry records the first
// major of that action whose `action.yml` declares `node24`. Bumping a pin
// below its floor, or introducing an action that is not classified here at
// all, fails `pnpm test`.

/** A single `uses:` reference found in a workflow file. */
export interface ActionPin {
  /** `owner/repo`, with any sub-action path (`owner/repo/sub`) stripped. */
  action: string
  /** The ref exactly as written after `@`. */
  ref: string
  /** Major version parsed from a `vN`-style ref; `null` for a SHA or branch. */
  major: number | null
  /** Path of the file the pin was read from, as passed in by the caller. */
  file: string
  /** 1-indexed line number of the `uses:` line. */
  line: number
  /** True when the `uses:` line is commented out (an example, not a live step). */
  commented: boolean
}

/** A pin that the audit refuses to vouch for, and why. */
export type PinProblem =
  | { kind: 'below-floor'; pin: ActionPin; floor: number }
  | { kind: 'unknown-action'; pin: ActionPin }
  | { kind: 'unresolvable-ref'; pin: ActionPin }

/**
 * First major of each action whose `action.yml` declares `runs.using: node24`.
 *
 * A value of `null` means the action has no Node runtime at all (composite or
 * Docker), so the Node deprecation cycle does not apply and any major passes.
 * Every action used anywhere in this repo must appear here — an unclassified
 * action is a failure, not a pass, so that adding one forces this check.
 *
 * Verified against each action's `action.yml` at the tagged major:
 *   actions/checkout          v4 node20 → v5 node24
 *   actions/setup-node        v4 node20 → v5 node24
 *   actions/upload-artifact   v5 node20 → v6 node24
 *   actions/download-artifact v6 node20 → v7 node24
 *   pnpm/action-setup         v4 node20 → v5 node24
 *   gitleaks/gitleaks-action  v2 node20 → v3 node24
 *   codecov/codecov-action    composite at v5 and v7 — no Node runtime
 */
export const NODE24_MAJOR_FLOOR: Readonly<Record<string, number | null>> = {
  'actions/checkout': 5,
  'actions/setup-node': 5,
  'actions/upload-artifact': 6,
  'actions/download-artifact': 7,
  'pnpm/action-setup': 5,
  'gitleaks/gitleaks-action': 3,
  'codecov/codecov-action': null,
}

// Matches a `uses:` step reference, whether or not the line is commented out.
// Commented references are audited too: in a repository whose product is
// copy-paste templates, a commented example is something a consumer will
// uncomment, so a stale pin there is just as wrong as a live one.
const USES_LINE = /^\s*(?:#\s*)?(?:-\s*)?uses:\s*(\S+)/

/** A `vN`, `vN.N` or `vN.N.N` ref — the only shape a major can be read from. */
const VERSION_REF = /^v(\d+)(?:\.\d+){0,2}$/

/**
 * Extract every action pin from the text of one workflow file.
 *
 * Local (`./path`) and Docker (`docker://`) references are skipped: neither
 * resolves to a versioned marketplace action with its own Node runtime.
 */
export function parseActionPins(content: string, file: string): ActionPin[] {
  const pins: ActionPin[] = []

  content.split('\n').forEach((text, index) => {
    const match = USES_LINE.exec(text)
    if (!match) return

    const reference = match[1]
    if (reference === undefined) return
    if (reference.startsWith('./') || reference.startsWith('docker://')) return

    const at = reference.indexOf('@')
    if (at === -1) return

    const [owner, repo] = reference.slice(0, at).split('/')
    if (owner === undefined || repo === undefined) return

    const ref = reference.slice(at + 1)
    const version = VERSION_REF.exec(ref)

    pins.push({
      action: `${owner}/${repo}`,
      ref,
      major: version?.[1] === undefined ? null : Number(version[1]),
      file,
      line: index + 1,
      commented: text.trimStart().startsWith('#'),
    })
  })

  return pins
}

/**
 * Audit pins against {@link NODE24_MAJOR_FLOOR}.
 *
 * Returns one problem per offending pin; an empty array means every pin runs
 * on a Node 24 runtime (or has no Node runtime at all).
 */
export function findPinProblems(
  pins: readonly ActionPin[],
  floors: Readonly<Record<string, number | null>> = NODE24_MAJOR_FLOOR,
): PinProblem[] {
  const problems: PinProblem[] = []

  for (const pin of pins) {
    if (!Object.hasOwn(floors, pin.action)) {
      problems.push({ kind: 'unknown-action', pin })
      continue
    }

    const floor = floors[pin.action]
    // No Node runtime — the deprecation cycle does not apply.
    if (floor === null || floor === undefined) continue

    if (pin.major === null) {
      // A SHA or branch ref may well be fine, but this check reads text and
      // cannot tell which major it points at. Say so rather than pass it.
      problems.push({ kind: 'unresolvable-ref', pin })
      continue
    }

    if (pin.major < floor) problems.push({ kind: 'below-floor', pin, floor })
  }

  return problems
}

/** Render a problem as a single actionable line for a test failure message. */
export function formatPinProblem(problem: PinProblem): string {
  const { pin } = problem
  const where = `${pin.file}:${pin.line}`
  const pinned = `${pin.action}@${pin.ref}`

  switch (problem.kind) {
    case 'below-floor':
      return `${where} — ${pinned} runs on Node 20; bump to v${problem.floor} or later`
    case 'unknown-action':
      return `${where} — ${pinned} is not classified in NODE24_MAJOR_FLOOR; check its action.yml \`runs.using\` and add it`
    case 'unresolvable-ref':
      return `${where} — ${pinned} has no readable major version, so its runtime cannot be audited`
  }
}
