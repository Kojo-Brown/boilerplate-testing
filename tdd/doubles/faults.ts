/**
 * Five broken registrations, one per way this feature can plausibly go wrong.
 *
 * The when-to-use guide in `README.md` rests on a claim that is easy to state
 * and easy to get wrong: each kind of double is good at seeing a different
 * class of defect. `detection.test.ts` settles it by running all five probes
 * against all five of these systems and comparing the result to the matrix
 * declared in `taxonomy.ts`. Nothing in the guide is believed on the strength
 * of sounding right.
 *
 * How the faults are built matters. Four of them wrap a collaborator on the
 * way into `createRegisterUser`, and one wraps the use case itself. Either way
 * the resulting `RegisterUser` is a system that behaves *exactly* as the use
 * case would with that bug written into it — a mailer whose `sendWelcome` does
 * nothing is indistinguishable, from every seam, from a use case that forgot
 * to call it. That is worth doing rather than keeping five mutated copies of
 * the use case around, which would rot the moment the real one changed.
 */

import { createRegisterUser } from './registerUser'
import type { RegisterUserDeps, SystemFactory } from './registerUser'

export const FAULT_IDS = [
  'SILENT_WELCOME',
  'NUDGES_AT_REGISTRATION',
  'IGNORES_SEAT_POLICY',
  'FORGETS_TO_PERSIST',
  'AUDITS_EVERY_REGISTRATION',
] as const

export type FaultId = (typeof FAULT_IDS)[number]

export type Fault = {
  readonly id: FaultId
  /** One line, in the README's table, describing the bug as a user would meet it. */
  readonly description: string
  readonly build: SystemFactory
}

/** The number a developer typed the afternoon the policy service was down. */
const HARD_CODED_SEAT_LIMIT = 5

export const FAULTS: readonly Fault[] = [
  {
    id: 'SILENT_WELCOME',
    description: 'the welcome email is never sent',
    build: (deps: RegisterUserDeps) =>
      createRegisterUser({
        ...deps,
        mailer: {
          sendWelcome: async () => {},
          sendUpgradeNudge: (email) => deps.mailer.sendUpgradeNudge(email),
        },
      }),
  },
  {
    id: 'NUDGES_AT_REGISTRATION',
    description: 'a second, unasked-for email goes out with the welcome',
    build: (deps: RegisterUserDeps) =>
      createRegisterUser({
        ...deps,
        mailer: {
          sendWelcome: async (email, details) => {
            await deps.mailer.sendWelcome(email, details)
            await deps.mailer.sendUpgradeNudge(email)
          },
          sendUpgradeNudge: (email) => deps.mailer.sendUpgradeNudge(email),
        },
      }),
  },
  {
    id: 'IGNORES_SEAT_POLICY',
    description: 'every plan gets the same hard-coded seat limit',
    build: (deps: RegisterUserDeps) =>
      createRegisterUser({
        ...deps,
        seats: { seatLimitFor: async () => HARD_CODED_SEAT_LIMIT },
      }),
  },
  {
    id: 'FORGETS_TO_PERSIST',
    description: 'the user is welcomed but never written to the store',
    build: (deps: RegisterUserDeps) =>
      createRegisterUser({
        ...deps,
        users: {
          findByEmail: (email) => deps.users.findByEmail(email),
          save: async () => {},
        },
      }),
  },
  {
    id: 'AUDITS_EVERY_REGISTRATION',
    description: 'self-service signups are written to the audit log too',
    build: (deps: RegisterUserDeps) => {
      // The one fault that wraps the use case rather than a collaborator:
      // an extra call cannot be injected by weakening a dependency.
      const registerUser = createRegisterUser(deps)

      return async (command) => {
        const result = await registerUser(command)

        if (result.status === 'registered') {
          await deps.audit.write({
            actorId: 'system',
            action: 'registered_user',
            subject: result.user.email,
          })
        }

        return result
      }
    },
  },
]

/** Lookup by id, so a test naming a fault that no longer exists says so. */
export function faultNamed(id: FaultId): Fault {
  const fault = FAULTS.find((candidate) => candidate.id === id)

  if (fault === undefined) {
    throw new Error(`no fault named ${id}`)
  }

  return fault
}
