/**
 * Local matcher helpers for the consumer pact tests.
 *
 * `MatchersV3` in @pact-foundation/pact v13 does not ship `email` or
 * `iso8601DateTime` matchers — the shipped primitives are `regex`, `datetime`,
 * `timestamp`, `date`, `string`, `integer`, `decimal`, `uuid` and friends.
 * These two helpers rebuild the missing semantics on top of the real API so
 * the contracts still express "this field is an email" and "this field is an
 * ISO-8601 instant" rather than degrading to a loose `string` matcher.
 */

import { MatchersV3 } from '@pact-foundation/pact'

const { regex, datetime } = MatchersV3

/**
 * Matches an email-shaped string: a local part, an `@`, and a dotted domain,
 * with no whitespace. Deliberately permissive — a contract test asserts the
 * shape the provider must honour, not RFC 5322 conformance.
 */
export const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'

export function email(example: string) {
  return regex(EMAIL_PATTERN, example)
}

/**
 * Matches an ISO-8601 instant with millisecond precision, e.g.
 * `2024-01-01T00:00:00.000Z`. The format string is the Java/Rust date pattern
 * the pact FFI expects, not a JavaScript one.
 */
export const ISO8601_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSX"

export function iso8601DateTime(example: string) {
  return datetime(ISO8601_DATETIME_FORMAT, example)
}
