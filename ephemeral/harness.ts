/**
 * The runtime: one wiring, one timeline, one observation.
 *
 * ---------------------------------------------------------------------------
 * What a "run" is, and why it is the centre of this file
 * ---------------------------------------------------------------------------
 * Everything a pull request does to a preview environment goes through a
 * workflow run, and a workflow run is not an instant. It is queued, it is in
 * flight, and it either lands or it does not. Four of the twelve hazards are
 * about that interval and nothing else: a destroy run that dies, a deploy run
 * that lands after the destroy did, two deploy runs that land out of order, a
 * sweep that never fires.
 *
 * So runs are first-class here and nothing is applied at the moment its event
 * arrives. An event *registers* a run; a `finish` step applies it; a `cancel`
 * step kills it. `cancel-in-progress` is then one honest line —
 * {@link Harness.cancelPending} — rather than a special case, and the three
 * cells it is worth in the matrix are the cells where a pending run existed to
 * cancel.
 *
 * ---------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------
 * Nothing here is concurrent. "Two runs in flight" is two entries in a map
 * with `pending` status, and which one wins is decided by the order of the
 * `finish` steps in the timeline rather than by a scheduler. There is no
 * timer, no sleep, no randomness and no wall clock: ages come from
 * {@link Clock}, ids from a counter. A cell that fails fails on every machine
 * and names the same resource when it does.
 */

import { Clock } from './clock.ts'
import { Cloud } from './cloud.ts'
import { Deployer } from './deployer.ts'
import { schemaOf, type Step } from './hazards.ts'
import { Seeds } from './seeds.ts'
import type { PrEvent, Wiring } from './strategies.ts'

/** How an environment stopped existing, when it did. */
export type Removal = 'teardown' | 'sweep'

export type RunStatus = 'pending' | 'finished' | 'cancelled' | 'blocked'

export interface RunRecord {
  readonly label: string
  readonly pr: number
  readonly kind: 'deploy' | 'destroy'
  readonly sha: string
  readonly schema: string
  status: RunStatus
}

/** What a reviewer saw when they opened the environment. */
export interface ProbeResult {
  readonly pr: number
  readonly at: number
  /** The commit the running service was built from, or `null` if nothing is running. */
  readonly servingSha: string | null
  readonly headSha: string
  /** Rows visible to this pull request that another pull request wrote. */
  readonly foreignRows: readonly string[]
  readonly datasetSchema: string
  /** The schema this pull request's code needs its data at. */
  readonly expectedSchema: string
}

/** Everything `scoring.ts` is allowed to look at. */
export interface Observation {
  readonly cloud: Cloud
  readonly deployer: Deployer
  readonly probes: readonly ProbeResult[]
  /** Pull requests whose fork-controlled code was handed the deployment secret. */
  readonly exposed: ReadonlySet<number>
  readonly removal: ReadonlyMap<number, Removal>
  readonly runs: readonly RunRecord[]
}

interface Head {
  readonly sha: string
  readonly schema: string
}

export class Harness {
  readonly #clock = new Clock()
  readonly #cloud: Cloud
  readonly #seeds = new Seeds()
  readonly #deployer: Deployer
  readonly #runs = new Map<string, RunRecord>()
  readonly #heads = new Map<number, Head>()
  readonly #forks = new Set<number>()
  readonly #approved = new Set<number>()
  readonly #open = new Set<number>()
  readonly #exposed = new Set<number>()
  readonly #removal = new Map<number, Removal>()
  readonly #probes: ProbeResult[] = []

  readonly #wiring: Wiring

  constructor(wiring: Wiring) {
    this.#wiring = wiring
    this.#cloud = new Cloud(this.#clock.now)
    this.#deployer = new Deployer(this.#cloud, this.#seeds)
  }

  /** Play a timeline and hand back what is left. */
  static play(wiring: Wiring, steps: readonly Step[]): Observation {
    const harness = new Harness(wiring)

    for (const step of steps) harness.apply(step)

    return harness.observe()
  }

