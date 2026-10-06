import { describe, it, expect } from 'vitest'
import {
  durationToSeconds,
  smokeProfile,
  loadProfile,
  stressProfile,
  soakProfile,
  spikeProfile,
  resolveProfile,
  profiles,
  peakVUs,
  phaseAt,
  profileDuration,
  steepestRamp,
  toK6Stages,
  type LoadProfile,
  type Phase,
} from './config.ts'
import { parseMetricKey, parseThreshold, passesVacuously } from './thresholds.ts'

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

  it('resolves "spike" to spikeProfile', () => {
    expect(resolveProfile('spike')).toBe(spikeProfile)
  })

  it('throws a descriptive error for unknown names', () => {
    // This case used to use 'spike', which was then an unknown name. It is a
    // profile now, so the example had to move rather than the assertion.
    expect(() => resolveProfile('burst')).toThrow('Unknown load profile: "burst"')
    expect(() => resolveProfile('burst')).toThrow(
      /Valid values: smoke, load, stress, soak, spike/,
    )
  })
})

// ---------------------------------------------------------------------------
// spikeProfile
// ---------------------------------------------------------------------------

describe('spikeProfile', () => {
  assertValidProfile(spikeProfile, 'spikeProfile')

  it('arrives far faster than the stress profile, which is what makes it a spike', () => {
    // Both end up above the load profile's peak. The difference is the slope:
    // stress walks to 200 VUs over twenty minutes, spike reaches 400 in ten
    // seconds. Without this the two profiles are the same test twice.
    expect(steepestRamp(spikeProfile)).toBeGreaterThan(steepestRamp(stressProfile) * 50)
  })

  it('peaks above the stress profile', () => {
    expect(peakVUs(spikeProfile)).toBeGreaterThan(peakVUs(stressProfile))
  })

  it('measures a baseline before the burst, so "recovered" has a reference', () => {
    expect(spikeProfile.stages[0]!.phase).toBe('baseline')
    expect(spikeProfile.stages[0]!.target).toBeGreaterThan(0)
  })

  it('spends longer recovering than bursting', () => {
    const phaseSeconds = (phase: Phase): number =>
      spikeProfile.stages
        .filter((stage) => stage.phase === phase)
        .reduce((acc, stage) => acc + durationToSeconds(stage.duration), 0)

    expect(phaseSeconds('recovery')).toBeGreaterThan(phaseSeconds('burst') + phaseSeconds('hold'))
  })

  it('returns to the baseline VU count before the recovery window', () => {
    const baseline = spikeProfile.stages.find((stage) => stage.phase === 'baseline')!
    const recovery = spikeProfile.stages.find((stage) => stage.phase === 'recovery')!

    expect(recovery.target).toBe(baseline.target)
  })

  it('tolerates more during the burst than it does during recovery', () => {
    const whole = parseThreshold(spikeProfile.thresholds['http_req_duration']![0]!)
    const recovery = parseThreshold(
      spikeProfile.thresholds['http_req_duration{phase:recovery}']![0]!,
    )

    expect(recovery.operand).toBeLessThan(whole.operand)
  })
})

// ---------------------------------------------------------------------------
// Sub-metric thresholds must have teeth
// ---------------------------------------------------------------------------

