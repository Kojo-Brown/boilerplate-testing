// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { LandmineAuditLog, SpyAuditLog } from './dummy'
import { faultNamed } from './faults'
import { dummyProbe } from './probes'
import { createRegisterUser } from './registerUser'
import { buildWorld, InertAuditLog } from './world'

const AUDITS_EVERYTHING = faultNamed('AUDITS_EVERY_REGISTRATION')

describe('dummy', () => {
  it('lets the feature run while proving the audit log stays out of it', async () => {
    await dummyProbe(createRegisterUser)
  })

  it('fails the moment the unused collaborator is used', async () => {
    const registerUser = AUDITS_EVERYTHING.build(buildWorld({ audit: new LandmineAuditLog() }))

    await expect(
      registerUser({ email: 'alice@example.com', plan: 'team', actor: { kind: 'self' } }),
    ).rejects.toThrow(/must not audit/)
  })

  it('proves nothing at all when it is written the passive way', async () => {
    // The same bug, the same test, a dummy that does nothing instead of
    // exploding: green. This is the argument for the landmine, run rather
    // than asserted — `detection.test.ts` shows the other four kinds are
    // equally blind to this fault, so a passive dummy leaves it uncovered by
    // the entire suite.
    const registerUser = AUDITS_EVERYTHING.build(buildWorld({ audit: new InertAuditLog() }))

    const result = await registerUser({
      email: 'alice@example.com',
      plan: 'team',
      actor: { kind: 'self' },
    })

    expect(result.status).toBe('registered')
  })

  it('is a spy instead when the path under test is the one that audits', async () => {
    // Same interface, same object shape, different kind — because this test
    // wants something from it. An admin registering somebody else *must*
    // leave a trail, so here the collaborator is the subject, not scenery.
    const audit = new SpyAuditLog()
    const registerUser = createRegisterUser(buildWorld({ audit }))

    await registerUser({
      email: 'alice@example.com',
      plan: 'team',
      actor: { kind: 'admin', adminId: 'admin-7' },
    })

    expect(audit.entries).toEqual([
      { actorId: 'admin-7', action: 'registered_user', subject: 'alice@example.com' },
    ])
  })
})
