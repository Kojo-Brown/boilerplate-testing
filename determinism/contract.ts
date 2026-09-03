/**
 * What can be said about `session.ts`, and what a test must be able to *do* to
 * say it.
 *
 * ---------------------------------------------------------------------------
 * Why the behaviours are shared and the probes are not
 * ---------------------------------------------------------------------------
 * The comparison in `README.md` only means something if every strategy is
 * aimed at the same target. `tdd/schools/orderContract.ts` makes the same move
 * for the London/classicist comparison and for the same reason: two suites
 * written freehand differ in a hundred ways at once, and the one difference
 * being studied disappears into the noise.
 *
 * So the twelve behaviours below are the whole of what anybody is allowed to
 * assert here, written once. A probe is then nothing but a way of getting a
 * clock, a random source, a scheduler and an identity source into a test — and
 * the interesting output is which behaviours it turns out it cannot reach.
 *
 * ---------------------------------------------------------------------------
 * Why reach is derived from capabilities rather than declared
 * ---------------------------------------------------------------------------
 * It would be shorter to write "the ambient probe checks these eight" by hand.
 * It would also be unfalsifiable — the list would be whatever somebody
 * believed on the day, and the headline result of the whole directory is
 * exactly that list.
 *
 * Instead each behaviour declares the {@link Capability | capabilities} it
 * needs, each probe declares the capabilities it has, and the reach is the
 * subset relation between them. A probe cannot quietly claim a behaviour it
 * cannot state, and adding a capability to a probe moves the matrix by itself.
 * `contract.test.ts` closes the loop from the other side: it runs every probe
 * against the unmodified subject and asserts that the behaviours actually
 * reported are exactly the derived ones.
 */

/**
 * Something a test must be able to do to the world, over and above running the
 * code.
 *
 * These are deliberately not "controls the clock" / "controls randomness".
 * That granularity is what makes the standard advice look complete: fake
 * timers *do* control the clock, and a seed *does* control randomness, and yet
 * four faults survive both. The distinctions that turn out to matter are finer
 * and are the ones listed here.
 */
