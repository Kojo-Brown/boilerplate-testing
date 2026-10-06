/**
 * k6 load profile presets and helpers.
 *
 * These are plain TypeScript types — no k6 imports — so they can be used
 * both from k6 scripts (via tsconfig.k6.json) and from Vitest unit tests.
 *
 * ---------------------------------------------------------------------------
 * Five scenarios, one axis each
 * ---------------------------------------------------------------------------
 * The five profiles are not five sizes of the same test. Each one isolates a
 * different question, and the stage shape is how the question is asked:
 *
 *   smoke    Does the system work at all? One VU, two minutes, strict
 *            thresholds. Answers a yes/no before anything expensive runs.
 *   load     Does it meet its targets at the traffic it is built for?
 *            Steady state is where the numbers are read from.
 *   stress   Where does it break, and how? Escalates past capacity on
 *            purpose, so thresholds are loose — a stress run that stays
 *            inside the load thresholds did not stress anything.
 *   soak     Does it still work after four hours? Moderate load held long
 *            enough for leaks, pool exhaustion and drift to show up.
 *   spike    Does it come back? The burst is not the measurement; the
 *            recovery window after the burst is.
 *
 * `spike` is the one whose pass/fail criterion cannot be written as a single
 * number over the whole run. A system that sheds load during a 20x burst and
 * recovers in thirty seconds passed; one that stays up during the burst and
 * is still degraded three minutes later failed. Averaged over the run those
 * two look alike. So the burst thresholds are deliberately tolerant and the
 * verdict is carried by sub-metric thresholds scoped to the recovery phase —
 * which is what {@link Stage.phase} and {@link phaseAt} exist for.
 */

export type Phase =
  | 'baseline'
  | 'ramp-up'
  | 'steady'
  | 'burst'
  | 'hold'
  | 'drop'
  | 'recovery'
  | 'ramp-down'

export interface Stage {
  readonly duration: string
  readonly target: number
  /**
   * What this stage is for.
   *
   * The scenario tags every request made during the stage with it, so a
   * threshold can be scoped to one phase of the run — `http_req_duration{phase:recovery}`
   * rather than `http_req_duration`. These used to be line comments; they are
   * data because a threshold reads them.
   */
  readonly phase: Phase
}

export interface LoadProfile {
  readonly stages: readonly Stage[]
  readonly thresholds: Readonly<Record<string, readonly string[]>>
}

export type ProfileName = 'smoke' | 'load' | 'stress' | 'soak' | 'spike'

const DURATION_PATTERN = /^(\d+)(ms|s|m|h)$/

