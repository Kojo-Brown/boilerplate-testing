/**
 * The questions each wiring is asked, and the answers it is allowed to give.
 *
 * ---------------------------------------------------------------------------
 * Why a vocabulary per probe
 * ---------------------------------------------------------------------------
 * Every other matrix in this repository scores cells against one closed set of
 * words. That does not work here, because the probes are not all asking the
 * same kind of question. "Did the request succeed" and "does the page believe
 * it is online" have no common vocabulary that is not `ok` / `not ok`, and
 * flattening them to that would throw away the single most useful result in
 * the table — that two wirings which look identical on every request differ on
 * what the page *thinks*.
 *
 * So each probe declares its own outcomes, `matrix.ts` may only use words the
 * probe declares, and `matrix.test.ts` enforces that. A cell whose value is not
 * in its probe's vocabulary is a typo the type system would otherwise wave
 * through as a string.
 *
 * ---------------------------------------------------------------------------
 * On `origin` as an outcome
 * ---------------------------------------------------------------------------
 * Several probes can answer `origin`, and they mean it literally: a body
 * stamped `source: 'origin'` came out of `origin.ts`. What they cannot say is
 * *when* — a response replayed from a six-month-old HAR carries the same stamp
 * as one that arrived over a socket a moment ago, because it is a recording of
 * exactly those bytes.
 *
 * That is not a gap in the instrument. It is the finding, and it is why
 * {@link REACHES_ORIGIN} exists: the only way to tell a replay from the real
 * thing is to ask the origin whether it was asked, which the spec does over a
 * socket of its own, outside the browser and outside every route handler.
 */

/** A question put to a wiring, and the answers it may give. */
export interface Probe {
  readonly name: string
  /** The question, in the terms someone debugging their suite would ask it. */
  readonly question: string
  /** The closed set of answers. A cell outside it fails `matrix.test.ts`. */
  readonly outcomes: readonly string[]
  /** Why the question is worth a column. */
  readonly note: string
}

/**
 * The request the `reaches-origin` probe asks about.
 *
 * `/api/profile` rather than any of the others because it is the plainest
 * thing in the fixture: a GET that is in the recording, unchanged since, and
 * that every wiring is able to answer somehow. Whatever a wiring does about
 * *that* request is a statement about the wiring and not about the endpoint.
 */
export const REACHES_ORIGIN = '/api/profile'

/** The word the committed HAR was recorded echoing. */
export const RECORDED_WORD = 'recorded'

/** The word the specs post, which the recording has never seen. */
export const SENT_WORD = 'live'

export const PROBES = [
  {
    name: 'document',
    question: 'Does the page load at all?',
    outcomes: ['origin', 'failed'],
    note:
      'The first thing a fake can take away and the last thing anybody checks ' +
      'for. A wiring scoped to `**/api/**` leaves the document to the network, ' +
      'which is invisible until there is no network.',
  },
  {
    name: 'static-asset',
    question: 'Does the stylesheet the document links arrive?',
    outcomes: ['origin', 'failed'],
    note:
      'The same question one level down, and the one that decides whether a ' +
      'visual assertion in an offline suite is measuring your CSS or its absence.',
  },
  {
    name: 'known-get',
    question: 'Does a GET that is in the recording, and unchanged since, still answer?',
    outcomes: ['origin', 'stub', 'failed'],
    note: 'The happy path every HAR tutorial demonstrates, and the only cell most suites exercise.',
  },
  {
    name: 'reaches-origin',
    question: 'Did that GET actually leave the browser?',
    outcomes: ['reached', 'not-reached'],
    note:
      'Asked of the origin itself, over a socket the browser has no part in. ' +
      'It is the only probe that can separate a replay from the real thing, ' +
      'because the bytes cannot.',
  },
  {
    name: 'drifted-get',
    question: 'What does a GET answer after the origin changed its shape?',
    outcomes: ['origin', 'stale', 'stub', 'failed'],
    note:
      'The recording says `schema: 1` and the origin now serves `schema: 2`, ' +
      'where an item is an object rather than a string. A suite reading the ' +
      'recording is green against an API that would now hand it `undefined`.',
  },
  {
    name: 'unrecorded-get',
    question: 'What happens when the app starts calling an endpoint the fake never saw?',
    outcomes: ['origin', 'stub', 'failed'],
    note:
      'The commonest way a fake goes wrong in practice: the recording is not ' +
      'wrong about anything it holds, it simply does not hold the new call.',
  },
  {
    name: 'query-variance',
    question: 'Does the same path with a cache-busting query still match the recording?',
    outcomes: ['origin', 'stub', 'failed'],
    note:
      'A URL contains its query string, and a matcher that compares URLs ' +
      'compares it too. Whether that is what happens is measured rather than ' +
      'assumed — it is a property of the replayer, not of HTTP.',
  },
  {
    name: 'post-echo',
    question: 'Does a POST whose answer depends on its body get the answer for the body it sent?',
    outcomes: ['echoes-sent', 'echoes-recorded', 'stub', 'failed'],
    note:
      'The recording echoes one word and the spec posts another. A replayer ' +
      'that matches on method and URL alone answers the first, confidently, ' +
      'and a suite asserting on the response asserts on the recording.',
  },
  {
    name: 'retry-recovers',
    question: "Does the client's retry path run?",
    outcomes: ['recovered', 'first-try', 'failed'],
    note:
      'The origin fails the first request after a reset and succeeds after ' +
      'that, so the retry is provoked by the server rather than by the client. ' +
      'A fake that always succeeds deletes the branch the retry exists for, and ' +
      'the test that covers it passes without executing it.',
  },
  {
    name: 'online-flag',
    question: 'What does `navigator.onLine` say?',
    outcomes: ['online', 'offline'],
    note:
      'The question that separates the two ways of "going offline". Aborting ' +
      'requests makes them fail; it does not make the page think anything.',
  },
  {
    name: 'offline-event',
    question: 'Does an `offline` event reach a listener the page installed?',
    outcomes: ['fired', 'silent'],
    note:
      'The other half of the same separation, and the one an offline banner, ' +
      'a sync queue or a service-worker registration is actually wired to.',
  },
  {
    name: 'observed-by-test',
    question: "Does `page.on('request')` see the request?",
    outcomes: ['observed', 'unobserved'],
    note:
      'It sees every request the page makes, including the ones no socket ' +
      'carried. An assertion that counts requests proves the client tried, and ' +
      'nothing whatsoever about the network.',
  },
] as const satisfies readonly Probe[]

export type ProbeName = (typeof PROBES)[number]['name']

export const PROBE_NAMES: readonly ProbeName[] = PROBES.map((probe) => probe.name)

export const probeByName = (name: string): Probe | undefined =>
  PROBES.find((probe) => probe.name === name)

/** Every outcome word any probe declares, deduplicated — for the README audit. */
export const ALL_OUTCOMES: readonly string[] = [
  ...new Set(PROBES.flatMap((probe) => probe.outcomes)),
]
