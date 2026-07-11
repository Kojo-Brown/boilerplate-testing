// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { faker as realFaker } from '@faker-js/faker'
import { defineFactory } from './defineFactory'
import type { CreateDelegate } from './defineFactory'
import { UserFactory } from './user.factory'
import { PostFactory } from './post.factory'
import type { User, UserInput, Post, PostInput } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Prisma delegate that records calls and returns the input. */
function mockDelegate<TInput extends object, TOutput extends TInput>(
  idFn: (data: TInput) => TOutput,
): CreateDelegate<TInput, TOutput> & { calls: TInput[] } {
  const calls: TInput[] = []
  return {
    calls,
    create: vi.fn(async ({ data }: { data: TInput }) => {
      calls.push(data)
      return idFn(data)
    }),
  }
}

function makeUserDelegate() {
  return mockDelegate<UserInput, User>((data) => ({
    ...data,
    id: realFaker.string.uuid(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
}

function makePostDelegate() {
  return mockDelegate<PostInput, Post>((data) => ({
    ...data,
    id: realFaker.string.uuid(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
}

// ---------------------------------------------------------------------------
// defineFactory — core behaviour
// ---------------------------------------------------------------------------

describe('defineFactory', () => {
  interface WidgetInput {
    label: string
    count: number
    active: boolean
  }
  interface Widget extends WidgetInput {
    id: string
  }

  const WidgetFactory = defineFactory<WidgetInput, Widget>({
    label: (f) => f.commerce.productName(),
    count: (f) => f.number.int({ min: 1, max: 100 }),
    active: () => true,
  })

  describe('build()', () => {
    it('returns an object with all schema fields', () => {
      const w = WidgetFactory.build()
      expect(w).toHaveProperty('label')
      expect(w).toHaveProperty('count')
      expect(w).toHaveProperty('active', true)
      expect(typeof w.label).toBe('string')
      expect(typeof w.count).toBe('number')
    })

    it('applies overrides on top of defaults', () => {
      const w = WidgetFactory.build({ active: false, count: 999 })
      expect(w.active).toBe(false)
      expect(w.count).toBe(999)
      expect(typeof w.label).toBe('string')
    })

    it('produces unique values across calls', () => {
      const a = WidgetFactory.build()
      const b = WidgetFactory.build()
      // At least one field should differ across calls (probabilistically).
      // We check label since it comes from a large faker word space.
      const countAttempts = Array.from({ length: 10 }, () => WidgetFactory.build())
      const labels = new Set(countAttempts.map((w) => w.label))
      expect(labels.size).toBeGreaterThan(1)
    })

    it('does not include extra fields from the schema', () => {
      const w = WidgetFactory.build()
      const keys = Object.keys(w)
      expect(keys).toEqual(expect.arrayContaining(['label', 'count', 'active']))
      expect(keys).not.toContain('id')
    })
  })

  describe('buildList()', () => {
    it('returns an array of the requested length', () => {
      expect(WidgetFactory.buildList(5)).toHaveLength(5)
    })

    it('returns an empty array for count 0', () => {
      expect(WidgetFactory.buildList(0)).toHaveLength(0)
    })

    it('applies overrides to every item', () => {
      const list = WidgetFactory.buildList(3, { active: false })
      expect(list.every((w) => w.active === false)).toBe(true)
    })

    it('generates independent faker values per item', () => {
      const list = WidgetFactory.buildList(20)
      const labels = new Set(list.map((w) => w.label))
      expect(labels.size).toBeGreaterThan(1)
    })
  })

  describe('create()', () => {
    it('calls delegate.create with the built data', async () => {
      const delegate = mockDelegate<WidgetInput, Widget>((d) => ({ ...d, id: 'w-1' }))
      await WidgetFactory.create(delegate)
      expect(delegate.create).toHaveBeenCalledOnce()
      const [callArg] = (delegate.create as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { data: WidgetInput },
      ]
      expect(callArg.data).toHaveProperty('label')
      expect(callArg.data).toHaveProperty('count')
    })

    it('returns the value from the delegate', async () => {
      const delegate = mockDelegate<WidgetInput, Widget>((d) => ({ ...d, id: 'w-42' }))
      const result = await WidgetFactory.create(delegate)
      expect(result.id).toBe('w-42')
      expect(result.active).toBe(true)
    })

    it('passes overrides through to the delegate', async () => {
      const delegate = mockDelegate<WidgetInput, Widget>((d) => ({ ...d, id: 'w-x' }))
      await WidgetFactory.create(delegate, { count: 777 })
      const [callArg] = (delegate.create as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { data: WidgetInput },
      ]
      expect(callArg.data.count).toBe(777)
    })
  })

  describe('createList()', () => {
    it('calls delegate.create count times', async () => {
      const delegate = mockDelegate<WidgetInput, Widget>((d) => ({ ...d, id: 'w-1' }))
      await WidgetFactory.createList(4, delegate)
      expect(delegate.create).toHaveBeenCalledTimes(4)
    })

    it('returns an array of the requested length', async () => {
      const delegate = mockDelegate<WidgetInput, Widget>((d) => ({ ...d, id: 'w-1' }))
      const results = await WidgetFactory.createList(3, delegate)
      expect(results).toHaveLength(3)
    })

    it('applies overrides to every created record', async () => {
      const delegate = mockDelegate<WidgetInput, Widget>((d) => ({ ...d, id: 'w-1' }))
      await WidgetFactory.createList(3, delegate, { active: false })
      for (const call of (delegate.create as ReturnType<typeof vi.fn>).mock.calls as Array<[{ data: WidgetInput }]>) {
        expect(call[0].data.active).toBe(false)
      }
    })
  })

  describe('deterministic faker (seeded)', () => {
    it('produces the same output for the same seed', async () => {
      const { faker: seededFaker } = await import('@faker-js/faker')

      const makeFactory = () =>
        defineFactory<WidgetInput, Widget>(
          {
            label: (f) => f.commerce.productName(),
            count: (f) => f.number.int({ min: 1, max: 100 }),
            active: () => true,
          },
          seededFaker,
        )

      seededFaker.seed(42)
      const result1 = makeFactory().build()

      seededFaker.seed(42)
      const result2 = makeFactory().build()

      expect(result1.label).toBe(result2.label)
      expect(result1.count).toBe(result2.count)
    })
  })
})

// ---------------------------------------------------------------------------
// UserFactory
// ---------------------------------------------------------------------------

describe('UserFactory', () => {
  it('build() produces a valid user input shape', () => {
    const u = UserFactory.build()
    expect(u.email).toMatch(/@/)
    expect(typeof u.name).toBe('string')
    expect(u.name.length).toBeGreaterThan(0)
    expect(u.passwordHash).toHaveLength(60)
    expect(u.role).toBe('user')
  })

  it('build() accepts role override', () => {
    const u = UserFactory.build({ role: 'admin' })
    expect(u.role).toBe('admin')
  })

  it('buildList(3) returns 3 users with distinct emails', () => {
    const users = UserFactory.buildList(3)
    expect(users).toHaveLength(3)
    const emails = new Set(users.map((u) => u.email))
    expect(emails.size).toBe(3)
  })

  it('create() persists via delegate and returns the output record', async () => {
    const delegate = makeUserDelegate()
    const user = await UserFactory.create(delegate)
    expect(delegate.calls).toHaveLength(1)
    expect(user.id).toBeDefined()
    expect(user.createdAt).toBeInstanceOf(Date)
    expect(user.email).toMatch(/@/)
  })

  it('createList(3) inserts 3 distinct users', async () => {
    const delegate = makeUserDelegate()
    const users = await UserFactory.createList(3, delegate)
    expect(users).toHaveLength(3)
    const emails = new Set(delegate.calls.map((c) => c.email))
    expect(emails.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// PostFactory
// ---------------------------------------------------------------------------

describe('PostFactory', () => {
  it('build() produces a valid post input shape', () => {
    const p = PostFactory.build()
    expect(typeof p.title).toBe('string')
    expect(p.title.length).toBeGreaterThan(0)
    expect(typeof p.body).toBe('string')
    expect(typeof p.published).toBe('boolean')
    expect(p.authorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('build() accepts authorId override', () => {
    const authorId = '00000000-0000-0000-0000-000000000001'
    const p = PostFactory.build({ authorId })
    expect(p.authorId).toBe(authorId)
  })

  it('create() wires authorId when creating alongside a user', async () => {
    const userDelegate = makeUserDelegate()
    const postDelegate = makePostDelegate()

    const user = await UserFactory.create(userDelegate)
    const post = await PostFactory.create(postDelegate, { authorId: user.id })

    expect(post.authorId).toBe(user.id)
    expect(post.id).toBeDefined()
    expect(post.createdAt).toBeInstanceOf(Date)
  })

  it('buildList(5) returns 5 posts', () => {
    expect(PostFactory.buildList(5)).toHaveLength(5)
  })
})
