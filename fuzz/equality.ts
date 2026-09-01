/**
 * Structural comparison, own properties only.
 *
 * Vitest has `toEqual` and this file still exists, for two reasons that both
 * turn out to matter.
 *
 * The first is that an oracle is not an assertion. A probe has to *decide*
 * whether two values differ and carry on either way, three hundred times a
 * campaign; throwing is the wrong control flow, and catching a thrown
 * assertion to use it as a boolean is worse.
 *
 * The second is `__proto__`. The fault this directory cares most about turns a
 * data property into a prototype, and a comparison that walks inherited
 * properties cannot see the difference — the polluted object answers `x` just
 * as the honest one does. `Object.keys` and `Object.hasOwn` are what make
 * `PROTOTYPE_POLLUTION` visible at all, and a comparison written without
 * thinking about it would have quietly scored that fault as undetectable by
 * every probe here.
 *
 * `-0` is the other deliberate choice, and it is a *pair* of choices, because
 * the two oracles that compare values want different answers:
 *
 *   - `sameValue` distinguishes `-0` from `0`, because `JSON.parse('-0')` is
 *     `-0` and a parser that loses the sign has lost information the reference
 *     kept.
 *   - `sameRoundTrip` does not, because `JSON.stringify(-0)` is `"0"` and no
 *     correct parser can survive a round trip through a serialiser that cannot
 *     write the value down. Insisting otherwise would make the round-trip
 *     oracle fail on the control, which is a false alarm dressed as rigour.
 *
 * `tdd/characterisation/observe.ts` hit the same wall from the other side and
 * normalised `-0` away; here the divergence is small enough to name twice.
 */

interface Options {
  /** Treat `-0` and `0` as different values. */
  readonly signedZero: boolean
}

function equal(left: unknown, right: unknown, options: Options): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left) && Number.isNaN(right)) {
      return true
    }

    return options.signedZero ? Object.is(left, right) : left === right
  }

  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return left === right
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    return false
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, position) => equal(item, right[position], options))
    )
  }

  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every(
    (key, position) =>
      key === rightKeys[position] &&
      equal(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        options,
      ),
  )
}

/** Equal as data, counting the sign of zero. For the differential oracle. */
export function sameValue(left: unknown, right: unknown): boolean {
  return equal(left, right, { signedZero: true })
}

/** Equal as data, ignoring the sign of zero. For the round-trip oracle. */
export function sameRoundTrip(left: unknown, right: unknown): boolean {
  return equal(left, right, { signedZero: false })
}
