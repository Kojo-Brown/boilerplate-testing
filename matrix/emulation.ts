/**
 * The measurement: what a cross-browser matrix's mobile legs actually are, and
 * what a viewport resize is not.
 *
 * ---------------------------------------------------------------------------
 * Two claims, two tables
 * ---------------------------------------------------------------------------
 * {@link PROJECT_MATRIX} is the five-project config everybody writes —
 * chromium, firefox, webkit, mobile-chrome, mobile-safari — with the engine
 * and form factor of each spelled out. It looks like three engines crossed
 * with two form factors, and it is not: it is five cells, and Playwright
 * cannot supply the sixth. {@link REGISTRY} records why, from its own device
 * list, and `emulation.test.ts` checks every number against the live registry.
 *
 * {@link EMULATION} is 45 cells measured in a real Chromium by
 * `emulation.spec.ts`: thirteen probes and two interaction outcomes under
 * three conditions, where the middle condition is the one a team reaches for
 * when somebody says the app is broken on a phone — set the viewport narrow
 * and call the result a mobile test.
 *
 * ---------------------------------------------------------------------------
 * What this file is a claim about
 * ---------------------------------------------------------------------------
 * Chromium, and only Chromium, for `EMULATION`. The three conditions differ in
 * context options rather than engine on purpose: mixing an engine change into
 * the comparison would make every moved cell ambiguous, and the question here
 * is what *emulation* does. What the other two engines add is a separate
 * question, and one this repository cannot answer in `pnpm test` — see the
 * `engines` job in `.github/workflows/ci.yml` and the note in `README.md`.
 */

import { CONDITION_NAMES, type ConditionName } from './conditions.ts'
import { PROBES, PROBE_NAMES, probesOfKind, type ProbeName } from './probes.ts'

// ---------------------------------------------------------------------------
// The matrix everybody writes
// ---------------------------------------------------------------------------

export type Engine = 'chromium' | 'firefox' | 'webkit'

export type FormFactor = 'desktop' | 'mobile'

export interface MatrixProject {
  /** The project name in `playwright.config.ts`. */
  readonly name: string
  /** The `devices[...]` descriptor it spreads. */
  readonly descriptor: string
  readonly engine: Engine
  readonly formFactor: FormFactor
}

/**
 * The standard five, as they appear in this repository's own
 * `playwright.config.ts`.
 *
 * Read the `engine` column down the mobile rows. There are two of them, and
 * the missing third is not an oversight in the config — it is the whole of
 * {@link REGISTRY}.
 */
export const PROJECT_MATRIX: readonly MatrixProject[] = [
  { name: 'chromium', descriptor: 'Desktop Chrome', engine: 'chromium', formFactor: 'desktop' },
  { name: 'firefox', descriptor: 'Desktop Firefox', engine: 'firefox', formFactor: 'desktop' },
  { name: 'webkit', descriptor: 'Desktop Safari', engine: 'webkit', formFactor: 'desktop' },
  { name: 'mobile-chrome', descriptor: 'Pixel 5', engine: 'chromium', formFactor: 'mobile' },
  { name: 'mobile-safari', descriptor: 'iPhone 13', engine: 'webkit', formFactor: 'mobile' },
]

export interface RegistryCensus {
  readonly playwright: string
  readonly descriptors: number
  /** Descriptors per engine, then per form factor. */
  readonly byEngine: Readonly<Record<Engine, { readonly desktop: number; readonly mobile: number }>>
}

/**
 * Playwright's device registry, counted.
 *
 * 207 descriptors, 200 of them mobile, and **not one of the 200 is Firefox**.
 * Gecko's mobile browser is not something Playwright emulates, so the mobile
 * row of a cross-browser matrix has two engines in it no matter how the config
 * is written. A suite that believes it covers three engines on phones covers
 * two, and the gap is not visible anywhere in the config — every project in it
 * runs and passes.
 *
 * The numbers are pinned to a Playwright version because they are a fact about
 * that version, and the lockfile makes them deterministic. A dependency bump
 * that moves them turns `emulation.test.ts` red, which is the point: the
 * structural claim is the one worth re-reading when the list changes.
 */
