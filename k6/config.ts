/**
 * k6 load profile presets and helpers.
 *
 * These are plain TypeScript types — no k6 imports — so they can be used
 * both from k6 scripts (via tsconfig.k6.json) and from Vitest unit tests.
 */

export interface Stage {
  readonly duration: string
  readonly target: number
}

export interface LoadProfile {
  readonly stages: readonly Stage[]
  readonly thresholds: Readonly<Record<string, readonly string[]>>
}

export type ProfileName = 'smoke' | 'load' | 'stress' | 'soak'

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
    { duration: '30s', target: 1 }, // ramp-up
    { duration: '1m',  target: 1 }, // steady
    { duration: '30s', target: 0 }, // ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

/** Standard load test verifying system behaviour under expected production traffic. */
export const loadProfile: LoadProfile = {
  stages: [
    { duration: '5m',  target: 50 }, // ramp-up
    { duration: '10m', target: 50 }, // steady
    { duration: '5m',  target: 0  }, // ramp-down
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
    { duration: '5m',  target: 50  }, // ramp-up to normal
    { duration: '5m',  target: 100 }, // exceed normal
    { duration: '5m',  target: 200 }, // approach limit
    { duration: '5m',  target: 200 }, // hold at limit
    { duration: '10m', target: 0   }, // ramp-down
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
    { duration: '5m', target: 20 }, // ramp-up
    { duration: '4h', target: 20 }, // long steady
    { duration: '5m', target: 0  }, // ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
}

export const profiles = {
  smoke: smokeProfile,
  load: loadProfile,
  stress: stressProfile,
  soak: soakProfile,
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
