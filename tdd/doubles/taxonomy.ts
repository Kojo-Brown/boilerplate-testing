/**
 * The taxonomy, as data.
 *
 * `README.md` is the deliverable of this folder, and a guide about test
 * doubles that nothing verifies is exactly the artefact it warns against. So
 * the five kinds, the seam each is demonstrated on, the module it lives in,
 * and the guidance printed in the README's tables all live here, and
 * `taxonomy.test.ts` checks the README against them: a kind renamed, a file
 * moved, or a row edited to say something the code does not do fails
 * `pnpm test` rather than sitting in prose being wrong.
 *
 * `DETECTION` is the sharp end. It is the guide's central claim — which kind
 * of double sees which class of defect — and `detection.test.ts` derives the
 * same matrix by actually running every probe against every fault. If a probe
 * is weakened, or a double is made stricter, the two matrices stop agreeing.
 *
 * Naming follows Meszaros' xUnit Test Patterns (dummy, stub, spy, mock, fake),
 * which is also the vocabulary Fowler's "Mocks Aren't Stubs" uses.
 */

import { dummyProbe, fakeProbe, mockProbe, spyProbe, stubProbe } from './probes'
import type { Probe } from './probes'
import type { FaultId } from './faults'
import type { Seam } from './registerUser'

export const DOUBLE_KINDS = ['dummy', 'stub', 'spy', 'mock', 'fake'] as const

export type DoubleKind = (typeof DOUBLE_KINDS)[number]

export type KindEntry = {
  readonly kind: DoubleKind
  /** The module that implements this kind's double, relative to this folder. */
  readonly module: string
  /** The collaborator it is demonstrated on. */
  readonly seam: Seam
  /** One sentence: what this kind *is*. Appears verbatim in the README. */
  readonly headline: string
  /** Reach for it when… Appears verbatim in the README's guide table. */
  readonly whenToUse: string
  /** Stop when… Appears verbatim in the README's guide table. */
  readonly whenNotToUse: string
  /** The test that demonstrates it, in `probes.ts`. */
  readonly probe: Probe
}

export const TAXONOMY: readonly KindEntry[] = [
  {
    kind: 'dummy',
    module: 'dummy.ts',
    seam: 'audit',
    headline: 'Fills a required parameter on a path that must never use it.',
    whenToUse: 'the collaborator is irrelevant to the path under test',
    whenNotToUse: 'the path does use it — then the question is a spy or a mock',
    probe: dummyProbe,
  },
  {
    kind: 'stub',
    module: 'stub.ts',
    seam: 'seats',
    headline: 'Hands back a canned answer the system would otherwise go and fetch.',
    whenToUse: 'the system needs an input and the assertion is about what it did with it',
    whenNotToUse: 'the stub starts branching on its arguments — that is a fake trying to be born',
    probe: stubProbe,
  },
  {
    kind: 'spy',
    module: 'spy.ts',
    seam: 'mailer',
    headline: 'Records the calls it receives; the test asserts on them afterwards.',
    whenToUse: 'the effect you care about is a call that leaves no state behind',
    whenNotToUse: 'the effect is observable as state — assert the state instead',
    probe: spyProbe,
  },
  {
    kind: 'mock',
    module: 'mock.ts',
    seam: 'mailer',
    headline: 'Carries the expected conversation up front and fails on any departure.',
    whenToUse: 'the protocol is the requirement: which calls, with what, in what order',
    whenNotToUse: 'the calls are an implementation detail you expect to change',
    probe: mockProbe,
  },
  {
    kind: 'fake',
    module: 'fake.ts',
    seam: 'users',
    headline: 'A working implementation with a shortcut inside — a Map, not a database.',
    whenToUse: 'the test needs the collaborator to really behave: remember, reject, run out',
    whenNotToUse: 'nothing holds it to the real implementation’s contract',
    probe: fakeProbe,
  },
]

/**
 * Which kinds catch which fault — the guide's central claim.
 *
 * Read a row as: run all five probes against a system with this bug in it, and
 * exactly these kinds go red. Derived independently in `detection.test.ts` by
 * running them.
 */
export const DETECTION: Readonly<Record<FaultId, readonly DoubleKind[]>> = {
  SILENT_WELCOME: ['spy', 'mock'],
  NUDGES_AT_REGISTRATION: ['mock'],
  IGNORES_SEAT_POLICY: ['stub'],
  FORGETS_TO_PERSIST: ['fake'],
  AUDITS_EVERY_REGISTRATION: ['dummy'],
}

/** README table cells: caught, and missed. */
export const CAUGHT = '✓'
export const MISSED = '·'
