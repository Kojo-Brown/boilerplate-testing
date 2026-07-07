import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './server'
import { db } from './db'
import { paginateItems, parsePaginationParams } from './handlers/pagination'

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  db.reset()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'http://localhost'

async function loginAs(
  email = 'admin@example.com',
  password = 'password',
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return res.json() as Promise<{ accessToken: string; refreshToken: string }>
}

// ---------------------------------------------------------------------------
// Auth handlers
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('returns 200 with tokens on valid credentials', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      user: { email: string; role: string }
      accessToken: string
      refreshToken: string
    }
    expect(data.user.email).toBe('admin@example.com')
    expect(data.user.role).toBe('admin')
    expect(typeof data.accessToken).toBe('string')
    expect(typeof data.refreshToken).toBe('string')
  })

  it('returns 401 on wrong password', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 on unknown email', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'password' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when body is missing required fields', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/logout', () => {
  it('returns 200 and invalidates the session', async () => {
    const { accessToken } = await loginAs()

    const meBeforeRes = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(meBeforeRes.status).toBe(200)

    const logoutRes = await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(logoutRes.status).toBe(200)

    const meAfterRes = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(meAfterRes.status).toBe(401)
  })
})

describe('POST /api/auth/refresh', () => {
  it('returns new tokens when refresh token is valid', async () => {
    const { accessToken: oldAccess, refreshToken } = await loginAs()

    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      accessToken: string
      refreshToken: string
    }
    expect(typeof data.accessToken).toBe('string')
    expect(typeof data.refreshToken).toBe('string')
    // Old access token should be rotated out
    expect(data.accessToken).not.toBe(oldAccess)
  })

  it('returns 401 on invalid refresh token', async () => {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'bogus' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when refresh token is missing', async () => {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/auth/me', () => {
  it('returns the current user when token is valid', async () => {
    const { accessToken } = await loginAs('alice@example.com')

    const res = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { email: string; role: string }
    expect(data.email).toBe('alice@example.com')
    expect(data.role).toBe('user')
  })

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await fetch(`${BASE}/api/auth/me`)
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token is invalid', async () => {
    const res = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid-token' },
    })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Users handlers
// ---------------------------------------------------------------------------

describe('GET /api/users', () => {
  it('returns a paginated list of users', async () => {
    const res = await fetch(`${BASE}/api/users`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      data: unknown[]
      meta: { total: number; page: number; limit: number }
    }
    expect(Array.isArray(data.data)).toBe(true)
    expect(data.meta.total).toBe(3)
    expect(data.meta.page).toBe(1)
    expect(data.meta.limit).toBe(10)
  })

  it('respects page and limit query params', async () => {
    const res = await fetch(`${BASE}/api/users?page=2&limit=1`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      data: unknown[]
      meta: { page: number; limit: number; hasNextPage: boolean; hasPrevPage: boolean }
    }
    expect(data.data).toHaveLength(1)
    expect(data.meta.page).toBe(2)
    expect(data.meta.limit).toBe(1)
    expect(data.meta.hasPrevPage).toBe(true)
    expect(data.meta.hasNextPage).toBe(true)
  })
})

describe('GET /api/users/:id', () => {
  it('returns a user by id', async () => {
    const res = await fetch(`${BASE}/api/users/user-1`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { id: string; email: string }
    expect(data.id).toBe('user-1')
    expect(data.email).toBe('admin@example.com')
  })

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${BASE}/api/users/does-not-exist`)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/users', () => {
  it('creates a new user', async () => {
    const res = await fetch(`${BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', name: 'New User' }),
    })
    expect(res.status).toBe(201)
    const data = (await res.json()) as {
      id: string
      email: string
      name: string
      role: string
    }
    expect(data.email).toBe('new@example.com')
    expect(data.name).toBe('New User')
    expect(data.role).toBe('user')
    expect(typeof data.id).toBe('string')
  })

  it('returns 409 when email is already taken', async () => {
    const res = await fetch(`${BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Duplicate' }),
    })
    expect(res.status).toBe(409)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await fetch(`${BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'only-email@example.com' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/users/:id', () => {
  it('updates a user', async () => {
    const res = await fetch(`${BASE}/api/users/user-2`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Updated' }),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { name: string }
    expect(data.name).toBe('Alice Updated')
  })

  it('returns 404 for unknown user', async () => {
    const res = await fetch(`${BASE}/api/users/ghost`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/users/:id', () => {
  it('deletes a user and returns 204', async () => {
    const res = await fetch(`${BASE}/api/users/user-3`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const getRes = await fetch(`${BASE}/api/users/user-3`)
    expect(getRes.status).toBe(404)
  })

  it('returns 404 for unknown user', async () => {
    const res = await fetch(`${BASE}/api/users/ghost`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Pagination utilities
// ---------------------------------------------------------------------------

describe('paginateItems', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }))

  it('returns the first page with correct meta', () => {
    const result = paginateItems(items, 1, 10)
    expect(result.data).toHaveLength(10)
    expect(result.meta.page).toBe(1)
    expect(result.meta.total).toBe(25)
    expect(result.meta.totalPages).toBe(3)
    expect(result.meta.hasNextPage).toBe(true)
    expect(result.meta.hasPrevPage).toBe(false)
  })

  it('returns the last page with correct meta', () => {
    const result = paginateItems(items, 3, 10)
    expect(result.data).toHaveLength(5)
    expect(result.meta.hasNextPage).toBe(false)
    expect(result.meta.hasPrevPage).toBe(true)
  })

  it('handles an empty array gracefully', () => {
    const result = paginateItems([], 1, 10)
    expect(result.data).toHaveLength(0)
    expect(result.meta.total).toBe(0)
    expect(result.meta.totalPages).toBe(1)
    expect(result.meta.hasNextPage).toBe(false)
    expect(result.meta.hasPrevPage).toBe(false)
  })
})

describe('parsePaginationParams', () => {
  const makeUrl = (qs: string) => new URL(`http://localhost/api/items${qs}`)

  it('returns defaults when no params are present', () => {
    const { page, limit } = parsePaginationParams(makeUrl(''))
    expect(page).toBe(1)
    expect(limit).toBe(10)
  })

  it('parses page and limit from query string', () => {
    const { page, limit } = parsePaginationParams(makeUrl('?page=3&limit=20'))
    expect(page).toBe(3)
    expect(limit).toBe(20)
  })

  it('clamps page to a minimum of 1', () => {
    const { page } = parsePaginationParams(makeUrl('?page=-5'))
    expect(page).toBe(1)
  })

  it('clamps limit to a maximum of 100', () => {
    const { limit } = parsePaginationParams(makeUrl('?limit=9999'))
    expect(limit).toBe(100)
  })
})
