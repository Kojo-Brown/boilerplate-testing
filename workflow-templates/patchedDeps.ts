// Auditing the dependency patches the CI gates depend on.
//
// Why this exists: the `Build` gate runs under `NODE_OPTIONS=--throw-deprecation`
// (see `gateSteps.ts`) and can only do so because `patches/storybook@10.5.5.patch`
// removes a `module.register()` call that is DEP0205 on Node 26. A patch is a
// quiet thing to lose — pnpm applies it during install, and the only visible
// symptom of it going missing is one matrix leg failing three minutes later
// with a stack trace pointing into `node_modules`.
//
// The pin itself is the first line of defence: `pnpm.patchedDependencies` keys
// an *exact* version, so a Storybook bump makes pnpm refuse the install rather
// than resolve a version the patch was never written against. This audit is
// the second: it checks the pin against what is actually installed, that the
// referenced patch file exists, and that a patch entry names a package the
// manifest actually depends on. It fails `pnpm test` in a second, naming the
// mismatch, instead of leaving it to the build.
//
// When Storybook ships the upstream fix (storybookjs/storybook#35337), the
// patch, its pin and its entry in `PATCH_REASONS` all go away together — and
// this audit is what makes "all together" enforceable, since an orphaned
// reason or a dangling pin is itself a failure.

/** One `pnpm.patchedDependencies` entry, split into its parts. */
export interface PatchPin {
  /** Package name, e.g. `storybook`. */
  name: string
  /** The exact version the patch is pinned to, or `null` if the key had none. */
  version: string | null
  /** Repo-relative path of the patch file, as written in the manifest. */
  file: string
}

/** A patch pin the audit refuses to vouch for, and why. */
export type PatchProblem =
  | { kind: 'unpinned-version'; pin: PatchPin }
  | { kind: 'missing-patch-file'; pin: PatchPin }
  | { kind: 'not-a-dependency'; pin: PatchPin }
  | { kind: 'version-drift'; pin: PatchPin; installed: string }
  | { kind: 'undocumented'; pin: PatchPin }
  | { kind: 'orphaned-reason'; name: string }
  | { kind: 'unknown-parent'; pin: PatchPin; via: string }
  | { kind: 'orphaned-parent'; name: string }

/**
 * Why each patched dependency is patched.
 *
 * Keyed by package name rather than by name@version so a rebase of the same
 * patch onto a new upstream release does not silently drop the explanation.
 * A patch with no entry here fails the audit: "someone patched a dependency
 * and did not say why" is the failure mode this table exists to prevent.
 */
export const PATCH_REASONS: Readonly<Record<string, string>> = {
  storybook:
    'importModule() registers its TypeScript loader with module.register(), ' +
    'which is DEP0205 on Node 26 and therefore throws under the Build gate’s ' +
    '--throw-deprecation. The patch prefers module.registerHooks() where it ' +
    'exists, forward-porting storybookjs/storybook#35337; remove it when that ' +
    'lands upstream.',
  'http-proxy':
    'lib/http-proxy/index.js and lib/http-proxy/common.js take their `extend` ' +
    'from require("util")._extend, which is DEP0060 and therefore throws under ' +
    'the Contract gates’ --throw-deprecation — inside the request handler of ' +
    'the proxy pact-js puts in front of the provider, so every state-handling ' +
    'verification hits it. The patch uses Object.assign, which is what the ' +
    'deprecation notice itself recommends and what _extend does for these two ' +
    'call sites. http-proxy 1.18.1 is the last release (2020) and unmaintained, ' +
    'so there is nothing upstream to wait for: this goes away when pact-js ' +
    'moves off it.',
}

/**
 * Patched packages that are not direct dependencies, and what pulls them in.
 *
 * The `not-a-dependency` rule below was written when the only patch was on a
 * package this repository declares, and it assumed that would stay true. It
 * does not: `http-proxy` reaches us through `@pact-foundation/pact`, and the
 * deprecation it throws is in code we never call directly. Patching a
 * *transitive* dependency is the ordinary case for this kind of fix, and the
 * old rule would have forced a fake direct dependency into package.json to
 * satisfy it — a worse lie than the one it was preventing.
 *
 * So the entry names the direct dependency responsible instead, and the rule
 * is preserved rather than dropped: the parent must itself be declared, and an
 * entry here for a package nothing patches is a failure of its own. What the
 * original rule was for — a patch pin outliving the dependency it patches —
 * still fails, one level up.
 */
