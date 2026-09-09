/**
 * A typed client for the four broker operations a pipeline actually performs.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the `pact-broker` CLI
 * ---------------------------------------------------------------------------
 * The documented way to publish a pact and to ask `can-i-deploy` is the Ruby
 * `pact-broker` CLI, and every pact tutorial reaches for it. It is not
 * reachable from here: `@pact-foundation/pact-core@15` dropped the bundled
 * standalone, so the CLI means either a Ruby toolchain or a Docker image on
 * the critical path of `pnpm test:pact` — a dependency this repository would
 * be adding to demonstrate an HTTP call.
 *
 * The broker's HTTP API is the thing the CLI drives, it is versioned and
 * documented, and four endpoints is not a client library. Writing them out
 * also makes the pipeline legible: `publishContracts` is one POST, and the
 * reason a team's contract testing is or is not wired up is which of these
 * four calls their CI makes.
 *
 * ---------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------------
 * Every method throws {@link BrokerError} on a non-2xx, carrying the status
 * and the body. A broker that refuses a publish and a broker that says a
 * deployment is unsafe are different events and must not both surface as a
 * rejected promise with no detail — the second one is an answer.
 */

/** Credentials, if the broker wants any. Most CI brokers do. */
export type BrokerAuth =
  | { readonly kind: 'none' }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | { readonly kind: 'bearer'; readonly token: string }