  observe(): Observation {
    return {
      cloud: this.#cloud,
      deployer: this.#deployer,
      probes: [...this.#probes],
      exposed: new Set(this.#exposed),
      removal: new Map(this.#removal),
      runs: [...this.#runs.values()],
    }
  }

  apply(step: Step): void {
    switch (step.kind) {
      case 'open': {
        this.#open.add(step.pr)
        this.#heads.set(step.pr, { sha: step.sha, schema: schemaOf(step) })
        if (step.fork === true) this.#forks.add(step.pr)
        this.#registerDeploy(step.pr, 'opened', step.run)

        return
      }

      case 'push': {
        this.#heads.set(step.pr, { sha: step.sha, schema: schemaOf(step) })
        this.#registerDeploy(step.pr, 'synchronize', step.run)

        return
      }

      case 'label': {
        this.#approved.add(step.pr)
        this.#registerDeploy(step.pr, 'labeled', step.run)

        return
      }

      case 'close': {
        this.#open.delete(step.pr)

        if (!this.#wiring.teardownOnClose) return

        const head = this.#head(step.pr)

        if (this.#wiring.cancelInFlight) this.cancelPending(step.pr)

        this.#runs.set(step.run, {
          label: step.run,
          pr: step.pr,
          kind: 'destroy',
          sha: head.sha,
          schema: head.schema,
          status: 'pending',
        })

        return
      }

      case 'finish': {
        this.#finish(step.run)

        return
      }

      case 'cancel': {
        const run = this.#runs.get(step.run)

        if (run !== undefined && run.status === 'pending') run.status = 'cancelled'

        return
      }

      case 'traffic': {
        const record = this.#deployer.record(step.pr)

        if (record === undefined) return

        // The platform's own resource: labelled like the rest of the
        // environment because the platform reads the same tags, nested under
        // the namespace when there is one, and absent from the deployer's
        // record because the deployer did not create it.
        this.#cloud.create({
          kind: 'log-group',
          parent: record.namespace,
          labels: { pr: String(step.pr) },
        })

        return
      }

      case 'write': {
        this.#seeds.write(step.pr, step.row, step.value)

        return
      }

      case 'tick': {
        this.#clock.advance(step.minutes)

        return
      }

      case 'sweep': {
        this.#sweep()

        return
      }

      case 'probe': {
        this.#probe(step.pr)

        return
      }
    }
  }

  /**
   * `concurrency: cancel-in-progress`, as one method.
   *
   * The group is the pull request and it is shared by the deploy and destroy
   * workflows, which is the part most examples get wrong: a group per workflow
   * makes two pushes cancel each other and leaves a close free to race a
   * deploy, which is `zombie-deploy`.
   */
  cancelPending(pr: number): void {
    for (const run of this.#runs.values()) {
      if (run.pr === pr && run.status === 'pending') run.status = 'cancelled'
    }
  }

  #head(pr: number): Head {
    const head = this.#heads.get(pr)

    if (head === undefined) throw new Error(`timeline touches pull request ${String(pr)} before it opened`)

    return head
  }

  #registerDeploy(pr: number, event: PrEvent, label: string): void {
    if (!this.#wiring.deployOn.includes(event)) return

    const head = this.#head(pr)
    const fork = this.#forks.has(pr)
    let status: RunStatus = 'pending'

    if (fork) {
      // A `pull_request` workflow does run for a fork; it just has no secrets,
      // so the deploy step fails. The run exists and lands nothing, which is
      // not the same as never having been triggered and is why `blocked` is a
      // status rather than an early return.
      if (this.#wiring.trigger === 'pull_request') status = 'blocked'

      // A label-gated `pull_request_target` workflow evaluates its `if:` and
      // stops before any job starts, so there is no run at all until a
      // maintainer has said so.
      if (this.#wiring.trigger === 'labelled' && !this.#approved.has(pr)) return
    }

    if (status === 'pending' && this.#wiring.cancelInFlight) this.cancelPending(pr)

    this.#runs.set(label, {
      label,
      pr,
      kind: 'deploy',
      sha: head.sha,
      schema: head.schema,
      status,
    })
  }

  #finish(label: string): void {
    const run = this.#runs.get(label)

    if (run === undefined || run.status !== 'pending') return

    run.status = 'finished'

    if (run.kind === 'destroy') {
      this.#deployer.destroy(run.pr)
      this.#removal.set(run.pr, 'teardown')

      return
    }

    this.#deployer.deploy({
      pr: run.pr,
      sha: run.sha,
      schema: run.schema,
      namespaced: this.#wiring.namespaced,
      seedPolicy: this.#wiring.seedPolicy,
    })

    this.#removal.delete(run.pr)

    // The environment now exists, was built from a fork's head commit, and was
    // built by a job holding the repository's deployment secret. `labelled`
    // never reaches here unapproved, and `pull_request` never reaches here at
    // all for a fork, so this is exactly the `pull_request_target` case.
    if (this.#forks.has(run.pr) && !this.#approved.has(run.pr)) this.#exposed.add(run.pr)
  }

  #sweep(): void {
    const reaper = this.#wiring.reaper

    if (reaper === null) return

    for (const value of this.#cloud.labelValues('pr')) {
      const resources = this.#cloud.query({ pr: value })

      if (resources.length === 0) continue

      const pr = Number(value)
      const oldest = Math.min(...resources.map((resource) => resource.createdAt))
      const due =
        reaper.basis === 'age'
          ? this.#clock.now() - oldest >= reaper.ttlMinutes
          : !this.#open.has(pr)

      if (!due) continue

      for (const resource of resources) this.#cloud.delete(resource.id)

      this.#deployer.forget(pr)
      this.#removal.set(pr, 'sweep')
    }
  }

  #probe(pr: number): void {
    const head = this.#head(pr)
    const service = this.#cloud
      .query({ pr: String(pr) })
      .find((resource) => resource.kind === 'service')

    this.#probes.push({
      pr,
      at: this.#clock.now(),
      servingSha: service?.labels['sha'] ?? null,
      headSha: head.sha,
      foreignRows: this.#seeds.foreignRows(pr),
      datasetSchema: this.#seeds.schemaFor(pr),
      expectedSchema: head.schema,
    })
  }
}