export const REGISTRY: RegistryCensus = {
  playwright: '1.62.1',
  descriptors: 207,
  byEngine: {
    chromium: { desktop: 4, mobile: 96 },
    firefox: { desktop: 2, mobile: 0 },
    webkit: { desktop: 1, mobile: 104 },
  },
}

// ---------------------------------------------------------------------------
// What emulation does, in one engine
// ---------------------------------------------------------------------------

/** What `page.tap()` did, which is an outcome rather than a reading. */
export type TapOutcome = 'tapped' | 'rejected'

export interface Row {
  readonly probes: Readonly<Record<ProbeName, string>>
  /** Playwright refuses `tap()` on a context without `hasTouch`. */
  readonly tap: TapOutcome
  /** `PointerEvent.pointerType` seen by the page's own click handler. */
  readonly pointerType: string
}

/**
 * Forty-five cells, all of them measured in Chromium by `emulation.spec.ts`.
 *
 * The shape is the finding, and it is a clean partition rather than a count.
 * `narrow` — the phone's viewport on an otherwise untouched desktop context —
 * moves every probe `probes.ts` files as `viewport` and *not one* of the ten
 * it files as `device`. On those ten it is a desktop, which is every cell
 * about how a finger works.
 *
 * `hover-affordance` is the one to read twice. The page hides a control behind
 * `:hover`, carefully, inside `@media (hover: hover)` so that a device with no
 * hover keeps it. A real phone therefore reports `reachable`. The narrow
 * window reports `hidden` — the *opposite* answer — so a mobile test built on
 * a resize does not merely miss the archetypal mobile bug, it asserts the
 * wrong value for it and goes green doing so.
 */
