/**
 * One test per kind of double, written the way that kind is meant to be used.
 *
 * These are the real tests — `dummy.test.ts` and its four siblings run them,
 * one apiece, and add narrative around them. They live here, as functions over
 * a `SystemFactory`, for one reason: `detection.test.ts` runs every one of them
 * against every deliberately broken system in `faults.ts` and asserts which
 * combinations go red. A claim like "a spy would not have caught this" is then
 * something the suite proves rather than something a README asserts.
 *
 * Each probe touches exactly one seam with its own kind of double and takes
 * the other three from `buildWorld`. Where a probe pointedly does *not* assert
 * something, there is a comment saying so — those silences are the trade-offs
 * the whole comparison is about, not oversights.
 */

import { expect } from 'vitest'

import { LandmineAuditLog } from './dummy'
import { InMemoryUserStore } from './fake'
import { MockMailer } from './mock'
import { SpyMailer } from './spy'
import { StubSeatPolicy } from './stub'
import { buildWorld, expectRegistered } from './world'
import type { RegisterUserCommand, SystemFactory } from './registerUser'

export type Probe = (build: SystemFactory) => Promise<void>

const SELF_SERVICE = { kind: 'self' } as const

function register(email: string, plan: RegisterUserCommand['plan']): RegisterUserCommand {
  return { email, plan, actor: SELF_SERVICE }
}

/**
 * Dummy: the audit log is irrelevant on a self-service signup — prove it.
 *
 * The only assertion is that registration succeeded. The real assertion is the
 * one the landmine makes on the test's behalf: if the use case ever touches
 * the audit log on this path, the throw takes the test down with it.
 */
export const dummyProbe: Probe = async (build) => {
  const registerUser = build(buildWorld({ audit: new LandmineAuditLog() }))

  const result = await registerUser(register('alice@example.com', 'team'))

  expect(result.status).toBe('registered')
}

/**
 * Stub: the seat limit is whatever the policy says, for more than one plan.
 *
 * The table is deliberately not `DEFAULT_SEAT_LIMITS` — if the use case
 * hard-coded the numbers everybody expects, a stub that handed back those same
 * numbers would agree with the bug.
 *
 * Nothing here asserts that the policy was called, or how often. That would be
 * spying; the question a stub answers is what the system did with the answer.
 */
export const stubProbe: Probe = async (build) => {
  const seats = new StubSeatPolicy({ free: 2, team: 30, enterprise: 90 })
  const registerUser = build(buildWorld({ seats }))

  const team = expectRegistered(await registerUser(register('team@example.com', 'team')))
  const enterprise = expectRegistered(
    await registerUser(register('enterprise@example.com', 'enterprise')),
  )

  expect(team.seatLimit).toBe(30)
  expect(enterprise.seatLimit).toBe(90)
}

/**
 * Spy: exactly one welcome email, to the normalised address, and none at all
 * for an address that never registered.
 *
 * `mailer.nudges` is never looked at. That is the spy's characteristic
 * leniency, not an omission: this test is about the welcome email, so an
 * unrelated send stays invisible to it. `detection.test.ts` pins that down.
 */
export const spyProbe: Probe = async (build) => {
  const mailer = new SpyMailer()
  const registerUser = build(buildWorld({ mailer }))

  await registerUser(register('  Alice@Example.com  ', 'team'))
  await registerUser(register('not-an-email', 'team'))

  expect(mailer.welcomes).toEqual([{ email: 'alice@example.com', plan: 'team' }])
}

/**
 * Mock: the entire conversation with the mailer, declared up front.
 *
 * One call, with these arguments, and nothing else — the mock fails on a
 * missing call, a different call, or an extra one, without the test naming any
 * of those failures.
 */
export const mockProbe: Probe = async (build) => {
  const mailer = new MockMailer([
    { method: 'sendWelcome', email: 'alice@example.com', plan: 'team' },
  ])
  const registerUser = build(buildWorld({ mailer }))

  const result = await registerUser(register('alice@example.com', 'team'))

  mailer.verify()
  expect(result.status).toBe('registered')
}

/**
 * Fake: the store ends up holding what registration says it holds.
 *
 * The second half is what a fake buys over a stub — a rule the double enforces
 * on its own. Nobody arranged "this address is taken"; the first registration
 * made it true, and the store answered accordingly.
 *
 * The saved record is compared against the returned one rather than against a
 * literal seat limit, so this test stays about persistence. What the seat
 * limit *should* be is the stub probe's question.
 */
export const fakeProbe: Probe = async (build) => {
  const users = new InMemoryUserStore()
  const registerUser = build(buildWorld({ users }))

  const user = expectRegistered(await registerUser(register('alice@example.com', 'team')))

  expect(users.snapshot()).toEqual([user])

  const again = await registerUser(register('ALICE@Example.com', 'enterprise'))

  expect(again).toEqual({ status: 'rejected', reason: 'EMAIL_TAKEN' })
  expect(users.snapshot()).toEqual([user])
}