export const CAPABILITIES = [
  'exact-instant',
  'separable-clocks',
  'chosen-draws',
  'median-draw',
  'many-draws',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export const CAPABILITY_NOTES: Readonly<Record<Capability, string>> = {
  'exact-instant':
    'The test can put the wall clock at an instant it names, and hold it there. ' +
    'Anything about a boundary needs this: a real clock passes through the ' +
    'expiry instant, it never sits on it.',
  'separable-clocks':
    'The test can move wall-clock time without moving monotonic time. This is ' +
    'what an NTP correction or a DST transition does to a running process, and ' +
    'it is the one capability `vi.useFakeTimers()` deliberately does not have — ' +
    'measured in `fidelity.test.ts`, where advancing the fake timers moves ' +
    '`Date.now()` and `performance.now()` by exactly the same amount.',
  'chosen-draws':
    'The test can say which values the random source returns, in order. Note ' +
    'that a seed does *not* provide this: a seed makes the draws repeatable, ' +
    'which is a different property and buys strictly less.',
  'median-draw':
    'Every draw is exactly the midpoint. This is the single most common thing ' +
    'written in real suites — `vi.spyOn(Math, "random").mockReturnValue(0.5)` — ' +
    'and it is a capability rather than a limitation, because the midpoint is ' +
    'the one draw a seeded stream will essentially never produce.',
  'many-draws':
    'Draws vary from call to call, so a claim can be made about the whole band ' +
    'rather than about one value. A constant satisfies every other requirement ' +
    'here and not this one.',
}

/** The twelve statable behaviours. */
export const BEHAVIOUR_IDS = [
  'lifetime-is-one-ttl',
  'live-when-issued',
  'expired-at-the-expiry-instant',
  'live-one-millisecond-before-expiry',
  'duration-comes-from-the-monotonic-clock',
  'delay-stays-inside-the-clamped-band',
  'delay-centres-on-half-the-lifetime-at-the-median-draw',
  'a-low-draw-refreshes-earlier-than-a-high-draw',
  'the-jitter-band-is-reached-at-both-ends',
  'the-refresh-fires-no-earlier-than-its-delay',
  'a-cancelled-refresh-never-fires',
  'sessions-issued-together-have-different-ids',
  'renewal-restarts-the-full-lifetime',
] as const

export type BehaviourId = (typeof BEHAVIOUR_IDS)[number]

export interface BehaviourSpec {
  readonly id: BehaviourId
  /** The claim, as a sentence about the system. */
  readonly claim: string
  /** What a test needs to be able to do to state it. */
  readonly requires: readonly Capability[]
}

export const BEHAVIOURS: readonly BehaviourSpec[] = [
  {
    id: 'lifetime-is-one-ttl',
    claim: 'A session expires exactly one TTL after the instant it was issued.',
    requires: [],
  },
  {
    id: 'live-when-issued',
    claim: 'A session is not expired at the instant it is issued.',
    requires: [],
  },
  {
    id: 'expired-at-the-expiry-instant',
    claim: 'A session is expired at exactly its expiry instant, not one millisecond later.',
    requires: ['exact-instant'],
  },
  {
    id: 'live-one-millisecond-before-expiry',
    claim: 'A session is still valid one millisecond before its expiry instant.',
    requires: ['exact-instant'],
  },
  {
    id: 'duration-comes-from-the-monotonic-clock',
    claim: 'A measured duration is unaffected by the wall clock jumping mid-operation.',
    requires: ['separable-clocks'],
  },
  {
    id: 'delay-stays-inside-the-clamped-band',
    claim: 'The refresh delay is never below the minimum nor above the maximum, on any draw.',
    requires: ['many-draws'],
  },
  {
    id: 'delay-centres-on-half-the-lifetime-at-the-median-draw',
    claim: 'On the midpoint draw the refresh sits at exactly half the lifetime.',
    requires: ['median-draw'],
  },
  {
    id: 'a-low-draw-refreshes-earlier-than-a-high-draw',
    claim: 'Jitter is signed: a draw below the midpoint refreshes sooner than one above it.',
    requires: ['chosen-draws'],
  },
  {
    id: 'the-jitter-band-is-reached-at-both-ends',
    // The distributional half of the band claim, and the one people leave out.
    // "Every delay is inside the band" is satisfied by a constant, so on its
    // own it says almost nothing about the jitter; this is what makes the
    // difference between a window that is used and a window that is declared.
    claim: 'Across many draws the delay reaches both the minimum and the maximum.',
    requires: ['many-draws'],
  },
  {
    id: 'the-refresh-fires-no-earlier-than-its-delay',
    claim: 'The scheduled refresh runs, and does not run before the delay it was given.',
    requires: [],
  },
  {
    id: 'a-cancelled-refresh-never-fires',
    claim: 'Cancelling a scheduled refresh stops it.',
    requires: [],
  },
  {
    id: 'sessions-issued-together-have-different-ids',
    claim: 'Two sessions issued without time passing between them have different ids.',
    requires: [],
  },
  {
    id: 'renewal-restarts-the-full-lifetime',
    claim: 'Renewing a session moves its expiry to a full TTL from the present instant.',
    requires: [],
  },
]

export const behaviourNamed = (id: BehaviourId): BehaviourSpec => {
  const found = BEHAVIOURS.find((behaviour) => behaviour.id === id)

  if (found === undefined) {
    throw new Error(`no behaviour named ${id}`)
  }

  return found
}

/**
 * The behaviours a set of capabilities can state.
 *
 * Plain subset: a behaviour is reachable when every capability it requires is
 * present. There is no partial credit, because a behaviour asserted through a
 * capability the probe does not have is not a weaker assertion — it is a
 * different one, usually a tautology.
 */
export function reachableBehaviours(
  capabilities: readonly Capability[],
): readonly BehaviourId[] {
  const held = new Set(capabilities)

  return BEHAVIOURS.filter((behaviour) =>
    behaviour.requires.every((capability) => held.has(capability)),
  ).map((behaviour) => behaviour.id)
}