export const TRANSITIVE_PATCHES: Readonly<Record<string, string>> = {
  'http-proxy': '@pact-foundation/pact',
}

/** The manifest fields a patched package may legitimately be declared in. */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

/** The subset of package.json this audit reads. */
export interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  pnpm?: { patchedDependencies?: Record<string, string> }
}

/**
 * Split `pnpm.patchedDependencies` into {@link PatchPin}s.
 *
 * pnpm accepts both `name` and `name@version` keys; only the second is a pin,
 * so the version is kept as `null` here and rejected by the audit rather than
 * being guessed at. Scoped names carry their own `@`, so the split is on the
 * *last* one.
 */
export function parsePatchPins(manifest: Manifest): PatchPin[] {
  const entries = Object.entries(manifest.pnpm?.patchedDependencies ?? {})

  return entries.map(([key, file]) => {
    const at = key.lastIndexOf('@')
    const isScopedNameOnly = at <= 0
    return isScopedNameOnly
      ? { name: key, version: null, file }
      : { name: key.slice(0, at), version: key.slice(at + 1), file }
  })
}

/** Every package name the manifest declares a dependency on. */
function declaredDependencies(manifest: Manifest): Set<string> {
  const names = new Set<string>()
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) names.add(name)
  }
  return names
}

/**
 * Audit the manifest's patch pins.
 *
 * `installedVersionOf` returns the version actually present in the store, or
 * `null` when the package cannot be resolved; `patchFileExists` reports whether
 * a repo-relative patch path is on disk. Both are injected so the rules can be
 * tested without a fixture tree on disk.
 */
export function findPatchProblems(
  manifest: Manifest,
  installedVersionOf: (name: string) => string | null,
  patchFileExists: (file: string) => boolean,
): PatchProblem[] {
  const pins = parsePatchPins(manifest)
  const declared = declaredDependencies(manifest)
  const problems: PatchProblem[] = []

  for (const pin of pins) {
    if (!(pin.name in PATCH_REASONS)) problems.push({ kind: 'undocumented', pin })
    if (!patchFileExists(pin.file)) problems.push({ kind: 'missing-patch-file', pin })
    const via = TRANSITIVE_PATCHES[pin.name]
    if (via === undefined) {
      if (!declared.has(pin.name)) problems.push({ kind: 'not-a-dependency', pin })
    } else if (!declared.has(via)) {
      problems.push({ kind: 'unknown-parent', pin, via })
    }

    if (pin.version === null) {
      problems.push({ kind: 'unpinned-version', pin })
      continue
    }

    const installed = installedVersionOf(pin.name)
    if (installed !== null && installed !== pin.version) {
      problems.push({ kind: 'version-drift', pin, installed })
    }
  }

  const pinned = new Set(pins.map((pin) => pin.name))
  for (const name of Object.keys(PATCH_REASONS)) {
    if (!pinned.has(name)) problems.push({ kind: 'orphaned-reason', name })
  }
  for (const name of Object.keys(TRANSITIVE_PATCHES)) {
    if (!pinned.has(name)) problems.push({ kind: 'orphaned-parent', name })
  }

  return problems
}

/** Render a problem as a line an engineer can act on without reading this file. */
export function formatPatchProblem(problem: PatchProblem): string {
  if (problem.kind === 'orphaned-reason') {
    return `PATCH_REASONS still documents "${problem.name}", but nothing patches it any more — drop the entry`
  }

  if (problem.kind === 'orphaned-parent') {
    return `TRANSITIVE_PATCHES still names a parent for "${problem.name}", but nothing patches it any more — drop the entry`
  }

  const { pin } = problem
  const pinned = pin.version === null ? pin.name : `${pin.name}@${pin.version}`

  switch (problem.kind) {
    case 'unpinned-version':
      return `"${pinned}" is patched without an exact version — pin it so an upgrade fails the install instead of silently dropping the patch`
    case 'missing-patch-file':
      return `"${pinned}" points at ${pin.file}, which does not exist`
    case 'not-a-dependency':
      return `"${pinned}" is patched but is not in dependencies, devDependencies or optionalDependencies`
    case 'undocumented':
      return `"${pinned}" is patched with no entry in PATCH_REASONS — say why the patch exists and what removes it`
    case 'unknown-parent':
      return `"${pinned}" is patched as a transitive dependency of "${problem.via}", but "${problem.via}" is not in dependencies, devDependencies or optionalDependencies`
    case 'version-drift':
      return `"${pinned}" is patched, but ${problem.installed} is installed — rebase the patch onto ${problem.installed} or pin it back`
  }
}
