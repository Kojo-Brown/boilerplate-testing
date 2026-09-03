/**
 * Fifteen single-behaviour changes to `session.ts`, one per fault.
 *
 * ---------------------------------------------------------------------------
 * Why edits to the real source
 * ---------------------------------------------------------------------------
 * The same argument `fuzz/edits.ts`, `snapshot/edits.ts` and
 * `tdd/characterisation/mutants.ts` make. A second copy of the subject rots
 * the first time the original changes and nothing says so; a flag threaded
 * through the real implementation puts the fault list into production code.
 * {@link applyEdits} requires every `from` below to match exactly once in the
 * file on disk, so a change to `session.ts` that invalidates one of these
 * fails `pnpm test` loudly rather than quietly measuring nothing.
 *
 * ---------------------------------------------------------------------------
 * How the corpus is chosen
 * ---------------------------------------------------------------------------
 * Not "fifteen bugs I can think of". Every fault below is anchored to one of
 * the five sources of nondeterminism, and the corpus is built so that each
 * source contributes at least one fault that the standard advice — fake the
 * timers, seed the generator — cannot see. A corpus of only obvious faults
 * would report that the standard advice is complete, which is the mistake this
 * kind of comparison usually makes, and it would be a fact about the corpus
 * rather than about the advice.
 *
 * Several of the fifteen are visible to every probe. They are not filler: without
 * them the matrix has no baseline, and a probe that misses one of *those* is
 * broken rather than limited.
 *
 * Every one of these is a change somebody would write. `TTL_IN_SECONDS` is a
 * unit mix-up, `EXPIRY_BOUNDARY_EXCLUSIVE` is a `>=` somebody softened to `>`
 * to make a flaky test pass, `ELAPSED_FROM_WALL_CLOCK` is the single most
 * common timing bug in production code, and `JITTER_SIGN_FLIPPED` is what
 * happens when a reviewer suggests `(0.5 - r)` reads better than `(r - 0.5)`.
 */

/** The five things `session.ts` cannot compute for itself. */
export const SOURCES = ['wall-clock', 'monotonic-clock', 'randomness', 'scheduler', 'identity'] as const

export type Source = (typeof SOURCES)[number]

export const FAULT_IDS = [
  // ---- wall clock -------------------------------------------------------
  'TTL_IN_SECONDS',
  'EXPIRY_BOUNDARY_EXCLUSIVE',
  'EXPIRY_FROM_MONOTONIC_CLOCK',
  'RENEW_KEEPS_ORIGINAL_EXPIRY',
  // ---- monotonic clock --------------------------------------------------
  'ELAPSED_FROM_WALL_CLOCK',
  // ---- randomness -------------------------------------------------------
  'JITTER_SIGN_FLIPPED',
  'JITTER_ALWAYS_POSITIVE',
  'JITTER_RANGE_HALVED',
  'JITTER_NOT_CLAMPED',
  'MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES',
  'REFRESH_FRACTION_TOO_LATE',
  // ---- scheduler --------------------------------------------------------
  'SCHEDULE_AT_ABSOLUTE_TIME',
  'SCHEDULE_DELAY_IN_SECONDS',
  'CANCEL_DOES_NOT_STOP_REFRESH',
  // ---- identity ---------------------------------------------------------
  'ID_DERIVED_FROM_CLOCK',
] as const

export type FaultId = (typeof FAULT_IDS)[number]

interface Edit {
  readonly from: string
  readonly to: string
}

export interface Fault {
  readonly id: FaultId
  readonly source: Source
  /** One line, as it would read in a pull request. */
  readonly description: string
  readonly edits: readonly Edit[]
}

