/**
 * The six points in the journey at which the page can be looked at.
 *
 * Kept in its own module because both halves of the measurement need it and
 * neither should import the other: `hazards.ts` places a defect in a state,
 * `strategies.ts` decides which states a scanning strategy ever reaches, and
 * the whole result table is the product of those two facts.
 *
 * The order is the order the journey visits them, and it is load-bearing:
 * `reach` is expressed as a set of states, and the spec drives them in exactly
 * this sequence so that a failure names the first state that disagreed.
 */

export const JOURNEY_STATES = [
  /** The document the server returns, before the order list has resolved. */
  'landing-load',
  /** The same page once the list is in the DOM. */
  'landing-settled',
  /** The preferences dialog, built on click. */
  'dialog-open',
  /** The form after a submit that failed validation. */
  'validation-error',
  /** The confirmation toast after a submit that succeeded. */
  'toast',
  /** The details view, reached by a client-side route change. */
  'route-changed',
] as const

export type JourneyState = (typeof JOURNEY_STATES)[number]

/**
 * The states a full page load can put the browser in directly.
 *
 * Two of the six, and that is the whole argument of this directory in one
 * constant. `landing-load` is what `goto('/')` returns. A direct `goto` of
 * `/details` renders the details view — the fixture's script reads
 * `location.pathname` — so a per-page strategy does reach that markup, but it
 * arrives there without the transition, which is where two of the defects are.
 */
export const DIRECTLY_LOADABLE: readonly JourneyState[] = ['landing-load']

/** Whether a state can only be arrived at by doing something. */
export function requiresInteraction(state: JourneyState): boolean {
  return !DIRECTLY_LOADABLE.includes(state)
}