describe('every sub-metric threshold group carries a witness', () => {
  // The failure this prevents, measured on k6 v1.3.0: a threshold whose tag
  // selector matches no samples is scored against an empty metric, and an
  // empty Trend's p(95) is 0. So `http_req_duration{phase:recovery}: p(95)<500`
  // *passes* when the scenario never sets the phase tag — the gate reports
  // green while enforcing nothing, which is the one direction a gate must not
  // fail in. A threshold that cannot pass on no samples, such as `count>0`,
  // turns that silence into a breach.
  for (const [name, profile] of Object.entries(profiles)) {
    const selectors = new Map<string, string[]>()

    for (const [key, expressions] of Object.entries(profile.thresholds)) {
      const { selector } = parseMetricKey(key)
      if (selector === undefined) continue
      selectors.set(selector, [...(selectors.get(selector) ?? []), ...expressions])
    }

    if (selectors.size === 0) {
      it(`${name}: declares no sub-metric thresholds`, () => {
        expect(selectors.size).toBe(0)
      })
      continue
    }

    for (const [selector, expressions] of selectors) {
      it(`${name}: {${selector}} has a threshold that fails on no samples`, () => {
        const witnesses = expressions.filter(
          (expression) => !passesVacuously(parseThreshold(expression)),
        )

        expect(
          witnesses,
          `All of [${expressions.join(', ')}] pass against an empty sub-metric, so a ` +
            `selector of {${selector}} that matches nothing would report green. Add a ` +
            'threshold such as `count>0` on a metric with the same selector.',
        ).not.toHaveLength(0)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Stage phases
// ---------------------------------------------------------------------------

describe('phases', () => {
  it('every stage of every profile declares a phase', () => {
    for (const [name, profile] of Object.entries(profiles)) {
      for (const [index, stage] of profile.stages.entries()) {
        expect(stage.phase, `${name} stage ${index}`).toBeTruthy()
      }
    }
  })

  it('every profile ends in a ramp-down', () => {
    for (const [name, profile] of Object.entries(profiles)) {
      expect(profile.stages.at(-1)!.phase, name).toBe('ramp-down')
    }
  })

  it('every phase a threshold selects on is a phase some stage actually uses', () => {
    // The other half of the witness rule, caught a step earlier: a selector
    // naming a phase no stage has can never collect a sample, so it is a typo
    // whatever the witness does about it at run time.
    for (const [name, profile] of Object.entries(profiles)) {
      const declared = new Set(profile.stages.map((stage) => stage.phase))

      for (const key of Object.keys(profile.thresholds)) {
        const { selector } = parseMetricKey(key)
        if (selector === undefined) continue

        const [tag, value] = selector.split(':')
        if (tag !== 'phase') continue

        expect(declared, `${name}: ${key}`).toContain(value)
      }
    }
  })
})

describe('phaseAt', () => {
  it('returns the first stage phase at the start of the run', () => {
    expect(phaseAt(0, spikeProfile)).toBe('baseline')
  })

  it('treats a stage boundary as belonging to the next stage', () => {
    // The baseline stage is 1m. At exactly 60s the burst has started.
    expect(phaseAt(59.999, spikeProfile)).toBe('baseline')
    expect(phaseAt(60, spikeProfile)).toBe('burst')
  })

  it('walks the whole spike profile in order', () => {
    expect(phaseAt(30, spikeProfile)).toBe('baseline')
    expect(phaseAt(65, spikeProfile)).toBe('burst')
    expect(phaseAt(90, spikeProfile)).toBe('hold')
    expect(phaseAt(135, spikeProfile)).toBe('drop')
    expect(phaseAt(200, spikeProfile)).toBe('recovery')
    expect(phaseAt(320, spikeProfile)).toBe('ramp-down')
  })

  it('holds the last phase past the end of the run', () => {
    // A VU still finishing an iteration during teardown is in ramp-down, not
    // in no phase at all — an untagged request would silently leave the
    // sub-metrics.
    expect(phaseAt(profileDuration(spikeProfile), spikeProfile)).toBe('ramp-down')
    expect(phaseAt(profileDuration(spikeProfile) + 600, spikeProfile)).toBe('ramp-down')
  })

  it('covers every phase of every profile across its own duration', () => {
    for (const [name, profile] of Object.entries(profiles)) {
      const seen = new Set<Phase>()
      const total = profileDuration(profile)

      for (let elapsed = 0; elapsed < total; elapsed += 0.5) {
        seen.add(phaseAt(elapsed, profile))
      }

      expect([...seen].sort(), name).toEqual([...new Set(profile.stages.map((s) => s.phase))].sort())
    }
  })

  it('rejects a negative or non-finite elapsed time', () => {
    expect(() => phaseAt(-1, spikeProfile)).toThrow('non-negative finite')
    expect(() => phaseAt(Number.NaN, spikeProfile)).toThrow('non-negative finite')
    expect(() => phaseAt(Number.POSITIVE_INFINITY, spikeProfile)).toThrow('non-negative finite')
  })
})

describe('toK6Stages', () => {
  it('drops `phase`, which k6 does not accept in options.stages', () => {
    for (const stage of toK6Stages(spikeProfile)) {
      expect(Object.keys(stage).sort()).toEqual(['duration', 'target'])
    }
  })

  it('preserves the stage order, durations and targets', () => {
    expect(toK6Stages(smokeProfile)).toEqual([
      { duration: '30s', target: 1 },
      { duration: '1m', target: 1 },
      { duration: '30s', target: 0 },
    ])
  })
})

describe('profile measurements', () => {
  it('reports each profile total duration', () => {
    expect(profileDuration(smokeProfile)).toBe(120)
    expect(profileDuration(soakProfile)).toBe(300 + 14400 + 300)
    expect(profileDuration(spikeProfile)).toBe(60 + 10 + 60 + 10 + 180 + 30)
  })

  it('orders the profiles by peak as their names imply', () => {
    expect(peakVUs(smokeProfile)).toBeLessThan(peakVUs(soakProfile))
    expect(peakVUs(soakProfile)).toBeLessThan(peakVUs(loadProfile))
    expect(peakVUs(loadProfile)).toBeLessThan(peakVUs(stressProfile))
    expect(peakVUs(stressProfile)).toBeLessThan(peakVUs(spikeProfile))
  })

  it('counts a ramp-down as a ramp when measuring steepness', () => {
    // The drop from 400 to 20 in ten seconds is as abrupt as the rise, and a
    // system can fail on it too — connection pools draining, keep-alives
    // closing. Measuring only increases would call that stage flat.
    expect(steepestRamp({ stages: [{ duration: '10s', target: 0, phase: 'ramp-down' }], thresholds: {} })).toBe(0)
    expect(
      steepestRamp({
        stages: [
          { duration: '1s', target: 100, phase: 'burst' },
          { duration: '2s', target: 0, phase: 'ramp-down' },
        ],
        thresholds: {},
      }),
    ).toBe(100)
  })

  it('every profile threshold expression parses', () => {
    for (const [name, profile] of Object.entries(profiles)) {
      for (const [key, expressions] of Object.entries(profile.thresholds)) {
        expect(() => parseMetricKey(key), `${name}: ${key}`).not.toThrow()

        for (const expression of expressions) {
          expect(() => parseThreshold(expression), `${name}: ${key}: ${expression}`).not.toThrow()
        }
      }
    }
  })
})
