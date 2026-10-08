/**
 * The page the budget measurements are taken against, as pure data.
 *
 * Separated from the socket (`server.ts`) so the routing and the asset sizes
 * are unit-testable without a port, which is the same split `k6/server.ts` and
 * `intercept/origin.ts` make and for the same reason: the shape census then
 * counts one integration test in this directory rather than the whole of it.
 *
 * Two pages, because a gate needs both answers:
 *
 *   - `/heavy` breaches every line in `budgets.json`, by an order of magnitude
 *     where it can. This is what the three wirings are compared on — a wiring
 *     that reports green here is reporting green on a page that is 400 KiB of
 *     comment.
 *   - `/lean` is inside every line. It is what proves a failing gate is failing
 *     for the reason claimed rather than because the fixture is unservable:
 *     the published config must go green on it.
 *
 * The payloads are generated rather than committed. A 300 KiB file of `x`
 * checked into a repository whose subject is testing is 300 KiB nobody will
 * ever read, and it would drift from the budgets the moment one of them
 * changed. {@link assetSizes} derives the sizes from the budgets instead, so
 * the fixture stays over and under its limits by construction.
 */

import { assertedCeiling, budgetLines, KIB, type Budget, type ResourceType } from './budgets.ts'

/** Routes the fixture serves. */
export const HEAVY_PATH = '/heavy'
export const LEAN_PATH = '/lean'

/** The default port. `LH_ORIGIN_PORT` overrides it. */
export const ORIGIN_PORT = 8802

/**
 * How far over its budget the heavy page goes, as a multiplier.
 *
 * Large on purpose. A fixture that is 5% over a budget measures the budget and
 * the run-to-run noise together; one that is 4x over cannot be confused for
 * either, so a wiring that passes it is unambiguously not enforcing anything.
 */
export const OVERSHOOT = 4

/** How far under its budget the lean page stays, as a multiplier. */
export const UNDERSHOOT = 0.05

/** The size budget for one resource type, in bytes, or null when unbudgeted. */
export function sizeCeiling(budgets: readonly Budget[], type: ResourceType): number | null {
  const line = budgetLines(budgets).find(
    (entry) => entry.kind === 'size' && entry.resourceType === type,
  )
  return line === undefined ? null : assertedCeiling(line)
}

export interface AssetSizes {
  readonly scriptBytes: number
  readonly stylesheetBytes: number
}

/**
 * Pick payload sizes from the budgets.
 *
 * The heavy page overshoots the *script* and *stylesheet* budgets directly, and
 * overshoots `total` as a consequence rather than by aiming at it — a fixture
 * that targeted `total` separately could satisfy it while leaving the
 * per-type rows ambiguous.
 */
export function assetSizes(budgets: readonly Budget[], factor: number): AssetSizes {
  const script = sizeCeiling(budgets, 'script') ?? 300 * KIB
  const stylesheet = sizeCeiling(budgets, 'stylesheet') ?? 100 * KIB

  return {
    scriptBytes: Math.round(script * factor),
    stylesheetBytes: Math.round(stylesheet * factor),
  }
}

/**
 * Filler of an exact byte length, as a JavaScript block comment.
 *
 * A comment rather than real code because the measurement is transfer size:
 * Lighthouse's resource summary counts bytes over the wire, and the fixture
 * must not also be a 300 KiB script the main thread has to parse — that would
 * make the timing rows a measurement of this function.
 *
 * The content is `x` rather than random: the server sends no
 * `content-encoding`, so compressibility does not enter into the measurement,
 * and a deterministic body keeps two runs of the gate comparable.
 */
export function filler(bytes: number): string {
  const wrapper = '/**/'
  const inner = Math.max(0, bytes - wrapper.length)
  return `/*${'x'.repeat(inner)}*/`
}

/** Stylesheet filler of an exact byte length, as a CSS comment plus one rule. */
export function cssFiller(bytes: number): string {
  const rule = 'body{color:#222;background:#fff;font:16px/1.5 system-ui}'
  const wrapper = `${rule}/**/`
  const inner = Math.max(0, bytes - wrapper.length)
  return `${rule}/*${'x'.repeat(inner)}*/`
}

/**
 * The fixture document.
 *
 * Deliberately accessible and well-formed — `lang`, a title, a meta
 * description, a single `h1`, labelled controls and contrasting colours. The
 * budgets are the subject here; a page that also failed `color-contrast` would
 * make every red run ambiguous between "over budget" and "bad markup", and the
 * published config asserts both.
 */
export function document(options: { readonly heavy: boolean }): string {
  const assets = options.heavy
    ? '<link rel="stylesheet" href="/heavy.css">\n<script defer src="/heavy.js"></script>'
    : '<link rel="stylesheet" href="/lean.css">\n<script defer src="/lean.js"></script>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Budget fixture — ${options.heavy ? 'heavy' : 'lean'}</title>
<meta name="description" content="A fixture page for measuring how Lighthouse CI budget wirings behave.">
${assets}
</head>
<body>
<main>
<h1>Budget fixture</h1>
<p>This page exists to be measured. It is served by lighthouse/server.ts.</p>
<form action="/search" method="get">
<label for="q">Search</label>
<input id="q" name="q" type="search">
<button type="submit">Go</button>
</form>
</main>
</body>
</html>
`
}

export interface Reply {
  readonly status: number
  readonly contentType: string
  readonly body: string
}

/** The routing table, as a pure function of path. */
export function route(path: string, budgets: readonly Budget[]): Reply {
  const heavy = assetSizes(budgets, OVERSHOOT)
  const lean = assetSizes(budgets, UNDERSHOOT)

  switch (path) {
    case HEAVY_PATH:
    case '/':
      return html(document({ heavy: true }))
    case LEAN_PATH:
      return html(document({ heavy: false }))
    case '/heavy.js':
      return { status: 200, contentType: 'text/javascript', body: filler(heavy.scriptBytes) }
    case '/lean.js':
      return { status: 200, contentType: 'text/javascript', body: filler(lean.scriptBytes) }
    case '/heavy.css':
      return { status: 200, contentType: 'text/css', body: cssFiller(heavy.stylesheetBytes) }
    case '/lean.css':
      return { status: 200, contentType: 'text/css', body: cssFiller(lean.stylesheetBytes) }
    default:
      return { status: 404, contentType: 'text/plain', body: 'not found' }
  }
}

function html(body: string): Reply {
  return { status: 200, contentType: 'text/html; charset=utf-8', body }
}
