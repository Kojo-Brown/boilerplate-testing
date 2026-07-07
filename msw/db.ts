// In-memory database for MSW handlers — reset between tests with db.reset()

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  createdAt: string
}

export interface Session {
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

const seedUsers: User[] = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin',
    createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'user-2',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'user',
    createdAt: new Date('2024-02-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'user-3',
    email: 'bob@example.com',
    name: 'Bob',
    role: 'user',
    createdAt: new Date('2024-03-01T00:00:00.000Z').toISOString(),
  },
]

let userStore = new Map<string, User>(
  seedUsers.map((u): [string, User] => [u.id, u]),
)
let sessionStore = new Map<string, Session>()
let nextId = seedUsers.length + 1

export const db = {
  users: {
    getAll: (): User[] => Array.from(userStore.values()),

    getById: (id: string): User | undefined => userStore.get(id),

    getByEmail: (email: string): User | undefined =>
      Array.from(userStore.values()).find((u) => u.email === email),

    create: (data: Omit<User, 'id' | 'createdAt'>): User => {
      const user: User = {
        ...data,
        id: `user-${nextId++}`,
        createdAt: new Date().toISOString(),
      }
      userStore.set(user.id, user)
      return user
    },

    update: (id: string, data: Partial<Omit<User, 'id'>>): User | undefined => {
      const user = userStore.get(id)
      if (!user) return undefined
      const updated: User = { ...user, ...data }
      userStore.set(id, updated)
      return updated
    },

    delete: (id: string): boolean => userStore.delete(id),
  },

  sessions: {
    create: (session: Session): Session => {
      sessionStore.set(session.accessToken, session)
      return session
    },

    getByAccessToken: (token: string): Session | undefined =>
      sessionStore.get(token),

    getByRefreshToken: (token: string): Session | undefined =>
      Array.from(sessionStore.values()).find((s) => s.refreshToken === token),

    delete: (accessToken: string): boolean => sessionStore.delete(accessToken),
  },

  reset: (): void => {
    userStore = new Map<string, User>(
      seedUsers.map((u): [string, User] => [u.id, u]),
    )
    sessionStore = new Map<string, Session>()
    nextId = seedUsers.length + 1
  },
}
