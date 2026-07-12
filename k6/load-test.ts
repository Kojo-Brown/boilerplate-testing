/**
 * k6 load test template — ramp-up → steady-state → ramp-down
 *
 * Usage:
 *   k6 run k6/load-test.ts
 *   K6_PROFILE=smoke  k6 run k6/load-test.ts
 *   K6_PROFILE=stress BASE_URL=https://api.example.com k6 run k6/load-test.ts
 *
 * Environment variables:
 *   BASE_URL     Target base URL            (default: http://localhost:3000)
 *   K6_PROFILE   smoke | load | stress | soak  (default: load)
 *   API_TOKEN    Bearer token for authenticated endpoints (optional)
 *   SLEEP_MIN    Minimum think-time between iterations in seconds (default: 0.5)
 *   SLEEP_MAX    Maximum think-time between iterations in seconds (default: 1.5)
 *
 * Compile / bundle (required for imports):
 *   npx esbuild k6/load-test.ts --bundle --outfile=dist/load-test.js \
 *     --external:k6 --external:k6/* --platform=neutral --format=esm
 *   k6 run dist/load-test.js
 */

import http from 'k6/http'
import { check, group, sleep } from 'k6'
import type { Options } from 'k6/options'
import { apiMetrics } from './metrics'
import { resolveProfile } from './config'

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const BASE_URL = (__ENV['BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '')
const SLEEP_MIN = parseFloat(__ENV['SLEEP_MIN'] ?? '0.5')
const SLEEP_MAX = parseFloat(__ENV['SLEEP_MAX'] ?? '1.5')
const API_TOKEN = __ENV['API_TOKEN'] ?? ''

const profile = resolveProfile(__ENV['K6_PROFILE'])

// ---------------------------------------------------------------------------
// k6 options — exported so k6 picks them up at startup
// ---------------------------------------------------------------------------

export const options: Options = {
  stages: profile.stages as Array<{ duration: string; target: number }>,
  thresholds: {
    ...profile.thresholds,
    // Ensure ≥99% of all checks pass across every iteration
    api_check_pass_rate: ['rate>0.99'],
    // Allow no more than 10 server errors across the entire run
    api_server_error_count: ['count<10'],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const authHeaders = API_TOKEN
  ? ({ Authorization: `Bearer ${API_TOKEN}` } as const)
  : ({} as const)

/** Jitter sleep to simulate realistic user think-time. */
function thinkTime(): void {
  sleep(SLEEP_MIN + Math.random() * (SLEEP_MAX - SLEEP_MIN))
}

type RecordResult = { passed: boolean; status: number; duration: number }

function recordResult(status: number, duration: number, passed: boolean): RecordResult {
  apiMetrics.checkPassRate.add(passed)
  apiMetrics.e2eLatency.add(duration)

  if (status >= 200 && status < 300) {
    apiMetrics.successCount.add(1)
  } else if (status >= 400 && status < 500) {
    apiMetrics.clientErrors.add(1)
  } else if (status >= 500) {
    apiMetrics.serverErrors.add(1)
  }

  return { passed, status, duration }
}

// ---------------------------------------------------------------------------
// Default function — k6 calls this once per VU per iteration
// ---------------------------------------------------------------------------

export default function (): void {
  // ------------------------------------------------------------------
  // Scenario 1: health check (unauthenticated, fast path)
  // ------------------------------------------------------------------
  group('health check', () => {
    const res = http.get(`${BASE_URL}/health`, { tags: { endpoint: 'health' } })

    const passed = check(res, {
      'health: status 200': (r) => r.status === 200,
      'health: response < 200ms': (r) => r.timings.duration < 200,
      'health: content-type json': (r) =>
        (r.headers['Content-Type'] ?? '').includes('application/json'),
    })

    recordResult(res.status, res.timings.duration, passed)
  })

  thinkTime()

  // ------------------------------------------------------------------
  // Scenario 2: paginated list (authenticated)
  // ------------------------------------------------------------------
  group('list users', () => {
    const res = http.get(`${BASE_URL}/v1/users?page=1&limit=20`, {
      headers: authHeaders,
      tags: { endpoint: 'users-list' },
    })

    const passed = check(res, {
      'users list: status 200 or 401': (r) => r.status === 200 || r.status === 401,
      'users list: response < 500ms': (r) => r.timings.duration < 500,
    })

    recordResult(res.status, res.timings.duration, passed)
  })

  thinkTime()

  // ------------------------------------------------------------------
  // Scenario 3: POST resource creation (authenticated)
  // ------------------------------------------------------------------
  group('create resource', () => {
    const payload = JSON.stringify({ name: `user-${__VU}-${__ITER}`, role: 'viewer' })

    const res = http.post(`${BASE_URL}/v1/users`, payload, {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      tags: { endpoint: 'users-create' },
    })

    const passed = check(res, {
      'create: status 201 or 401': (r) => r.status === 201 || r.status === 401,
      'create: response < 1000ms': (r) => r.timings.duration < 1000,
    })

    recordResult(res.status, res.timings.duration, passed)
  })

  thinkTime()
}
