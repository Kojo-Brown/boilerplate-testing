/**
 * Auth state setup — run once before authenticated E2E tests.
 *
 * Usage:
 *   pnpm test:e2e --project=setup
 *
 * This writes .auth/admin.json and .auth/user.json so the auth fixtures can
 * restore sessions without hitting the login API on every test run.
 * Both files are gitignored.
 */
import { test as setup, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { AUTH_DIR, AUTH_STORAGE_PATHS, AUTH_CREDENTIALS, type AuthUser } from '../fixtures/auth'

const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:5173'

interface LoginResponse {
  user: AuthUser
  accessToken: string
  refreshToken: string
}

async function authenticate(
  role: keyof typeof AUTH_CREDENTIALS,
  { page }: { page: import('@playwright/test').Page },
): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true })

  // Use the page's API context for an HTTP-only login — no UI rendering needed.
  const res = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: AUTH_CREDENTIALS[role],
  })
  expect(res.ok()).toBeTruthy()

  const { accessToken, refreshToken, user } = (await res.json()) as LoginResponse

  // Navigate to the origin so we can write to localStorage.
  await page.goto(BASE_URL, { waitUntil: 'commit' })
  await page.evaluate(
    (auth: LoginResponse) => {
      localStorage.setItem('auth.accessToken', auth.accessToken)
      localStorage.setItem('auth.refreshToken', auth.refreshToken)
      localStorage.setItem('auth.user', JSON.stringify(auth.user))
    },
    { accessToken, refreshToken, user },
  )

  // Persist cookies + localStorage so subsequent tests can restore this session.
  await page.context().storageState({ path: AUTH_STORAGE_PATHS[role] })
}

setup('authenticate as admin', async ({ page }) => {
  await authenticate('admin', { page })
})

setup('authenticate as user', async ({ page }) => {
  await authenticate('user', { page })
})