export const EMULATION: Readonly<Record<ConditionName, Row>> = {
  desktop: {
    probes: {
      'viewport-width': 'wide',
      'css-breakpoint': 'wide',
      'touch-target-size': 'small',
      'pointer-coarse': 'fine',
      'any-pointer-coarse': 'fine',
      'hover-capable': 'hover',
      'hover-affordance': 'hidden',
      'max-touch-points': 'zero',
      'touch-events': 'absent',
      'device-pixel-ratio': 'one',
      'ua-mobile-token': 'desktop',
      'ua-data-mobile': 'desktop',
      'screen-width': 'desktop',
    },
    tap: 'rejected',
    pointerType: 'none',
  },
  narrow: {
    probes: {
      'viewport-width': 'narrow',
      'css-breakpoint': 'stacked',
      'touch-target-size': 'small',
      'pointer-coarse': 'fine',
      'any-pointer-coarse': 'fine',
      'hover-capable': 'hover',
      'hover-affordance': 'hidden',
      'max-touch-points': 'zero',
      'touch-events': 'absent',
      'device-pixel-ratio': 'one',
      'ua-mobile-token': 'desktop',
      'ua-data-mobile': 'desktop',
      'screen-width': 'phone',
    },
    tap: 'rejected',
    pointerType: 'none',
  },
  emulated: {
    probes: {
      'viewport-width': 'narrow',
      'css-breakpoint': 'stacked',
      'touch-target-size': 'large',
      'pointer-coarse': 'coarse',
      'any-pointer-coarse': 'coarse',
      'hover-capable': 'none',
      'hover-affordance': 'reachable',
      'max-touch-points': 'positive',
      'touch-events': 'present',
      'device-pixel-ratio': 'above-one',
      'ua-mobile-token': 'mobile',
      'ua-data-mobile': 'mobile',
      'screen-width': 'phone',
    },
    tap: 'tapped',
    pointerType: 'touch',
  },
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

/**
 * The project matrix as README markdown.
 *
 * Rendered rather than transcribed, and `readme.test.ts` compares the string:
 * there is no version of this repository where the published table disagrees
 * with `PROJECT_MATRIX`.
 */
export function renderProjectTable(): string {
  return [
    row(['project', 'descriptor', 'engine', 'form factor']),
    row(['---', '---', '---', '---']),
    ...PROJECT_MATRIX.map((project) =>
      row([
        `\`${project.name}\``,
        `\`${project.descriptor}\``,
        project.engine,
        project.formFactor,
      ]),
    ),
  ].join('\n')
}

/** The forty-five measured cells as README markdown. */
export function renderEmulationTable(): string {
  return [
    row(['probe', 'kind', ...CONDITION_NAMES]),
    row(['---', '---', ...CONDITION_NAMES.map(() => '---')]),
    ...PROBES.map((probe) =>
      row([
        `\`${probe.name}\``,
        probe.kind,
        ...CONDITION_NAMES.map((condition) => `\`${EMULATION[condition].probes[probe.name]}\``),
      ]),
    ),
    row([
      '`tap()`',
      'device',
      ...CONDITION_NAMES.map((condition) => `\`${EMULATION[condition].tap}\``),
    ]),
    row([
      '`pointerType`',
      'device',
      ...CONDITION_NAMES.map((condition) => `\`${EMULATION[condition].pointerType}\``),
    ]),
  ].join('\n')
}

/** Probe names on which two conditions disagree. */
export function movedBetween(left: ConditionName, right: ConditionName): ProbeName[] {
  return PROBE_NAMES.filter(
    (name) => EMULATION[left].probes[name] !== EMULATION[right].probes[name],
  )
}

/**
 * The README's claims, as predicates over the two tables.
 *
 * Same discipline as `grouping.ts`: a sentence that stops being true fails a
 * test rather than sitting in a paragraph nobody re-reads.
 */
export const FINDINGS: Readonly<Record<string, () => boolean>> = {
  /** The matrix has five cells, not six: nothing crosses firefox with mobile. */
  'the-matrix-is-five-cells-not-six': () =>
    PROJECT_MATRIX.filter((project) => project.formFactor === 'mobile').every(
      (project) => project.engine !== 'firefox',
    ),

  /** And the config could not be written otherwise — no such descriptor exists. */
  'no-firefox-device-descriptor-exists': () => REGISTRY.byEngine.firefox.mobile === 0,

  /** Emulation is overwhelmingly a mobile feature of the registry. */
  'almost-every-descriptor-is-a-phone': () => {
    const mobile = Object.values(REGISTRY.byEngine).reduce((count, row) => count + row.mobile, 0)

    return mobile > REGISTRY.descriptors * 0.9
  },

  /** A resize moves exactly the viewport-shaped probes — all three, and only those. */
  'a-resize-moves-exactly-the-viewport-probes': () => {
    const moved = [...movedBetween('desktop', 'narrow')].sort()
    const viewport = probesOfKind('viewport').map((probe) => probe.name).sort()

    return JSON.stringify(moved) === JSON.stringify(viewport)
  },

  /** And everything a phone otherwise is, it is not — exactly the device probes. */
  'a-resize-is-a-desktop-on-every-device-probe': () => {
    const moved = [...movedBetween('narrow', 'emulated')].sort()
    const device = probesOfKind('device').map((probe) => probe.name).sort()

    return JSON.stringify(moved) === JSON.stringify(device)
  },

  /** Including the one that matters most: it reports the opposite value. */
  'a-resize-inverts-the-hover-affordance': () =>
    EMULATION.narrow.probes['hover-affordance'] === EMULATION.desktop.probes['hover-affordance'] &&
    EMULATION.emulated.probes['hover-affordance'] !==
      EMULATION.narrow.probes['hover-affordance'],

  /** A resize cannot even express a tap: Playwright refuses it without `hasTouch`. */
  'a-resize-cannot-tap': () =>
    EMULATION.narrow.tap === 'rejected' && EMULATION.emulated.tap === 'tapped',

  /** And when it can, the page sees a touch rather than a mouse. */
  'emulation-changes-the-pointer-type': () =>
    EMULATION.emulated.pointerType === 'touch' && EMULATION.desktop.pointerType !== 'touch',

}
