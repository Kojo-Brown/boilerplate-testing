/**
 * The one feature every test double in this folder is pointed at.
 *
 * A taxonomy of test doubles is only useful if the five kinds are compared on
 * the same subject. Five unrelated snippets — a stub over here, a mock over
 * there — teach the mechanics of five libraries and nothing about the choice
 * between them, because no snippet is ever a live alternative to another. So
 * there is one use case, with four collaborators, and every kind of double is
 * demonstrated against it. Which collaborator each kind lands on is itself
 * part of the lesson: `mailer` is a spy in one test and a mock in the next,
 * because a double's kind is a property of how a test uses it, not of the
 * object.
 *
 * The feature: register a user. Reject a malformed address, reject one that is
 * already taken, ask the seat policy what the requested plan allows, persist
 * the record, welcome them by email, and — only when an admin registered
 * somebody else — write an audit entry.
 *
 * Deliberate details, each of which some double is later able (or unable) to
 * see:
 *   - the seat limit is *asked for*, never assumed, so a test can vary it;
 *   - the welcome email carries no seat limit, so spying on the mailer tells
 *     you nothing about the policy;
 *   - self-service registration writes no audit entry, so on that path the
 *     audit log is genuinely unused;
 *   - persistence happens before the email, so a bounced send never loses a
 *     signup.
 */

// ---------------------------------------------------------------------------
// The feature's vocabulary
// ---------------------------------------------------------------------------

export type Plan = 'free' | 'team' | 'enterprise'

/**
 * Who is doing the registering. Self-service is the ordinary path; an admin
 * registering somebody else is the path that is auditable, because that is the
 * one where a person acted on another person's account.
 */
export type Actor =
  | { readonly kind: 'self' }
  | { readonly kind: 'admin'; readonly adminId: string }

export type RegisterUserCommand = {
  readonly email: string
  readonly plan: Plan
  readonly actor: Actor
}

export type RegisteredUser = {
  /** Always normalised: trimmed and lower-cased. */
  readonly email: string
  readonly plan: Plan
  readonly seatLimit: number
}

export type RejectionReason = 'INVALID_EMAIL' | 'EMAIL_TAKEN'

export type RegisterUserResult =
  | { readonly status: 'registered'; readonly user: RegisteredUser }
  | { readonly status: 'rejected'; readonly reason: RejectionReason }

// ---------------------------------------------------------------------------
// The collaborators
// ---------------------------------------------------------------------------

export interface UserStore {
  findByEmail(email: string): Promise<RegisteredUser | null>
  save(user: RegisteredUser): Promise<void>
}

/** Remote configuration: how many seats a plan is entitled to today. */
export interface SeatPolicy {
  seatLimitFor(plan: Plan): Promise<number>
}

export type WelcomeDetails = {
  readonly plan: Plan
}

export interface Mailer {
  sendWelcome(email: string, details: WelcomeDetails): Promise<void>
  /**
   * Sent by the *upgrade* campaign, never by registration. It exists here so
   * that "the system made a call nobody asked for" is a fault a double can be
   * confronted with — see `faults.ts`.
   */
  sendUpgradeNudge(email: string): Promise<void>
}

export type AuditEntry = {
  readonly actorId: string
  readonly action: string
  readonly subject: string
}

export interface AuditLog {
  write(entry: AuditEntry): Promise<void>
}

export type RegisterUserDeps = {
  readonly users: UserStore
  readonly seats: SeatPolicy
  readonly mailer: Mailer
  readonly audit: AuditLog
}

/** The seam names, in the order the README introduces them. */
export const SEAMS = ['users', 'seats', 'mailer', 'audit'] as const

export type Seam = (typeof SEAMS)[number]

export type RegisterUser = (command: RegisterUserCommand) => Promise<RegisterUserResult>

/**
 * A function that builds the system under test from a set of collaborators.
 *
 * `createRegisterUser` is the correct one; `faults.ts` supplies broken ones
 * with the same signature, so a probe can be run against either without
 * knowing which it got.
 */
export type SystemFactory = (deps: RegisterUserDeps) => RegisterUser

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/**
 * Good enough for a registration form and small enough to read: a local part,
 * an `@`, a dotted domain, no whitespace. Address validation is not the point
 * of this folder, and RFC 5322 in a regex is nobody's idea of a lesson.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createRegisterUser(deps: RegisterUserDeps): RegisterUser {
  return async function registerUser(command: RegisterUserCommand): Promise<RegisterUserResult> {
    const email = command.email.trim().toLowerCase()

    if (!EMAIL_PATTERN.test(email)) {
      return { status: 'rejected', reason: 'INVALID_EMAIL' }
    }

    const existing = await deps.users.findByEmail(email)
    if (existing !== null) {
      return { status: 'rejected', reason: 'EMAIL_TAKEN' }
    }

    const seatLimit = await deps.seats.seatLimitFor(command.plan)
    const user: RegisteredUser = { email, plan: command.plan, seatLimit }

    // Persist first: an email provider having a bad afternoon must not cost us
    // the signup.
    await deps.users.save(user)
    await deps.mailer.sendWelcome(email, { plan: user.plan })

    if (command.actor.kind === 'admin') {
      await deps.audit.write({
        actorId: command.actor.adminId,
        action: 'registered_user',
        subject: email,
      })
    }

    return { status: 'registered', user }
  }
}
