// Node.js MSW server for Vitest and other server-side test environments.
// Import and wire up in your test setup file:
//
//   import { server } from '@/msw/server'
//   beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
//   afterAll(() => server.close())
//   afterEach(() => server.resetHandlers())

import { setupServer } from 'msw/node'
import { authHandlers } from './handlers/auth'
import { usersHandlers } from './handlers/users'

export const server = setupServer(...authHandlers, ...usersHandlers)
