/**
 * The k6 script `check.ts` runs. Not a template to copy — `load-test.ts` is
 * that — but the subject of a measurement.
 *
 * It does the least a script can do and still exercise every threshold form
 * the published profiles use: one GET per iteration, tagged with the phase the
 * run is in, plus a Counter and a Gauge so `count`, `rate` on a Counter and
 * `value` on a Gauge are all produced by something real. The thresholds come
 * from `agreement.ts`, so the cases and the run cannot disagree about what was
 * asked.
 *
 * Needs a target: `k6/server.ts`, which `check.ts` starts. Run by hand with
 *
 *     node k6/server.ts &
 *     k6 run k6/agreement.scenario.ts
 */

import http from 'k6/http'
import exec from 'k6/execution'
import { Counter, Gauge } from 'k6/metrics'
import type { Options } from 'k6/options'

import {
  AGREEMENT_PROFILE,
  GAUGE_LEVEL,
  HITS_METRIC,
  LEVEL_METRIC,
  agreementThresholds,
} from './agreement.ts'
import { phaseAt, toK6Stages } from './config.ts'

const BASE_URL = (__ENV['BASE_URL'] ?? 'http://localhost:8799').replace(/\/$/, '')

const hits = new Counter(HITS_METRIC)
const level = new Gauge(LEVEL_METRIC)

export const options: Options = {
  stages: toK6Stages(AGREEMENT_PROFILE),
  thresholds: agreementThresholds(),
}

export default function (): void {
  // Milliseconds since the test started, which is what the stage boundaries in
  // the profile are measured from. This is the only input the phase tag needs,
  // and tagging from it rather than from `__VU` is the difference between a
  // `{phase:recovery}` threshold that selects the recovery window and one that
  // selects half the VUs for the whole run.
  const phase = phaseAt(exec.instance.currentTestRunDuration / 1000, AGREEMENT_PROFILE)

  http.get(`${BASE_URL}/health`, { tags: { phase } })

  hits.add(1)
  level.add(GAUGE_LEVEL)
}