/** Converts a k6 duration string (e.g. '30s', '5m', '1h') to seconds. */
export function durationToSeconds(duration: string): number {
  const match = DURATION_PATTERN.exec(duration)
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid duration format: "${duration}". Expected e.g. "30s", "5m", "1h".`)
  }
  const value = parseInt(match[1], 10)
  switch (match[2]) {
    case 'ms': return value / 1000
    case 's': return value
    case 'm': return value * 60
    case 'h': return value * 3600
    default: throw new Error(`Unknown duration unit: "${match[2]}"`)
  }
}

/** Minimal single-VU smoke test to catch obvious regressions before a full run. */
export const smokeProfile: LoadProfile = {
  stages: [
    { duration: '30s', target: 1, phase: 'ramp-up' },
    { duration: '1m',  target: 1, phase: 'steady' },
    { duration: '30s', target: 0, phase: 'ramp-down' },
  ],
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

/** Standard load test verifying system behaviour under expected production traffic. */
export const loadProfile: LoadProfile = {
  stages: [
    { duration: '5m',  target: 50, phase: 'ramp-up' },
    { duration: '10m', target: 50, phase: 'steady' },
    { duration: '5m',  target: 0,  phase: 'ramp-down' },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    http_req_waiting: ['p(95)<400'],
  },
}

/**
 * Stress test that pushes the system past expected capacity to find the
 * breaking point and observe how it degrades.
 */
export const stressProfile: LoadProfile = {
  stages: [
    { duration: '5m',  target: 50,  phase: 'ramp-up' },   // to normal
    { duration: '5m',  target: 100, phase: 'ramp-up' },   // exceed normal
    { duration: '5m',  target: 200, phase: 'ramp-up' },   // approach the limit
    { duration: '5m',  target: 200, phase: 'hold' },
    { duration: '10m', target: 0,   phase: 'ramp-down' },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],
  },
}

/**
 * Soak test — sustained moderate load over hours to surface memory leaks,
 * connection pool exhaustion, and gradual performance degradation.
 */
export const soakProfile: LoadProfile = {
  stages: [
    { duration: '5m', target: 20, phase: 'ramp-up' },
    { duration: '4h', target: 20, phase: 'steady' },
    { duration: '5m', target: 0,  phase: 'ramp-down' },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
}

/**
 * Spike test — a sudden 20x burst, then back to baseline, then a long enough
 * window to watch the system return to it.
 *
 * The baseline phase comes first on purpose: "recovered" is a comparison, and
 * a run that starts at the spike has nothing to compare against. The burst
 * thresholds tolerate shedding (10% errors, p(95) under two seconds) because a
 * system is allowed to degrade under 20x; the `{phase:recovery}` thresholds do
 * not, because coming back is the behaviour under test.
 */
export const spikeProfile: LoadProfile = {
  stages: [
    { duration: '1m',  target: 20,  phase: 'baseline' },
    { duration: '10s', target: 400, phase: 'burst' },
    { duration: '1m',  target: 400, phase: 'hold' },
    { duration: '10s', target: 20,  phase: 'drop' },
    { duration: '3m',  target: 20,  phase: 'recovery' },
    { duration: '30s', target: 0,   phase: 'ramp-down' },
  ],
  thresholds: {
    // Whole-run: survival, not speed.
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.10'],
    // Recovery window: back to baseline expectations, or the run failed.
    'http_req_duration{phase:recovery}': ['p(95)<500'],
    'http_req_failed{phase:recovery}': ['rate<0.01'],
    // The witness, and the reason `phaseAt` is tested rather than trusted.
    //
    // k6 creates a sub-metric for a selector that matches nothing and scores it
    // against no samples: p(95) of an empty Trend is 0 and the rate of an empty
    // Rate is 0, so both recovery thresholds above *pass* when the `phase` tag
    // is never set. Measured on k6 v1.3.0 — `http_req_duration{phase:typo}`
    // exports `{"p(95)": 0, "thresholds": {"p(95)<500": false}}`. A misspelt
    // selector therefore turns the recovery gate off and reports green, which
    // is the one failure direction a gate must not have. `count>0` cannot pass
    // on an empty sub-metric, so it fails loudly in exactly that case.
    'http_reqs{phase:recovery}': ['count>0'],
  },
}

export const profiles = {
  smoke: smokeProfile,
  load: loadProfile,
  stress: stressProfile,
  soak: soakProfile,
  spike: spikeProfile,
} satisfies Record<ProfileName, LoadProfile>

/**
 * Resolves a profile by name. Falls back to `loadProfile` when the name is
 * undefined (e.g. `__ENV['K6_PROFILE']` not set).
 *
 * @throws if the name is defined but not one of the known profile keys.
 */
export function resolveProfile(name?: string): LoadProfile {
  if (name === undefined || name === '') return loadProfile

  const profile = profiles[name as ProfileName]
  if (!profile) {
    throw new Error(
      `Unknown load profile: "${name}". Valid values: ${Object.keys(profiles).join(', ')}`,
    )
  }
  return profile
}

/** Total wall-clock seconds a profile takes to run. */
export function profileDuration(profile: LoadProfile): number {
  return profile.stages.reduce((acc, stage) => acc + durationToSeconds(stage.duration), 0)
}

/** The highest VU target a profile reaches. */
export function peakVUs(profile: LoadProfile): number {
  return Math.max(...profile.stages.map((stage) => stage.target))
}

/**
 * The steepest VU change per second across a profile's stages.
 *
 * This is the number that separates `spike` from `stress`: both end up above
 * the load profile's peak, but stress walks there over twenty minutes and
 * spike arrives in ten seconds. "Sudden" is otherwise a word in a comment.
 */
export function steepestRamp(profile: LoadProfile): number {
  let steepest = 0
  let from = 0

  for (const stage of profile.stages) {
    const rate = Math.abs(stage.target - from) / durationToSeconds(stage.duration)
    steepest = Math.max(steepest, rate)
    from = stage.target
  }

  return steepest
}

/**
 * The stages in the shape k6's `options.stages` accepts.
 *
 * `phase` is this repository's field, not k6's. k6 rejects unknown keys in
 * `options`, so it is dropped here rather than cast away — the cast would
 * typecheck and fail at startup.
 */
export function toK6Stages(profile: LoadProfile): Array<{ duration: string; target: number }> {
  return profile.stages.map((stage) => ({ duration: stage.duration, target: stage.target }))
}

/**
 * Which phase a profile is in, `elapsed` seconds into the run.
 *
 * Stage boundaries are half-open: a stage owns its start instant and not its
 * end, so the phase at exactly 60s into a 60s first stage is the second
 * stage's. Past the end of the run the last stage's phase holds — a VU that is
 * still finishing an iteration during teardown is in `ramp-down`, not nowhere.
 */
export function phaseAt(elapsed: number, profile: LoadProfile): Phase {
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new Error(`Elapsed seconds must be a non-negative finite number, got ${elapsed}`)
  }

  let boundary = 0

  for (const stage of profile.stages) {
    boundary += durationToSeconds(stage.duration)
    if (elapsed < boundary) return stage.phase
  }

  const last = profile.stages.at(-1)
  if (!last) throw new Error('Profile has no stages')
  return last.phase
}
