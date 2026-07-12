/**
 * Custom k6 metrics for a typical REST API load test.
 *
 * This file imports from the k6 runtime — compile via k6/tsconfig.k6.json,
 * not the root tsconfig (k6 has no DOM/Node types).
 *
 * Passing `true` as the second argument to Trend enables "isTime" mode
 * which makes k6 report the metric in milliseconds with time units in
 * the summary output.
 */

import { Counter, Rate, Trend } from 'k6/metrics'

export const apiMetrics = {
  /** Total successful responses (2xx). */
  successCount: new Counter('api_success_count'),
  /** Rate of VU iterations where all checks passed. */
  checkPassRate: new Rate('api_check_pass_rate'),
  /** End-to-end request latency in ms (time-aware Trend). */
  e2eLatency: new Trend('api_e2e_latency', true),
  /** Count of 4xx client errors. */
  clientErrors: new Counter('api_client_error_count'),
  /** Count of 5xx server errors. */
  serverErrors: new Counter('api_server_error_count'),
} as const
