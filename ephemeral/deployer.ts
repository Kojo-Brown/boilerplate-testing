/**
 * The thing that creates an environment, and the record it keeps of what it
 * created.
 *
 * ---------------------------------------------------------------------------
 * The state file is the subject, not the plumbing
 * ---------------------------------------------------------------------------
 * This deployer is scrupulous: it records every resource it creates and
 * {@link Deployer.destroy} deletes exactly that list. There is no bug in it,
 * which is the point — `platform-created-resource` is a row in the matrix even
 * though nothing here is wrong, because the resource in question is created by
 * the *platform* (`harness.ts`'s `traffic` step) and a scrupulous record of
 * what you made is still not a record of what exists.
 *
 * Whether that gap costs anything depends on one control: `namespaced`. A
 * stack whose resources are nested inside one parent it owns records that
 * parent, and deleting it cascades over everything underneath, including what
 * nobody wrote down. A flat stack records two ids and deletes two ids. Same
 * teardown code, same state file, different blast radius — which is why the
 * matrix has `namespace-owned` a cell above `on-close-seeded` without either
 * of them changing when or whether teardown runs.
 *
 * ---------------------------------------------------------------------------
 * Redeploying
 * ---------------------------------------------------------------------------
 * A second deploy for a pull request replaces the `service` and leaves the
 * database standing, which is what a preview pipeline does on a push: the data
 * is the expensive part. The service carries the commit it was built from as a
 * label, and that label is the only thing `stale` is ever read from — an
 * environment serving a commit that is not the pull request's head is the
 * failure `racing-pushes` and `pushed-a-fix` are about, and it is invisible
 * unless somebody writes the commit down where a reviewer could check it.
 */

import { Cloud } from './cloud.ts'
import { Seeds, type SeedPolicy } from './seeds.ts'

/** What the deployer wrote down about one pull request's environment. */
export interface EnvironmentRecord {
  readonly pr: number
  /** The commit the running service was built from. */
  sha: string
  /** Resource ids the deployer created and therefore knows to delete. */
  ids: string[]
  /** The owned parent, when the stack is namespaced. */
  namespace: string | null
}

export interface DeployRequest {
  readonly pr: number
  readonly sha: string
  /** The migration version this commit's code expects its data to be at. */
  readonly schema: string
  readonly namespaced: boolean
  readonly seedPolicy: SeedPolicy
}

export class Deployer {
  readonly #records = new Map<number, EnvironmentRecord>()
  readonly #cloud: Cloud
  readonly #seeds: Seeds

  constructor(cloud: Cloud, seeds: Seeds) {
    this.#cloud = cloud
    this.#seeds = seeds
  }

  /** The record for a pull request, if it has an environment. */
  record(pr: number): EnvironmentRecord | undefined {
    return this.#records.get(pr)
  }

  /** Every pull request the deployer believes it has an environment for. */
  tracked(): readonly number[] {
    return [...this.#records.keys()]
  }

  /**
   * Bring a pull request's environment up, or move it to a new commit.
   *
   * Idempotent in the only sense that matters here: running it twice for the
   * same commit leaves one service, because the old one is deleted before the
   * new one is made.
   */
  deploy(request: DeployRequest): void {
    const labels = { pr: String(request.pr) }
    const existing = this.#records.get(request.pr)

    if (existing !== undefined) {
      const retired = existing.ids.filter((id) => this.#cloud.get(id)?.kind === 'service')

      for (const id of retired) this.#cloud.delete(id)

      existing.ids = existing.ids.filter((id) => !retired.includes(id))

      const replacement = this.#cloud.create({
        kind: 'service',
        parent: existing.namespace,
        labels: { ...labels, sha: request.sha },
      })

      existing.ids.push(replacement)
      existing.sha = request.sha
      this.#seeds.provision(request.pr, request.seedPolicy, request.schema)

      return
    }

    const namespace = request.namespaced
      ? this.#cloud.create({ kind: 'namespace', labels })
      : null

    const database = this.#cloud.create({ kind: 'database', parent: namespace, labels })
    const service = this.#cloud.create({
      kind: 'service',
      parent: namespace,
      labels: { ...labels, sha: request.sha },
    })

    this.#records.set(request.pr, {
      pr: request.pr,
      sha: request.sha,
      ids: namespace === null ? [database, service] : [namespace, database, service],
      namespace,
    })

    this.#seeds.provision(request.pr, request.seedPolicy, request.schema)
  }

  /**
   * Tear an environment down the way a deployer does: delete what it recorded.
   *
   * Deleting an id whose resource is already gone is a no-op, so a close hook
   * that fires after a sweep has reaped the environment is not an error.
   */
  destroy(pr: number): void {
    const existing = this.#records.get(pr)

    if (existing === undefined) return

    for (const id of existing.ids) this.#cloud.delete(id)

    this.#records.delete(pr)
    this.#seeds.release(pr)
  }

  /** Drop the record without touching the cloud — what a lost state file looks like. */
  forget(pr: number): void {
    this.#records.delete(pr)
    this.#seeds.release(pr)
  }
}