export const FAULTS: readonly Fault[] = [
  {
    id: 'TTL_IN_SECONDS',
    source: 'wall-clock',
    description: 'The lifetime is added in seconds to a millisecond timestamp.',
    edits: [{ from: 'expiresAt: issuedAt + TTL_MS,', to: 'expiresAt: issuedAt + TTL_MS / 1000,' }],
  },
  {
    id: 'EXPIRY_BOUNDARY_EXCLUSIVE',
    source: 'wall-clock',
    description: 'A session survives one millisecond past its own expiry instant.',
    edits: [
      {
        from: 'return env.now() >= session.expiresAt',
        to: 'return env.now() > session.expiresAt',
      },
    ],
  },
  {
    id: 'EXPIRY_FROM_MONOTONIC_CLOCK',
    source: 'wall-clock',
    description: 'The issue timestamp is read from the monotonic clock, so it is not an instant.',
    edits: [{ from: 'const issuedAt = env.now()', to: 'const issuedAt = env.elapsed()' }],
  },
  {
    id: 'RENEW_KEEPS_ORIGINAL_EXPIRY',
    source: 'wall-clock',
    description: 'Renewal mints a new session but carries the old expiry over.',
    edits: [
      {
        from: 'return issue(env, session.userId)',
        to: 'return { ...issue(env, session.userId), expiresAt: session.expiresAt }',
      },
    ],
  },
  {
    id: 'ELAPSED_FROM_WALL_CLOCK',
    source: 'monotonic-clock',
    description: 'A duration is measured by subtracting two wall-clock readings.',
    edits: [
      { from: 'const startedAt = env.elapsed()', to: 'const startedAt = env.now()' },
      { from: 'const finishedAt = env.elapsed()', to: 'const finishedAt = env.now()' },
    ],
  },
  {
    id: 'JITTER_SIGN_FLIPPED',
    source: 'randomness',
    description: 'Jitter runs backwards: a low draw refreshes late and a high draw early.',
    edits: [
      {
        from: 'const jitter = (env.random() - 0.5) * JITTER_SPAN_MS',
        to: 'const jitter = (0.5 - env.random()) * JITTER_SPAN_MS',
      },
    ],
  },
  {
    id: 'JITTER_ALWAYS_POSITIVE',
    source: 'randomness',
    description: 'Jitter is only ever added, so the refresh never moves earlier.',
    edits: [
      {
        from: 'const jitter = (env.random() - 0.5) * JITTER_SPAN_MS',
        to: 'const jitter = env.random() * JITTER_SPAN_MS',
      },
    ],
  },
  {
    id: 'JITTER_RANGE_HALVED',
    source: 'randomness',
    description: 'The jitter window is half the configured width, so clients bunch up.',
    edits: [
      {
        from: 'const jitter = (env.random() - 0.5) * JITTER_SPAN_MS',
        to: 'const jitter = (env.random() - 0.5) * (JITTER_SPAN_MS / 2)',
      },
    ],
  },
  {
    id: 'JITTER_NOT_CLAMPED',
    source: 'randomness',
    description: 'The clamp is dropped, so an extreme draw schedules a refresh in the past.',
    edits: [{ from: 'return clampDelay(base + jitter)', to: 'return base + jitter' }],
  },
  {
    id: 'MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES',
    source: 'randomness',
    description: 'The lower clamp only catches negatives, so a refresh can be scheduled below the floor.',
    edits: [{ from: 'if (delayMs < MIN_REFRESH_DELAY_MS) {', to: 'if (delayMs < 0) {' }],
  },
  {
    id: 'REFRESH_FRACTION_TOO_LATE',
    source: 'randomness',
    description: 'The refresh is aimed at 90% of the lifetime rather than the configured fraction.',
    edits: [
      { from: 'const base = TTL_MS * REFRESH_FRACTION', to: 'const base = TTL_MS * 0.9' },
    ],
  },
  {
    id: 'SCHEDULE_AT_ABSOLUTE_TIME',
    source: 'scheduler',
    description: 'The scheduler is handed an absolute instant where it expects a delay.',
    edits: [{ from: '}, delayMs)', to: '}, session.expiresAt)' }],
  },
  {
    id: 'SCHEDULE_DELAY_IN_SECONDS',
    source: 'scheduler',
    description: 'The delay is converted to seconds, so the refresh fires almost immediately.',
    edits: [{ from: '}, delayMs)', to: '}, delayMs / 1000)' }],
  },
  {
    id: 'CANCEL_DOES_NOT_STOP_REFRESH',
    source: 'scheduler',
    description: 'The returned canceller is a no-op, so a cancelled refresh still runs.',
    edits: [{ from: 'return { delayMs, cancel }', to: 'return { delayMs, cancel: () => {} }' }],
  },
  {
    id: 'ID_DERIVED_FROM_CLOCK',
    source: 'identity',
    description: 'The session id is built from the issue timestamp instead of a fresh identifier.',
    edits: [{ from: 'id: env.uuid(),', to: 'id: `session-${issuedAt}`,' }],
  },
]

export const faultNamed = (id: FaultId): Fault => {
  const found = FAULTS.find((fault) => fault.id === id)

  if (found === undefined) {
    throw new Error(`no fault named ${id}`)
  }

  return found
}

/**
 * Applies every edit, refusing anything that does not match exactly once.
 *
 * "Exactly once" and not "at least once" is the load-bearing part. An edit
 * that matches twice changes two things and stops being a single-behaviour
 * fault; an edit that matches zero times changes nothing, and a corpus of
 * no-op faults reports that every probe catches everything.
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let result = source

  for (const edit of edits) {
    const occurrences = result.split(edit.from).length - 1

    if (occurrences !== 1) {
      throw new Error(
        `edit anchor matched ${occurrences} times, expected exactly 1: ${JSON.stringify(edit.from)}`,
      )
    }

    result = result.replace(edit.from, edit.to)
  }

  return result
}
