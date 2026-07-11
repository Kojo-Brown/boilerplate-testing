/**
 * Minimal model types that mirror common Prisma schema shapes.
 * Replace with your own `@prisma/client` generated types in a real project:
 *
 *   import type { User, Post } from '@prisma/client'
 *   import type { Prisma } from '@prisma/client'
 *   type UserInput = Prisma.UserCreateInput
 */

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export type UserRole = 'user' | 'admin'

/** Shape passed to `prisma.user.create({ data: … })`. */
export interface UserInput {
  email: string
  name: string
  passwordHash: string
  role: UserRole
}

/** Full model returned from Prisma queries. */
export interface User extends UserInput {
  id: string
  createdAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Post
// ---------------------------------------------------------------------------

/** Shape passed to `prisma.post.create({ data: … })`. */
export interface PostInput {
  title: string
  body: string
  published: boolean
  authorId: string
}

/** Full model returned from Prisma queries. */
export interface Post extends PostInput {
  id: string
  createdAt: Date
  updatedAt: Date
}
