import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import { PACT_CONSUMER, PACT_DIR, PACT_LOG_LEVEL, PACT_PROVIDER } from '../pact.config';
import { UsersApiClient } from './api-client';

const { integer, string, email, iso8601DateTime, regex, eachLike } = MatchersV3;

// Shared provider instance — each `it` block creates an isolated interaction
// and writes the resulting pact to `pacts/boilerplate-consumer-boilerplate-api.json`.
const provider = new PactV3({
  consumer: PACT_CONSUMER,
  provider: PACT_PROVIDER,
  dir: PACT_DIR,
  logLevel: PACT_LOG_LEVEL,
});

const JSON_CONTENT_TYPE = regex('application/json.*', 'application/json');
const BEARER_AUTH = regex('Bearer .+', 'Bearer test-token');

describe('Users API — consumer contract', () => {
  it('GET /v1/users/:id → 200 with user object', () =>
    provider
      .given('user with id 1 exists')
      .uponReceiving('a GET request for user 1')
      .withRequest({
        method: 'GET',
        path: '/v1/users/1',
        headers: { Authorization: BEARER_AUTH },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          id: integer(1),
          email: email('alice@example.com'),
          name: string('Alice'),
          role: regex('^(admin|user|moderator)$', 'user'),
          createdAt: iso8601DateTime('2024-01-01T00:00:00.000Z'),
        },
      })
      .executeTest(async (mockServer) => {
        const client = new UsersApiClient(mockServer.url);
        const user = await client.getUser(1);

        expect(user.id).toBeTypeOf('number');
        expect(user.email).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
        expect(['admin', 'user', 'moderator']).toContain(user.role);
        expect(user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      })
  );

  it('GET /v1/users → 200 with paginated list', () =>
    provider
      .given('users exist')
      .uponReceiving('a GET request for user list')
      .withRequest({
        method: 'GET',
        path: '/v1/users',
        headers: { Authorization: BEARER_AUTH },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          data: eachLike({
            id: integer(1),
            email: email('alice@example.com'),
            name: string('Alice'),
            role: regex('^(admin|user|moderator)$', 'user'),
            createdAt: iso8601DateTime('2024-01-01T00:00:00.000Z'),
          }),
          meta: {
            cursor: string('next-cursor-token'),
            hasMore: true,
            total: integer(42),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const client = new UsersApiClient(mockServer.url);
        const response = await client.listUsers();

        expect(Array.isArray(response.data)).toBe(true);
        expect(response.data.length).toBeGreaterThan(0);
        expect(typeof response.meta.hasMore).toBe('boolean');
        expect(typeof response.meta.total).toBe('number');
      })
  );

  it('POST /v1/users → 201 with created user', () =>
    provider
      .given('no user with email bob@example.com exists')
      .uponReceiving('a POST request to create a user')
      .withRequest({
        method: 'POST',
        path: '/v1/users',
        headers: {
          'Content-Type': JSON_CONTENT_TYPE,
          Authorization: BEARER_AUTH,
        },
        body: {
          email: email('bob@example.com'),
          name: string('Bob'),
          password: regex('.{8,}', 'S3cure!Pass'),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: {
          id: integer(2),
          email: email('bob@example.com'),
          name: string('Bob'),
          role: string('user'),
          createdAt: iso8601DateTime('2024-01-02T00:00:00.000Z'),
        },
      })
      .executeTest(async (mockServer) => {
        const client = new UsersApiClient(mockServer.url);
        const user = await client.createUser({
          email: 'bob@example.com',
          name: 'Bob',
          password: 'S3cure!Pass',
        });

        expect(user.id).toBeTypeOf('number');
        expect(user.email).toBe('bob@example.com');
        expect(user.name).toBe('Bob');
        expect(user.role).toBe('user');
      })
  );

  it('DELETE /v1/users/:id → 204 no content', () =>
    provider
      .given('user with id 1 exists')
      .uponReceiving('a DELETE request for user 1')
      .withRequest({
        method: 'DELETE',
        path: '/v1/users/1',
        headers: { Authorization: BEARER_AUTH },
      })
      .willRespondWith({ status: 204 })
      .executeTest(async (mockServer) => {
        const client = new UsersApiClient(mockServer.url);
        await expect(client.deleteUser(1)).resolves.toBeUndefined();
      })
  );
});
