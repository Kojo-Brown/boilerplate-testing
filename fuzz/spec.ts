/**
 * The schema, restated as a predicate, for the invariant oracle to check
 * accepted configs against.
 *
 * ---------------------------------------------------------------------------
 * The uncomfortable thing about this file
 * ---------------------------------------------------------------------------
 * It is a second implementation of `validateConfig`'s rules. That is not an
 * accident of how it was written; it is what an oracle for a validator
 * *always* is, and the honest way to present the technique is to admit it
 * rather than dress it up. There is no `JSON.parse` for business logic. If you
 * want a fuzzer to judge whether a config was rightly accepted, somebody has
 * to write down what "rightly" means a second time, and the second writing is
 * as capable of being wrong as the first.
 *
 * What makes it worth writing anyway is that the two are not equally likely to
 * be wrong in the same place. This file answers one question — *is this
 * finished value acceptable* — over a value that is already parsed, typed and
 * whole. `validateConfig` answers a harder one over `unknown`, in a specific
 * order, accumulating messages, deciding which failures suppress which others,
 * and it is those mechanics that the four validator faults in `edits.ts` live
 * in. A statement of the rules that carries none of the mechanics is a real
 * check on the mechanics.
 *
 * What it cannot be is a check on the *rules*. Both files read the bounds from
 * the same exported constants, deliberately: duplicating `60_000` here would
 * turn a shared misunderstanding into a passing test and a disagreement about
 * a number into a failing one, which is precisely backwards. So a rule that is
 * wrong in `config.ts` is wrong here too, and `RATIO_UPPER_BOUND_EXCLUSIVE` is
 * the fault in `edits.ts` that measures what that costs.
 */

import {
  CONFIG_KEYS,
  LIMITS_KEYS,
  MAX_TAGS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  RATIO_RANGE,
  RETRIES_RANGE,
  TAG_PATTERN,
  TIMEOUT_MS_RANGE,
  type Config,
} from './config.ts'

function inRange(value: unknown, range: { min: number; max: number }): boolean {
  return typeof value === 'number' && value >= range.min && value <= range.max
}

/**
 * Why this value is not an acceptable config, or `null` if it is one.
 *
 * A sentence rather than a boolean: when the invariant oracle fires, the
 * question that follows is always "on what", and a probe that answers
 * `false` sends whoever is reading the report back to the debugger.
 */
export function specViolation(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'not an object'
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = [...CONFIG_KEYS].sort()

  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return `keys are [${keys.join(', ')}], expected [${expected.join(', ')}]`
  }

  const config = record as unknown as Config

  if (typeof config.name !== 'string') {
    return 'name is not a string'
  }

  if (config.name.length > NAME_MAX_LENGTH) {
    return `name is ${config.name.length} characters, over the ${NAME_MAX_LENGTH} limit`
  }

  if (!NAME_PATTERN.test(config.name)) {
    return `name ${JSON.stringify(config.name)} does not match ${String(NAME_PATTERN)}`
  }

  if (!Number.isInteger(config.retries) || !inRange(config.retries, RETRIES_RANGE)) {
    return `retries is ${String(config.retries)}`
  }

  if (!Number.isInteger(config.timeoutMs) || !inRange(config.timeoutMs, TIMEOUT_MS_RANGE)) {
    return `timeoutMs is ${String(config.timeoutMs)}`
  }

  if (!Array.isArray(config.tags)) {
    return 'tags is not an array'
  }

  if (config.tags.length > MAX_TAGS) {
    return `tags has ${config.tags.length} entries, over the ${MAX_TAGS} limit`
  }

  for (const tag of config.tags) {
    if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
      return `tag ${JSON.stringify(tag)} does not match ${String(TAG_PATTERN)}`
    }
  }

  if (new Set(config.tags).size !== config.tags.length) {
    return `tags [${config.tags.join(', ')}] contains a duplicate`
  }

  const limits: unknown = config.limits

  if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) {
    return 'limits is not an object'
  }

  const limitKeys = Object.keys(limits).sort()
  const expectedLimitKeys = [...LIMITS_KEYS].sort()

  if (
    limitKeys.length !== expectedLimitKeys.length ||
    limitKeys.some((key, index) => key !== expectedLimitKeys[index])
  ) {
    return `limits keys are [${limitKeys.join(', ')}], expected [${expectedLimitKeys.join(', ')}]`
  }

  if (typeof config.limits.enabled !== 'boolean') {
    return 'limits.enabled is not a boolean'
  }

  if (!inRange(config.limits.ratio, RATIO_RANGE)) {
    return `limits.ratio is ${String(config.limits.ratio)}`
  }

  return null
}

/**
 * Whether a *document* — the thing the validator was handed, not the thing it
 * returned — carries exactly the fields the schema knows about.
 *
 * Separate from `specViolation` because it is the one property the returned
 * value cannot carry evidence of. `validateConfig` rebuilds its result from
 * the schema's own field list, so an accepted output has exactly the right
 * keys whether or not the input did; the information lost when an unknown key
 * is silently dropped is only visible upstream. `UNKNOWN_KEY_IGNORED` is the
 * fault that exists to prove the distinction is real, and it is caught here
 * and nowhere else.
 */
export function unknownKeys(document: unknown): readonly string[] {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return []
  }

  const record = document as Record<string, unknown>
  const found = Object.keys(record).filter((key) => !(CONFIG_KEYS as readonly string[]).includes(key))

  const limits: unknown = record.limits

  if (typeof limits === 'object' && limits !== null && !Array.isArray(limits)) {
    found.push(
      ...Object.keys(limits)
        .filter((key) => !(LIMITS_KEYS as readonly string[]).includes(key))
        .map((key) => `limits.${key}`),
    )
  }

  return found
}
