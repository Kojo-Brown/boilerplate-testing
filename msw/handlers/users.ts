import { http, HttpResponse } from 'msw'
import { db } from '../db'
import type { User } from '../db'
import { paginateItems, parsePaginationParams } from './pagination'

interface CreateUserBody {
  email?: string
  name?: string
  role?: 'admin' | 'user'
}

type UpdateUserBody = Partial<Pick<User, 'email' | 'name' | 'role'>>

export const usersHandlers = [
  // GET /api/users?page=1&limit=10
  http.get('/api/users', ({ request }) => {
    const url = new URL(request.url)
    const { page, limit } = parsePaginationParams(url)
    const users = db.users.getAll()
    return HttpResponse.json(paginateItems(users, page, limit))
  }),

  // GET /api/users/:id
  http.get('/api/users/:id', ({ params }) => {
    const user = db.users.getById(params['id'] as string)
    if (!user) {
      return HttpResponse.json({ message: 'User not found' }, { status: 404 })
    }
    return HttpResponse.json(user)
  }),

  // POST /api/users
  http.post('/api/users', async ({ request }) => {
    const body = (await request.json()) as CreateUserBody
    const { email, name, role = 'user' } = body

    if (!email || !name) {
      return HttpResponse.json(
        { message: 'Email and name are required' },
        { status: 400 },
      )
    }

    if (db.users.getByEmail(email)) {
      return HttpResponse.json(
        { message: 'Email already in use' },
        { status: 409 },
      )
    }

    const user = db.users.create({ email, name, role })
    return HttpResponse.json(user, { status: 201 })
  }),

  // PATCH /api/users/:id
  http.patch('/api/users/:id', async ({ request, params }) => {
    const body = (await request.json()) as UpdateUserBody
    const user = db.users.update(params['id'] as string, body)
    if (!user) {
      return HttpResponse.json({ message: 'User not found' }, { status: 404 })
    }
    return HttpResponse.json(user)
  }),

  // DELETE /api/users/:id
  http.delete('/api/users/:id', ({ params }) => {
    const deleted = db.users.delete(params['id'] as string)
    if (!deleted) {
      return HttpResponse.json({ message: 'User not found' }, { status: 404 })
    }
    return new HttpResponse(null, { status: 204 })
  }),
]
