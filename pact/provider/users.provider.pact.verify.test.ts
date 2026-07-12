/**
 * Provider-side verification — copy this file into the API provider's test suite.
 *
 * Prerequisites:
 *   1. Run consumer tests first to generate pacts/boilerplate-consumer-boilerplate-api.json
 *   2. Start the provider server and set PROVIDER_BASE_URL (default: http://localhost:3000)
 *   3. Run: PROVIDER_BASE_URL=http://localhost:3000 vitest run --config pact/vitest.config.ts
 */
import { Verifier } from '@pact-foundation/pact';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { PACT_LOG_LEVEL, PACT_PROVIDER, PACT_PROVIDER_BASE_URL } from '../pact.config';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Users API — provider verification', () => {
  // Skipped when no live provider is available (consumer CI).
  // Remove the condition when running in the provider's CI.
  it.skipIf(!process.env['PROVIDER_BASE_URL'])(
    'satisfies all consumer contracts',
    () => {
      const verifier = new Verifier({
        provider: PACT_PROVIDER,
        providerBaseUrl: PACT_PROVIDER_BASE_URL,
        pactUrls: [
          resolve(__dirname, '../../pacts/boilerplate-consumer-boilerplate-api.json'),
        ],
        logLevel: PACT_LOG_LEVEL,
        stateHandlers: {
          'user with id 1 exists': async () => {
            // Seed: ensure a user with id=1 exists in the test DB.
            // e.g. await prisma.user.upsert({ where: { id: 1 }, create: { ... }, update: {} });
          },
          'users exist': async () => {
            // Seed: ensure at least one user row exists.
          },
          'no user with email bob@example.com exists': async () => {
            // Cleanup: remove bob@example.com before the create-user interaction.
            // e.g. await prisma.user.deleteMany({ where: { email: 'bob@example.com' } });
          },
          'valid credentials for alice@example.com': async () => {
            // Seed: upsert alice@example.com with a known hashed password.
          },
          'no user with email unknown@example.com exists': async () => {
            // Cleanup: ensure unknown@example.com is absent.
          },
          'a valid refresh token exists': async () => {
            // Seed: insert a non-expired refresh token in the DB.
          },
        },
      });

      return verifier.verifyProvider();
    },
    60_000,
  );
});
