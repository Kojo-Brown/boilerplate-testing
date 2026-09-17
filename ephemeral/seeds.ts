/**
 * Seeded data, and the two places a preview environment can get it from.
 *
 * ---------------------------------------------------------------------------
 * Why this is a dimension and not a detail
 * ---------------------------------------------------------------------------
 * "Seeded data" is the second clause of the spec item and the first thing a
 * team drops. Standing up a database per pull request is slow and standing up
 * *data* per pull request is slower, so the pragmatic move — point every
 * preview at the shared staging database — is nearly universal, and it is
 * where two of the twelve hazards live.
 *
 * The first is obvious once stated and invisible in practice: previews share
 * the dataset, so a preview's own end-to-end run mutates rows another
 * preview's reviewer is looking at. Nothing errors. The reviewer sees a
 * plausible screen with somebody else's data on it and approves or rejects a
 * change on that basis.
 *
 * The second is the one that makes the shared database untenable rather than
 * merely risky: a pull request that contains a migration needs its data at the
 * new schema, and a shared dataset is at whatever schema `main` is at. Either
 * the preview runs the migration — against the database every other preview is
 * using — or the preview is broken. There is no third option, which is the
 * argument for per-environment seeding written as a matrix row rather than as
 * advice.
 *
 * ---------------------------------------------------------------------------
 * The fixture
 * ---------------------------------------------------------------------------
 * Obviously fake, on purpose and by house rule: a seed fixture that looks like
 * production data is a seed fixture somebody eventually copies from
 * production.
 */

/** The schema version `main` is at, and therefore the one a shared dataset is at. */
export const BASE_SCHEMA = 'v1'

/** The seed corpus, as every environment starts with it. */
export const SEED_ROWS: Readonly<Record<string, string>> = {
  'user:1': 'example-user-one@example.invalid',
  'user:2': 'example-user-two@example.invalid',
  'plan:1': 'mock-free-plan',
}

/** A database an environment reads and writes. */
export interface Dataset {
  /** The migration version the rows are at. */
  schema: string
  rows: Record<string, string>
  /**
   * Which pull request wrote each row that is no longer the seed value.
   *
   * Attribution rather than a dirty flag, because the question the probe asks
   * is not "has anything changed" — a preview's own end-to-end run is supposed
   * to change things — but "did anything change that is not mine". Without the
   * writer, a suite that exercises its own environment reads as poisoned.
   */
  writtenBy: Record<string, number>
}

const freshDataset = (schema: string): Dataset => ({
  schema,
  rows: { ...SEED_ROWS },
  writtenBy: {},
})

/** Where an environment's rows come from. */
export const SEED_POLICIES = ['shared', 'per-env'] as const

export type SeedPolicy = (typeof SEED_POLICIES)[number]

/**
 * Every dataset in play, and the routing from an environment to its own.
 *
 * Under `shared` the routing is constant: every pull request resolves to the
 * one dataset, which is created at {@link BASE_SCHEMA} and stays there, because
 * nothing in a preview pipeline is entitled to migrate the database the other
 * previews are on.
 */
export class Seeds {
  readonly #shared: Dataset = freshDataset(BASE_SCHEMA)
  readonly #perEnv = new Map<number, Dataset>()

  /**
   * Give a pull request's environment a dataset, as a deploy would.
   *
   * Under `per-env` this reseeds from the fixture at the schema the deployed
   * commit expects — the migration runs against a database nobody else is
   * using, which is the entire benefit. Under `shared` it is a no-op beyond
   * registering the routing: there is nothing to seed and nothing this
   * environment may migrate.
   */
  provision(pr: number, policy: SeedPolicy, schema: string): void {
    if (policy === 'shared') {
      this.#perEnv.delete(pr)

      return
    }

    this.#perEnv.set(pr, freshDataset(schema))
  }

  /** Forget a pull request's dataset, as a teardown would drop its database. */
  release(pr: number): void {
    this.#perEnv.delete(pr)
  }

  /** The dataset a pull request's environment actually reads. */
  datasetFor(pr: number): Dataset {
    return this.#perEnv.get(pr) ?? this.#shared
  }

  /** A write from inside one environment — an end-to-end run, or a reviewer clicking. */
  write(pr: number, key: string, value: string): void {
    const dataset = this.datasetFor(pr)

    dataset.rows[key] = value
    dataset.writtenBy[key] = pr
  }

  /**
   * The rows a reviewer on this pull request can see that somebody else wrote.
   *
   * The question a probe asks is never "what is in the database" — a preview's
   * own suite is meant to write to it — but "is any of this somebody else's".
   */
  foreignRows(pr: number): readonly string[] {
    const dataset = this.datasetFor(pr)

    return Object.keys(dataset.writtenBy).filter((key) => dataset.writtenBy[key] !== pr)
  }

  /** The schema the rows a pull request reads are actually at. */
  schemaFor(pr: number): string {
    return this.datasetFor(pr).schema
  }
}
