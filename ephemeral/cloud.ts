/**
 * The control plane an ephemeral environment is built in.
 *
 * ---------------------------------------------------------------------------
 * Why there is a fake cloud here at all
 * ---------------------------------------------------------------------------
 * Every account of per-PR environments is written from the deployer's point of
 * view: `terraform apply` on open, `terraform destroy` on close, and the
 * environment is the set of things the deployer created. That framing is what
 * makes teardown look solved, because in it the two sets are the same set by
 * definition.
 *
 * They are not the same set. A cloud grows resources on its own — a log group
 * on the first log line, a DNS record from an ingress controller, a snapshot
 * from a backup policy, an image in a registry from a build step that is not
 * part of the stack. Those resources belong to the environment in every sense
 * that matters (they cost money, they hold data, they keep a name reserved)
 * and they are not in the state file, so a destroy driven by the state file
 * cannot see them. `platform-created-resource` is the row in the matrix where
 * that difference is worth a cell, and it is only expressible because this
 * module distinguishes *what exists* from *what the deployer wrote down*.
 *
 * So: resources live here, the deployer's record lives in `deployer.ts`, and
 * nothing in this module ever consults that record. A teardown can ask this
 * cloud two different questions — "delete these ids" or "delete everything
 * under this parent" — and the matrix is largely a measurement of which
 * question a wiring asks.
 *
 * ---------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------
 * Ids come from a per-cloud counter, never from randomness or a clock, so a
 * failing cell names the same resource on every run. Creation times come from
 * an injected clock (`clock.ts`) for the same reason: the TTL sweep is a real
 * comparison against a real age, and a sweep that consulted `Date.now()` would
 * be a test that passes at 3am for a reason nobody can reproduce.
 */

/**
 * The kinds of thing an environment is made of.
 *
 * `namespace` is the only one with a structural role: it is the parent the
 * other kinds hang off in the wirings that own a namespace, and deleting it
 * cascades. The rest are flavour, and they are named rather than numbered
 * because the matrix's `orphaned` cells are more convincing when the thing
 * left running has a name somebody recognises.
 */
export const RESOURCE_KINDS = [
  'namespace',
  'service',
  'database',
  'dns-record',
  'log-group',
] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** One thing that exists and costs money until somebody deletes it. */
export interface Resource {
  readonly id: string
  readonly kind: ResourceKind
  /** The resource this one is nested inside, or `null` for a root. */
  readonly parent: string | null
  /**
   * Cloud tags. `pr` is on everything an environment creates, including the
   * resources the deployer does not know it created — which is what makes a
   * label query able to find them and a state file not.
   */
  readonly labels: Readonly<Record<string, string>>
  /** The clock reading when it was created, for the TTL sweep to compare against. */
  readonly createdAt: number
}

/** What `create` is given. `id` and `createdAt` are the cloud's to assign. */
export interface ResourceSpec {
  readonly kind: ResourceKind
  readonly parent?: string | null
  readonly labels: Readonly<Record<string, string>>
}

/**
 * An in-memory resource ledger with parent-child cascade.
 *
 * Deliberately smaller than a real provider API: there is no update, no
 * eventual consistency and no partial failure, because none of the twelve
 * hazards turn on any of those. What it does model faithfully is the only two
 * things teardown can be driven by — a list of ids, and a query.
 */
export class Cloud {
  readonly #resources = new Map<string, Resource>()
  readonly #now: () => number
  #sequence = 0

  constructor(now: () => number) {
    this.#now = now
  }

  /** Create a resource and return its id. */
  create(spec: ResourceSpec): string {
    this.#sequence += 1

    const id = `${spec.kind}-${String(this.#sequence)}`
    const parent = spec.parent ?? null

    if (parent !== null && !this.#resources.has(parent)) {
      throw new Error(`cannot create ${id} under ${parent}: no such resource`)
    }

    this.#resources.set(id, {
      id,
      kind: spec.kind,
      parent,
      labels: { ...spec.labels },
      createdAt: this.#now(),
    })

    return id
  }

  /** Whether a resource is still alive. */
  has(id: string): boolean {
    return this.#resources.has(id)
  }

  get(id: string): Resource | undefined {
    return this.#resources.get(id)
  }

  /** Every living resource, in creation order. */
  alive(): readonly Resource[] {
    return [...this.#resources.values()]
  }

  /**
   * Delete a resource and everything nested inside it, returning what went.
   *
   * Deleting something that is already gone is not an error — a destroy that
   * runs twice is the normal case here, and the second run of the close hook
   * after a sweep has already reaped the environment must be a no-op rather
   * than a red build.
   */
  delete(id: string): readonly string[] {
    if (!this.#resources.has(id)) return []

    const doomed = [id, ...this.#descendants(id)]

    for (const victim of doomed) this.#resources.delete(victim)

    return doomed
  }

  /** Every living resource carrying all of these labels. */
  query(labels: Readonly<Record<string, string>>): readonly Resource[] {
    return this.alive().filter((resource) =>
      Object.entries(labels).every(([key, value]) => resource.labels[key] === value),
    )
  }

  /** The distinct values a label takes across everything alive. */
  labelValues(key: string): readonly string[] {
    const values = new Set<string>()

    for (const resource of this.#resources.values()) {
      const value = resource.labels[key]

      if (value !== undefined) values.add(value)
    }

    return [...values]
  }

  #descendants(id: string): readonly string[] {
    const found: string[] = []
    const frontier = [id]

    while (frontier.length > 0) {
      const parent = frontier.pop()

      if (parent === undefined) continue

      for (const resource of this.#resources.values()) {
        if (resource.parent !== parent) continue

        found.push(resource.id)
        frontier.push(resource.id)
      }
    }

    return found
  }
}
