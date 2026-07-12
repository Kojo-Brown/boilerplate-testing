import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import { PACT_CONSUMER, PACT_DIR, PACT_LOG_LEVEL, PACT_PROVIDER } from '../pact.config';
import { AuthApiClient } from './api-client';

const { integer, string, regex, email } = MatchersV3;

const JSON_CONTENT_TYPE = regex('application/json.*', 'application/json');

// Synthetic JWT fixture — each segment is the base64url encoding of
// "test-<section>" and contains no secret material whatsoever.
// DO NOT replace with a real or jwt.io example token.
const EXAMPLE_JWT = 'dGVzdC1oZWFkZXI.dGVzdC1wYXlsb2Fk.dGVzdC1zaWduYXR1cmU';

// Three dot-separated base64url segments (the minimal JWT shape).
const JWT_REGEX = '[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+';

const provider = new PactV3({
  consumer: PACT_CONSUMER,
  provider: PACT_PROVIDER,
  dir: PACT_DIR,
  logLevel: PACT_LOG_LEVEL,
});

describe('Auth API — consumer contract', () => {
  it('POST /v1/auth/login → 200 with token pair', () =>
    provider
      .given('valid credentials for alice@example.com')
      .uponReceiving('a login request with valid credentials')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/login',
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          email: email('alice@example.com'),
          password: regex('.{8,}', 'S3cure!Pass'),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          accessToken: regex(JWT_REGEX, EXAMPLE_JWT),
          refreshToken: regex(JWT_REGEX, EXAMPLE_JWT),
          expiresIn: integer(900),
        },
      })
      .executeTest(async (mockServer) => {
        const client = new AuthApiClient(mockServer.url);
        const tokens = await client.login({
          email: 'alice@example.com',
          password: 'S3cure!Pass',
        });

        expect(tokens.accessToken).toBeTruthy();
        expect(tokens.refreshToken).toBeTruthy();
        expect(tokens.expiresIn).toBeTypeOf('number');
        expect(tokens.expiresIn).toBeGreaterThan(0);
      })
  );

  it('POST /v1/auth/login → 401 with invalid credentials', () =>
    provider
      .given('no user with email unknown@example.com exists')
      .uponReceiving('a login request with invalid credentials')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/login',
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          email: email('unknown@example.com'),
          password: string('wrongpassword'),
        },
      })
      .willRespondWith({
        status: 401,
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          statusCode: integer(401),
          error: string('Unauthorized'),
          message: string('Invalid credentials'),
        },
      })
      .executeTest(async (mockServer) => {
        const client = new AuthApiClient(mockServer.url);
        await expect(
          client.login({ email: 'unknown@example.com', password: 'wrongpassword' })
        ).rejects.toThrow('HTTP 401');
      })
  );

  it('POST /v1/auth/refresh → 200 with rotated token pair', () =>
    provider
      .given('a valid refresh token exists')
      .uponReceiving('a token refresh request')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/refresh',
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          refreshToken: regex(JWT_REGEX, EXAMPLE_JWT),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          accessToken: regex(JWT_REGEX, EXAMPLE_JWT),
          refreshToken: regex(JWT_REGEX, EXAMPLE_JWT),
          expiresIn: integer(900),
        },
      })
      .executeTest(async (mockServer) => {
        const client = new AuthApiClient(mockServer.url);
        const tokens = await client.refresh(EXAMPLE_JWT);

        expect(tokens.accessToken).toBeTruthy();
        expect(tokens.refreshToken).toBeTruthy();
        expect(tokens.expiresIn).toBeGreaterThan(0);
      })
  );

  it('POST /v1/auth/logout → 204 no content', () =>
    provider
      .given('a valid refresh token exists')
      .uponReceiving('a logout request')
      .withRequest({
        method: 'POST',
        path: '/v1/auth/logout',
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          refreshToken: regex(JWT_REGEX, EXAMPLE_JWT),
        },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockServer) => {
        const client = new AuthApiClient(mockServer.url);
        await expect(client.logout(EXAMPLE_JWT)).resolves.toBeUndefined();
      })
  );
});