/** A non-2xx response from the broker. */
export class BrokerError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 500)}`)
    this.name = 'BrokerError'
  }
}

/** One contract in a publish request. */
export interface ContractToPublish {
  readonly consumerName: string
  readonly providerName: string
  /** The pact document itself, as parsed JSON. Encoded on the way out. */
  readonly content: unknown
}

/** What a publish call needs to say about the consumer build that produced it. */
export interface PublishRequest {
  readonly consumerName: string
  /** The consumer's version. In CI this is the commit sha. */
  readonly consumerVersion: string
  /** The branch the build is on. This is what selectors match against. */
  readonly branch: string
  readonly tags?: readonly string[]
  readonly contracts: readonly ContractToPublish[]
}

/** The broker's answer to "is it safe to deploy this version here?". */
export interface CanIDeployResult {
  readonly deployable: boolean
  /** The broker's own sentence. Worth printing verbatim — it names what is missing. */
  readonly reason: string
}

/** A `notice` from a publish response: the broker narrating what it did. */
export interface PublishNotice {
  readonly type: string
  readonly text: string
}

export class PactBrokerClient {
  readonly #baseUrl: string
  readonly #auth: BrokerAuth

  constructor(baseUrl: string, auth: BrokerAuth = { kind: 'none' }) {
    // Trailing slashes turn every path below into a double slash, which some
    // brokers route and some 404. Normalise once, here.
    this.#baseUrl = baseUrl.replace(/\/+$/, '')
    this.#auth = auth
  }

  get baseUrl(): string {
    return this.#baseUrl
  }

  get auth(): BrokerAuth {
    return this.#auth
  }

  async #request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/hal+json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.#auth.kind === 'basic') {
      const encoded = Buffer.from(`${this.#auth.username}:${this.#auth.password}`).toString('base64')
      headers['Authorization'] = `Basic ${encoded}`
    } else if (this.#auth.kind === 'bearer') {
      headers['Authorization'] = `Bearer ${this.#auth.token}`
    }

    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    const text = await response.text()
    if (!response.ok) throw new BrokerError(response.status, method, path, text)
    return text.length === 0 ? undefined : JSON.parse(text)
  }

  /** `GET /diagnostic/status/heartbeat` — the broker's own readiness check. */
  async heartbeat(): Promise<boolean> {
    try {
      const body = (await this.#request('GET', '/diagnostic/status/heartbeat')) as { ok?: boolean }
      return body?.ok === true
    } catch {
      return false
    }
  }

  /**
   * Publishes contracts, their consumer version, its branch and its tags in
   * one call.
   *
   * `POST /contracts/publish` rather than the older
   * `PUT /pacts/provider/…/consumer/…/version/…`: the old endpoint publishes
   * the document and nothing else, so recording the branch takes a second call
   * and each tag a third. Three calls that can half-succeed is how a consumer
   * version ends up in the broker with no branch, which no selector then
   * matches — the pact is published and invisible.
   */
  async publishContracts(request: PublishRequest): Promise<readonly PublishNotice[]> {
    const body = {
      pacticipantName: request.consumerName,
      pacticipantVersionNumber: request.consumerVersion,
      branch: request.branch,
      ...(request.tags?.length ? { tags: [...request.tags] } : {}),
      contracts: request.contracts.map((contract) => ({
        consumerName: contract.consumerName,
        providerName: contract.providerName,
        specification: 'pact',
        contentType: 'application/json',
        content: Buffer.from(JSON.stringify(contract.content)).toString('base64'),
      })),
    }

    const response = (await this.#request('POST', '/contracts/publish', body)) as {
      notices?: readonly PublishNotice[]
    }
    return response?.notices ?? []
  }

  /**
   * `GET /can-i-deploy` — the deploy gate.
   *
   * The one question a pact file on a disk cannot answer, because answering it
   * needs to know what is deployed *now* and who verified what. `deployable`
   * is false both when a verification failed and when there is no verification
   * at all, and the two are not the same problem: `reason` is what
   * distinguishes them, which is why it is returned rather than logged.
   */
  async canIDeploy(
    pacticipant: string,
    version: string,
    environment: string,
  ): Promise<CanIDeployResult> {
    const query = new URLSearchParams({ pacticipant, version, environment })
    const body = (await this.#request('GET', `/can-i-deploy?${query}`)) as {
      summary?: { deployable?: boolean | null; reason?: string }
    }
    return {
      // Explicitly `=== true`: the broker answers `null` for "unknown", which
      // is not deployable and would be lost by a truthiness check.
      deployable: body?.summary?.deployable === true,
      reason: body?.summary?.reason ?? 'no summary in response',
    }
  }

  /**
   * Creates an environment, or returns the existing one with that name.
   *
   * Environments are the broker's model of where software runs, and
   * `can-i-deploy … --to-environment` is meaningless without one. Idempotent
   * because CI reruns: the broker answers 409 on a duplicate name, and a
   * pipeline step that fails on its second run is not a pipeline step.
   */
  async ensureEnvironment(name: string): Promise<string> {
    const existing = (await this.#request('GET', '/environments')) as {
      _embedded?: { environments?: readonly { uuid: string; name: string }[] }
    }
    const found = existing?._embedded?.environments?.find((env) => env.name === name)
    if (found) return found.uuid

    const created = (await this.#request('POST', '/environments', {
      name,
      displayName: name,
      production: name === 'production',
      contacts: [],
    })) as { uuid: string }
    return created.uuid
  }

  /**
   * Records that a version is now running in an environment.
   *
   * This is the call teams skip, and skipping it is what makes `can-i-deploy`
   * answer questions about the wrong thing: with no deployment records the
   * broker's idea of "what is in production" is empty, so the matrix is
   * computed against every version that ever existed.
   *
   * The path takes the environment's **UUID**, not its name — the name works
   * everywhere else, including `can-i-deploy?environment=production`, and here
   * it answers 404 with "The requested document was not found on this server",
   * which reads as a missing *version*. Hence {@link ensureEnvironment}
   * returning the uuid rather than nothing.
   */
  async recordDeployment(
    pacticipant: string,
    version: string,
    environment: string,
  ): Promise<void> {
    const uuid = await this.ensureEnvironment(environment)
    await this.#request(
      'POST',
      `/pacticipants/${encodeURIComponent(pacticipant)}/versions/${encodeURIComponent(version)}/deployed-versions/environment/${uuid}`,
      { applicationInstance: 'ci' },
    )
  }

  /**
   * Deletes a pacticipant and everything hanging off it.
   *
   * Test isolation. Every cell of the pipeline matrix publishes to the same
   * broker, and a broker is stateful in exactly the way `containers/README.md`
   * spends a page on: a pact left behind by the previous cell is still
   * selectable by the next one, which then verifies a contract it did not
   * publish and reports a detection nobody caused. Cheaper and more certain
   * than a fresh broker per cell.
   */
  async deletePacticipant(name: string): Promise<void> {
    try {
      await this.#request('DELETE', `/pacticipants/${encodeURIComponent(name)}`)
    } catch (error) {
      // A 404 is the desired state, not a failure.
      if (error instanceof BrokerError && error.status === 404) return
      throw error
    }
  }
}
