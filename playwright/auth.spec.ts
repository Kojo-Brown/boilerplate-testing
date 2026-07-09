/**
 * Auth fixture demo — pre-authenticated `page` via test.extend.
 *
 * Prerequisites:
 *   1. App running at PLAYWRIGHT_BASE_URL (default: http://localhost:5173).
 *   2. Auth storage generated: pnpm test:e2e --project=setup
 *
 * Then run these tests:
 *   pnpm test:e2e --project=chromium playwright/auth.spec.ts
 *
 * Without storage state the fixture falls back to a live login API call —
 * tests still pass as long as /api/auth/login is reachable.
 */
import { test, expect, AUTH_CREDENTIALS } from './fixtures'

// ---------------------------------------------------------------------------
// authenticatedPage with default role ('user')
// ---------------------------------------------------------------------------
test.describe('authenticatedPage — default role (user)', () => {
  test('has access token in localStorage', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/')
    const token = await authenticatedPage.evaluate(() =>
      localStorage.getItem('auth.accessToken'),
    )
    expect(token).not.toBeNull()
  })

  test('stores user profile with role=user', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/')
    const raw = await authenticatedPage.evaluate(() =>
      localStorage.getItem('auth.user'),
    )
    expect(raw).not.toBeNull()
    const user = JSON.parse(raw!) as { email: string; role: string }
    expect(user.email).toBe(AUTH_CREDENTIALS.user.email)
    expect(user.role).toBe('user')
  })
})

// ---------------------------------------------------------------------------
// authenticatedPage with role overridden to 'admin' via test.use()
// ---------------------------------------------------------------------------
test.describe('authenticatedPage — admin role via test.use()', () => {
  test.use({ role: 'admin' })

  test('stores user profile with role=admin', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/')
    const raw = await authenticatedPage.evaluate(() =>
      localStorage.getItem('auth.user'),
    )
    expect(raw).not.toBeNull()
    const user = JSON.parse(raw!) as { email: string; role: string }
    expect(user.email).toBe(AUTH_CREDENTIALS.admin.email)
    expect(user.role).toBe('admin')
  })

  test('has a distinct access token from user role', async ({
    authenticatedPage,
    browser,
    baseURL,
  }) => {
    // Spin up a second context as 'user' for comparison.
    const userCtx = await browser.newContext()
    const userRes = await userCtx.request.post(
      `${baseURL ?? 'http://localhost:5173'}/api/auth/login`,
      { data: AUTH_CREDENTIALS.user },
    )
    const { accessToken: userToken } = (await userRes.json()) as {
      accessToken: string
    }
    await userCtx.close()

    await authenticatedPage.goto('/')
    const adminToken = await authenticatedPage.evaluate(() =>
      localStorage.getItem('auth.accessToken'),
    )
    expect(adminToken).not.toBeNull()
    expect(adminToken).not.toBe(userToken)
  })
})

// ---------------------------------------------------------------------------
// Convenience fixtures: adminPage and userPage
// ---------------------------------------------------------------------------
test.describe('Convenience fixtures — adminPage and userPage', () => {
  test('adminPage is pre-authenticated as admin', async ({ adminPage }) => {
    await adminPage.goto('/')
    const raw = await adminPage.evaluate(() =>
      localStorage.getItem('auth.user'),
    )
    expect(raw).not.toBeNull()
    const user = JSON.parse(raw!) as { role: string }
    expect(user.role).toBe('admin')
  })

  test('userPage is pre-authenticated as user', async ({ userPage }) => {
    await userPage.goto('/')
    const raw = await userPage.evaluate(() =>
      localStorage.getItem('auth.user'),
    )
    expect(raw).not.toBeNull()
    const user = JSON.parse(raw!) as { role: string }
    expect(user.role).toBe('user')
  })

  test('adminPage and userPage have independent, isolated contexts', async ({
    adminPage,
    userPage,
  }) => {
    await Promise.all([adminPage.goto('/'), userPage.goto('/')])

    const [adminRaw, userRaw] = await Promise.all([
      adminPage.evaluate(() => localStorage.getItem('auth.user')),
      userPage.evaluate(() => localStorage.getItem('auth.user')),
    ])

    const adminUser = JSON.parse(adminRaw!) as { id: string; role: string }
    const userUser = JSON.parse(userRaw!) as { id: string; role: string }

    expect(adminUser.role).toBe('admin')
    expect(userUser.role).toBe('user')
    expect(adminUser.id).not.toBe(userUser.id)
  })
})

// ---------------------------------------------------------------------------
// Authenticated API calls using the token from localStorage
// ---------------------------------------------------------------------------
test.describe('Authenticated API requests', () => {
  test.use({ role: 'user' })

  test('GET /api/auth/me returns the authenticated user', async ({
    authenticatedPage,
    baseURL,
  }) => {
    await authenticatedPage.goto('/')
    const token = await authenticatedPage.evaluate(() =>
      localStorage.getItem('auth.accessToken'),
    )
    expect(token).not.toBeNull()

    const res = await authenticatedPage.request.get(
      `${baseURL ?? 'http://localhost:5173'}/api/auth/me`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(res.ok()).toBeTruthy()

    const me = (await res.json()) as { email: string; role: string }
    expect(me.email).toBe(AUTH_CREDENTIALS.user.email)
    expect(me.role).toBe('user')
  })
})
