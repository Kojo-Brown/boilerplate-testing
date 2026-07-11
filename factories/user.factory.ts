import { defineFactory } from './defineFactory'
import type { UserInput, User } from './types'

/**
 * Factory for the `User` model.
 *
 * In a real project wire this to the generated Prisma types:
 *   import type { User, Prisma } from '@prisma/client'
 *   defineFactory<Prisma.UserCreateInput, User>(...)
 *
 * Quick usage:
 *   UserFactory.build()                        // plain object, no DB
 *   UserFactory.build({ role: 'admin' })       // with overrides
 *   UserFactory.buildList(5)                   // 5 plain objects
 *   await UserFactory.create(prisma.user)      // saved to DB
 */
export const UserFactory = defineFactory<UserInput, User>({
  email: (f) => f.internet.email(),
  name: (f) => f.person.fullName(),
  passwordHash: (f) => f.string.alphanumeric(60),
  role: () => 'user',
})
