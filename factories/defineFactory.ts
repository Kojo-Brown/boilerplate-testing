/**
 * defineFactory — typed seed-factory builder for Prisma + @faker-js/faker.
 *
 * Each factory has four methods:
 *   build(overrides?)              → plain object, no DB
 *   buildList(n, overrides?)       → array of plain objects
 *   create(delegate, overrides?)   → persists via prisma.<Model>.create
 *   createList(n, delegate, overrides?) → persists N records concurrently
 *
 * Usage:
 *   const UserFactory = defineFactory<UserInput, User>({
 *     email:        (f) => f.internet.email(),
 *     name:         (f) => f.person.fullName(),
 *     passwordHash: (f) => f.string.alphanumeric(60),
 *     role:         ()  => 'user',
 *   })
 *
 *   const data  = UserFactory.build({ role: 'admin' })
 *   const saved = await UserFactory.create(prisma.user, { role: 'admin' })
 */

import { faker as globalFaker, type Faker } from '@faker-js/faker'

// ---------------------------------------------------------------------------
// Schema type — every field is a function that receives the Faker instance.
// ---------------------------------------------------------------------------

export type FactorySchema<T extends object> = {
  readonly [K in keyof T]: (faker: Faker) => T[K]
}

// ---------------------------------------------------------------------------
// Prisma-compatible delegate (the shape of `prisma.<model>`).
// ---------------------------------------------------------------------------

export type CreateDelegate<TInput extends object, TOutput extends TInput> = {
  create(args: { data: TInput }): Promise<TOutput>
}

// ---------------------------------------------------------------------------
// Public factory interface
// ---------------------------------------------------------------------------

export interface FactoryInstance<TInput extends object, TOutput extends TInput = TInput & { id: string }> {
  /**
   * Build one plain object without hitting the database.
   * `overrides` are merged on top of the schema defaults.
   */
  build(overrides?: Partial<TInput>): TInput

  /**
   * Build `count` independent plain objects.
   * Each call to a schema function produces a fresh value, so IDs and other
   * unique fields are regenerated per item.
   */
  buildList(count: number, overrides?: Partial<TInput>): TInput[]

  /**
   * Build one object and persist it via `delegate.create`.
   * `delegate` is typically `prisma.<ModelName>` (e.g. `prisma.user`).
   */
  create(
    delegate: CreateDelegate<TInput, TOutput>,
    overrides?: Partial<TInput>,
  ): Promise<TOutput>

  /**
   * Persist `count` records concurrently.
   * All records share `overrides` but each gets independent faker values.
   */
  createList(
    count: number,
    delegate: CreateDelegate<TInput, TOutput>,
    overrides?: Partial<TInput>,
  ): Promise<TOutput[]>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function buildFromSchema<T extends object>(
  schema: FactorySchema<T>,
  faker: Faker,
  overrides?: Partial<T>,
): T {
  const base = Object.fromEntries(
    (Object.keys(schema) as Array<keyof T>).map((key) => [key, schema[key](faker)]),
  ) as T
  return overrides ? { ...base, ...overrides } : base
}

/**
 * Create a typed factory for `TInput` (the Prisma create-data shape) that
 * returns `TOutput` (the full model including generated fields like `id`).
 *
 * @param schema  Record mapping field names to `(faker) => value` functions.
 * @param faker   Optional Faker instance (defaults to the global singleton).
 *                Pass a seeded instance to make tests deterministic.
 */
export function defineFactory<
  TInput extends object,
  TOutput extends TInput = TInput & { id: string },
>(schema: FactorySchema<TInput>, faker: Faker = globalFaker): FactoryInstance<TInput, TOutput> {
  return {
    build: (overrides) => buildFromSchema(schema, faker, overrides),

    buildList: (count, overrides) =>
      Array.from({ length: count }, () => buildFromSchema(schema, faker, overrides)),

    create: (delegate, overrides) =>
      delegate.create({ data: buildFromSchema(schema, faker, overrides) }),

    createList: (count, delegate, overrides) =>
      Promise.all(
        Array.from({ length: count }, () =>
          delegate.create({ data: buildFromSchema(schema, faker, overrides) }),
        ),
      ),
  }
}
