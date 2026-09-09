/**
 * Provider verification, run for real.
 *
 * This file used to be a template: it pointed `Verifier` at
 * `PROVIDER_BASE_URL`, listed six state handlers whose bodies were comments,
 * and skipped itself unless that variable was set. It never ran, here or
 * anywhere, which is the ordinary way a contract-testing setup ends up
 * half-built — the consumer half needs nothing but the consumer, and the
 * provider half needs a provider.
 *
 * So there is a provider now (`app.ts`) with real state handlers
 * (`states.ts`), and this suite starts it, verifies the pact against it, and
 * fails when it does not hold.
 *
 * Two things it deliberately does *not* do, both measured in `pipeline/`:
 *
 *   - It reads the pact from the filesystem, which is the weakest of the
 *     wirings compared there. A file is only as current as the last person to
 *     copy it, and nothing in this suite can tell a current file from a stale
 *     one.
 *   - It publishes nothing. A verification whose result nobody records cannot
 *     answer "is this provider safe to deploy", which is what `can-i-deploy`
 *     is for.
 *
 * That is not a gap to be apologised for: this is what provider verification
 * looks like inside one repository, it is the version most teams start with,
 * and `pipeline/README.md` is the argument for the next step rather than an
 * assertion that this one is worthless.
 */

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONSUMER_PACT_FILE } from '../pact.config'
import { verifyProvider } from './verify'

describe('Users and Auth API — provider verification', () => {
  it('honours every interaction in the consumer pact', async () => {
    expect(
      existsSync(CONSUMER_PACT_FILE),
      `No pact at ${CONSUMER_PACT_FILE}. The consumer suites write it, and ` +
        '`pnpm test:pact` runs both halves in file order.',
    ).toBe(true)

    const outcome = await verifyProvider({
      source: { kind: 'files', paths: [CONSUMER_PACT_FILE] },
    })

    // Asserted on the whole outcome rather than on `kind` alone: a failure
    // prints the verifier's message, which names the interaction.
    expect(outcome).toEqual({ kind: 'passed' })
  }, 60_000)
})
