import { http, HttpResponse } from 'msw'
import { db } from '../db'

// Seed passwords keyed by email — intentionally weak, test-only
const SEED_PASSWORDS: Record<string, string> = {
  'admin@example.com': 'password',
  'alice@example.com': 'password',
  'bob@example.com': 'password',
}

let tokenCounter = 0
function generateToken(prefix: string): string {
  tokenCounter += 1
  return `${prefix}-test-${tokenCounter}`
}

interface LoginBody {
  email?: string
  password?: string
}

interface RefreshBody {
  refreshToken?: string
}

export const authHandlers = [
  // POST /api/auth/login
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as LoginBody
    const { email, password } = body

    if (!email || !password) {
      return HttpResponse.json(
        { message: 'Email and password are required' },
        { status: 400 },
      )
    }

    const user = db.users.getByEmail(email)
    const storedPassword: string | undefined = SEED_PASSWORDS[email]
    if (!user || storedPassword !== password) {
      return HttpResponse.json(
        { message: 'Invalid credentials' },
        { status: 401 },
      )
    }

    const accessToken = generateToken('access')
    const refreshToken = generateToken('refresh')
    db.sessions.create({
      userId: user.id,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 15 * 60 * 1000,
    })

    return HttpResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      accessToken,
      refreshToken,
    })
  }),

  // POST /api/auth/logout
  http.post('/api/auth/logout', ({ request }) => {
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (token) db.sessions.delete(token)
    return HttpResponse.json({ message: 'Logged out' })
  }),

  // POST /api/auth/refresh
  http.post('/api/auth/refresh', async ({ request }) => {
    const body = (await request.json()) as RefreshBody
    const { refreshToken } = body

    if (!refreshToken) {
      return HttpResponse.json(
        { message: 'Refresh token required' },
        { status: 400 },
      )
    }

    const session = db.sessions.getByRefreshToken(refreshToken)
    if (!session) {
      return HttpResponse.json(
        { message: 'Invalid refresh token' },
        { status: 401 },
      )
    }

    // Rotate tokens
    db.sessions.delete(session.accessToken)
    const newAccessToken = generateToken('access')
    const newRefreshToken = generateToken('refresh')
    db.sessions.create({
      userId: session.userId,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: Date.now() + 15 * 60 * 1000,
    })

    return HttpResponse.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    })
  }),

  // GET /api/auth/me
  http.get('/api/auth/me', ({ request }) => {
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const session = db.sessions.getByAccessToken(token)
    if (!session) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const user = db.users.getById(session.userId)
    if (!user) {
      return HttpResponse.json({ message: 'User not found' }, { status: 404 })
    }

    return HttpResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    })
  }),
]
