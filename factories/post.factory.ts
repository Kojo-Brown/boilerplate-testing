import { defineFactory } from './defineFactory'
import type { PostInput, Post } from './types'

/**
 * Factory for the `Post` model.
 *
 * `authorId` defaults to a random UUID. In tests that need a real FK,
 * override it with the ID of a previously created User:
 *
 *   const user = await UserFactory.create(prisma.user)
 *   const post = await PostFactory.create(prisma.post, { authorId: user.id })
 */
export const PostFactory = defineFactory<PostInput, Post>({
  title: (f) => f.lorem.sentence({ min: 3, max: 8 }),
  body: (f) => f.lorem.paragraphs({ min: 1, max: 3 }),
  published: (f) => f.datatype.boolean(),
  authorId: (f) => f.string.uuid(),
})
