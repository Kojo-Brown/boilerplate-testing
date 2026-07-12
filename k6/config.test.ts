import { describe, it, expect } from 'vitest'
import {
  durationToSeconds,
  smokeProfile,
  loadProfile,
  stressProfile,
  soakProfile,
  resolveProfile,
  profiles,
  type LoadProfile,
} from './config'

// ---------------------------------------------------------------------------
// durationToSeconds
// ---------------------------------------------------------------------------

describe('durationToSeconds', () => {
  it('converts milliseconds', () => {
    expect(durationToSeconds('500ms')).toBe(0.5)
  })

  it('converts seconds', () => {
    expect(durationToSeconds('30s')).toBe(30)
  })

  it('converts minutes', () => {
    expect(durationToSeconds('5m')).toBe(300)
  })

  it('converts hours', () => {
    expect(durationToSeconds('1h')).toBe(3600)
    expect(durationToSeconds('4h')).toBe(14400)
  })

  it('throws on unknown unit', () => {
    expect(() => durationToSeconds('5x')).toThrow('Invalid duration format')
  })

  it('throws on missing unit', () => {
    expect(() => durationToSeconds('60')).toThrow('Invalid duration format')
  })

  it('throws on empty string', () => {
    expect(() => durationToSeconds('')).toThrow('Invalid duration format')
  })
})

// ---------------------------------------------------------------------------
// Shared profile validator
// ---------------------------------------------------------------------------

function assertValidProfile(profile: LoadProfile, label: string): void {
  it(`${label}: has at least 3 stages (ramp-up, steady, ramp-down)`, () => {
    expect(profile.stages.length).toBeGreaterThanOrEqual(3)
  })

  it(`${label}: first stage ramps up (target > 0)`, () => {
    expect(profile.stages[0]!.target).toBeGreaterThan(0)
  })

  it(`${label}: last stage ramps down to 0`, () => {
    expect(profile.stages.at(-1)!.target).toBe(0)
  })

  it(`${label}: all stage durations are valid`, () => {
    for (const stage of profile.stages) {
      expect(() => durationToSeconds(stage.duration)).not.toThrow()
    }
  })

  it(`${label}: all stage targets are non-negative integers`, () => {
    for (const stage of profile.stages) {
      expect(stage.target).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(stage.target)).toBe(true)
    }
  })

  it(`${label}: includes http_req_duration threshold`, () => {
    expect(profile.thresholds).toHaveProperty('http_req_duration')
    expect(profile.thresholds['http_req_duration']!.length).toBeGreaterThan(0)
  })

  it(`${label}: includes http_req_failed threshold`, () => {
    expect(profile.thresholds).toHaveProperty('http_req_failed')
    expect(profile.thresholds['http_req_failed']!.length).toBeGreaterThan(0)
  })

  it(`${label}: all threshold rules are non-empty strings`, () => {
    for (const rules of Object.values(profile.thresholds)) {
      for (const rule of rules) {
        expect(typeof rule).toBe('string')
        expect(rule.length).toBeGreaterThan(0)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// smokeProfile
// ---------------------------------------------------------------------------

describe('smokeProfile', () => {
  assertValidProfile(smokeProfile, 'smokeProfile')

  it('uses ≤5 VUs (minimal traffic)', () => {
    const maxVUs = Math.max(...smokeProfile.stages.map((s) => s.target))
    expect(maxVUs).toBeLessThanOrEqual(5)
  })

  it('completes in under 5 minutes total', () => {
    const totalSeconds = smokeProfile.stages.reduce(
      (acc, s) => acc + durationToSeconds(s.duration),
      0,
    )
    expect(totalSeconds).toBeLessThan(300)
  })
})

// ---------------------------------------------------------------------------
// loadProfile
// ---------------------------------------------------------------------------

describe('loadProfile', () => {
  assertValidProfile(loadProfile, 'loadProfile')

  it('has a meaningful steady-state peak (≥10 VUs)', () => {
    const maxVUs = Math.max(...loadProfile.stages.map((s) => s.target))
    expect(maxVUs).toBeGreaterThanOrEqual(10)
  })

  it('includes http_req_waiting threshold', () => {
    expect(loadProfile.thresholds).toHaveProperty('http_req_waiting')
  })
})

// ---------------------------------------------------------------------------
// stressProfile
// ---------------------------------------------------------------------------

describe('stressProfile', () => {
  assertValidProfile(stressProfile, 'stressProfile')

  it('peaks higher than loadProfile', () => {
    const stressPeak = Math.max(...stressProfile.stages.map((s) => s.target))
    const loadPeak = Math.max(...loadProfile.stages.map((s) => s.target))
    expect(stressPeak).toBeGreaterThan(loadPeak)
  })

  it('stages escalate VU count before ramp-down', () => {
    const nonZeroTargets = stressProfile.stages
      .slice(0, -1)
      .map((s) => s.target)
      .filter((t) => t > 0)

    const hasEscalation = nonZeroTargets.some(
      (t, i) => i > 0 && t >= (nonZeroTargets[i - 1] ?? 0),
    )
    expect(hasEscalation).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// soakProfile
// ---------------------------------------------------------------------------

describe('soakProfile', () => {
  assertValidProfile(soakProfile, 'soakProfile')

  it('steady phase lasts at least 1 hour', () => {
    const steadySeconds = soakProfile.stages
      .slice(1, -1)
      .reduce((acc, s) => acc + durationToSeconds(s.duration), 0)
    expect(steadySeconds).toBeGreaterThanOrEqual(3600)
  })
})

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe('resolveProfile', () => {
  it('returns loadProfile when name is undefined', () => {
    expect(resolveProfile(undefined)).toBe(loadProfile)
  })

  it('returns loadProfile when name is empty string', () => {
    expect(resolveProfile('')).toBe(loadProfile)
  })

  it('resolves each named profile by key', () => {
    for (const [name, profile] of Object.entries(profiles)) {
      expect(resolveProfile(name)).toBe(profile)
    }
  })

  it('resolves "smoke" to smokeProfile', () => {
    expect(resolveProfile('smoke')).toBe(smokeProfile)
  })

  it('resolves "stress" to stressProfile', () => {
    expect(resolveProfile('stress')).toBe(stressProfile)
  })

  it('resolves "soak" to soakProfile', () => {
    expect(resolveProfile('soak')).toBe(soakProfile)
  })

  it('throws a descriptive error for unknown names', () => {
    expect(() => resolveProfile('spike')).toThrow(
      'Unknown load profile: "spike"',
    )
    expect(() => resolveProfile('spike')).toThrow(
      /Valid values: smoke, load, stress, soak/,
    )
  })
})
