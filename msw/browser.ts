// Browser MSW worker for Storybook, component tests, and dev-mode mocking.
// Call worker.start() once in your app/test entry point:
//
//   import { worker } from '@/msw/browser'
//   if (process.env.NODE_ENV === 'development') {
//     await worker.start({ onUnhandledRequest: 'warn' })
//   }

import { setupWorker } from 'msw/browser'
import { authHandlers } from './handlers/auth'
import { usersHandlers } from './handlers/users'

export const worker = setupWorker(...authHandlers, ...usersHandlers)
