/**
 * The questions asked of the page, one per thing a device is.
 *
 * Each probe is a pure function evaluated inside the browser and returning a
 * short word, so the result table is readable and a cell that moves is a
 * sentence rather than a diff of objects. They are ordered roughly from what a
 * viewport resize can reach to what it cannot, because that ordering is the
 * finding.
 *
 * `navigator.userAgentData` is the one probe whose absence is an answer: it is
 * Chromium-only, and a run on another engine should record `unsupported`
 * rather than throw.
 */

/** Probe names, in table order. */
export const PROBE_NAMES = [
  'viewport-width',
  'css-breakpoint',
  'touch-target-size',
  'pointer-coarse',
  'any-pointer-coarse',
  'hover-capable',
  'hover-affordance',
  'max-touch-points',
  'touch-events',
  'device-pixel-ratio',
  'ua-mobile-token',
  'ua-data-mobile',
  'screen-width',
] as const

export type ProbeName = (typeof PROBE_NAMES)[number]

/**
 * What a probe's answer is decided by.
 *
 * The split is the measurement's hypothesis, written down before the run: a
 * `viewport` probe should move when the window is resized, and a `device`
 * probe should not. `emulation.ts` checks that the measured table partitions
 * exactly this way, so a probe filed under the wrong kind fails a test rather
 * than quietly flattering the finding.
 */
export type ProbeKind = 'viewport' | 'device'

/** A probe is evaluated in the page and answers in one word. */
export interface Probe {
  readonly name: ProbeName
  readonly kind: ProbeKind
  /** What the probe is for, in the terms a reader of the table needs. */
  readonly asks: string
  readonly run: () => string
}

export const PROBES: readonly Probe[] = [
  {
    name: 'viewport-width',
    kind: 'viewport',
    asks: 'how wide the layout viewport is',
    run: () => (window.innerWidth >= 768 ? 'wide' : 'narrow'),
  },
  {
    name: 'css-breakpoint',
    kind: 'viewport',
    asks: 'which `max-width` branch the stylesheet took',
    run: () => {
      const layout = document.getElementById('layout')

      return layout ? getComputedStyle(layout, '::after').content.replaceAll('"', '') : 'missing'
    },
  },
  {
    name: 'touch-target-size',
    kind: 'device',
    asks: 'whether the `(pointer: coarse)` branch enlarged the tap target',
    run: () => {
      const target = document.getElementById('target')

      return target ? (getComputedStyle(target).height === '48px' ? 'large' : 'small') : 'missing'
    },
  },
  {
    name: 'pointer-coarse',
    kind: 'device',
    asks: 'what the primary pointing device is',
    run: () => (matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'),
  },
  {
    name: 'any-pointer-coarse',
    kind: 'device',
    asks: 'whether *any* attached pointer is coarse',
    run: () => (matchMedia('(any-pointer: coarse)').matches ? 'coarse' : 'fine'),
  },
  {
    name: 'hover-capable',
    kind: 'device',
    asks: 'whether the primary pointer can hover',
    run: () => (matchMedia('(hover: hover)').matches ? 'hover' : 'none'),
  },
  {
    name: 'hover-affordance',
    kind: 'device',
    asks: 'whether a hover-revealed control is visible without hovering',
    run: () => {
      const reveal = document.getElementById('reveal')

      return reveal
        ? getComputedStyle(reveal).opacity === '1'
          ? 'reachable'
          : 'hidden'
        : 'missing'
    },
  },
  {
    name: 'max-touch-points',
    kind: 'device',
    asks: 'how many simultaneous touches the platform claims',
    run: () => (navigator.maxTouchPoints > 0 ? 'positive' : 'zero'),
  },
  {
    name: 'touch-events',
    kind: 'device',
    asks: 'whether the touch event API is exposed at all',
    run: () => ('ontouchstart' in window ? 'present' : 'absent'),
  },
  {
    name: 'device-pixel-ratio',
    kind: 'device',
    asks: 'what `devicePixelRatio` a responsive image would pick from',
    run: () => (window.devicePixelRatio > 1 ? 'above-one' : 'one'),
  },
  {
    name: 'ua-mobile-token',
    kind: 'device',
    asks: 'whether the UA string carries a `Mobile` token',
    run: () => (/\bMobile\b/.test(navigator.userAgent) ? 'mobile' : 'desktop'),
  },
  {
    name: 'ua-data-mobile',
    kind: 'device',
    asks: 'what client hints say, where they exist',
    run: () => {
      const data = (navigator as Navigator & { userAgentData?: { mobile: boolean } }).userAgentData

      return data === undefined ? 'unsupported' : data.mobile ? 'mobile' : 'desktop'
    },
  },
  {
    name: 'screen-width',
    kind: 'viewport',
    // Filed under `viewport` because that is what it measured, which was not
    // the expectation. A device descriptor carries a `screen` distinct from
    // its viewport — `Desktop Chrome` is 1280x720 in a 1920x1080 screen, and
    // `Pixel 5` is 393x727 in a 393x851 one — and none of it reaches the page
    // through a project's `use`: `window.screen` mirrored the viewport under
    // all three conditions. So a suite that reads `screen` to decide it is on
    // a phone is reading the window a second time.
    asks: 'what the *screen* reports, as opposed to the window',
    run: () => (window.screen.width >= 768 ? 'desktop' : 'phone'),
  },
]

/** The probes of one kind, in table order. */
export function probesOfKind(kind: ProbeKind): Probe[] {
  return PROBES.filter((probe) => probe.kind === kind)
}
