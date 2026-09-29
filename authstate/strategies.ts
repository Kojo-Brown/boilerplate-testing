/**
 * The five ways people share a signed-in session across parallel workers.
 *
 * The SPEC item names two things — "auth state reuse via storage state" and
 * "per-worker isolation" — and they are usually discussed as one idea. They are
 * not. Reuse is about how many times you sign in; isolation is about how many
 * accounts you sign in *as*. A suite can have either without the other, and the
 * table these strategies produce is mostly a list of what you get when you have
 * one and think you have both.
 *
 * Two of the five come from Playwright's own authentication guide: `shared-file`
 * is its headline recipe, and `per-parallel-index` is the one it gives under
 * "Moderate: one account per parallel worker", down to the `existsSync` check
 * that decides whether to sign in or restore. `per-worker-index` is the same
 * recipe with one identifier changed, and it is the change the table is about.
 */

/** Where a worker's account name comes from. */
export type AccountScope =
  /** One account for the whole run. */
  | 'run'
  /** One account per `workerInfo.parallelIndex` — bounded by the worker count. */
  | 'parallel-index'
  /** One account per `workerInfo.workerIndex` — unbounded, one more per restart. */
  | 'worker-index'
  /** One account per test. */
  | 'test'

/** How a worker obtains a signed-in context. */
export type Acquisition =
  /** Sign in directly, every time the fixture is built. */
  | 'sign-in'
  /** Sign in once and save; later workers restore the saved file. */
  | 'save-and-restore'
  /** Restore a file some earlier project wrote; never sign in. */
  | 'restore-only'

export interface Strategy {
  readonly key: string
  readonly scope: AccountScope
  readonly acquisition: Acquisition
  /** Whether the run needs a `setup` project to write the file before the measure project. */
  readonly needsSetup: boolean
  readonly summary: string
  readonly provenance: string
}

export const STRATEGIES: readonly Strategy[] = [
  {
    key: 'shared-lazy',
    scope: 'run',
    acquisition: 'sign-in',
    needsSetup: false,
    summary: 'Every worker signs into the same account itself. Nothing is saved or reused.',
    provenance:
      'What a suite does before anybody has heard of `storageState`: a `beforeAll` that ' +
      'logs in. It is the control, and it is in the table because it is what most of the ' +
      'suites this pattern is offered to actually look like.',
  },
  {
    key: 'shared-file',
    scope: 'run',
    acquisition: 'restore-only',
    needsSetup: true,
    summary:
      'A setup project signs in once into one account and saves it; every worker restores ' +
      'that one file.',
    provenance:
      "Playwright's authentication guide, the headline recipe: a `setup` project, a saved " +
      'state file, and `dependencies: [\'setup\']` on the projects that use it.',
  },
  {
    key: 'per-parallel-index',
    scope: 'parallel-index',
    acquisition: 'save-and-restore',
    needsSetup: false,
    summary:
      'One account per `parallelIndex`. A worker restores its slot\'s file if there is one ' +
      'and signs in to create it if there is not.',
    provenance:
      'Playwright\'s authentication guide, "Moderate: one account per parallel worker" — a ' +
      'worker-scoped fixture keyed on `test.info().parallelIndex`, with an `existsSync` ' +
      'check deciding between restoring and signing in.',
  },
  {
    key: 'per-worker-index',
    scope: 'worker-index',
    acquisition: 'save-and-restore',
    needsSetup: false,
    summary: 'The same recipe keyed on `workerIndex` instead of `parallelIndex`.',
    provenance:
      'Not a published recipe. It is one identifier different from the row above, which is ' +
      'the point of putting the two next to each other: the documentation calls both of ' +
      'them "per worker" and only one of them is.',
  },
  {
    key: 'per-test',
    scope: 'test',
    acquisition: 'sign-in',
    needsSetup: false,
    summary: 'A fresh account per test. Nothing is reused at all.',
    provenance:
      'Playwright\'s authentication guide, "Advanced: one account per test" — the option it ' +
      'describes as the most isolated and the most expensive, and the upper bound this ' +
      'table is read against.',
  },
]

export const STRATEGY_KEYS: readonly string[] = STRATEGIES.map((strategy) => strategy.key)

export function strategyByKey(key: string): Strategy {
  const strategy = STRATEGIES.find((candidate) => candidate.key === key)

  if (strategy === undefined) {
    throw new Error(`No strategy named ${JSON.stringify(key)}. Known: ${STRATEGY_KEYS.join(', ')}`)
  }

  return strategy
}

/** The one account every `run`-scoped strategy shares. */
export const SHARED_ACCOUNT = 'shared@example.test'

/**
 * The account a worker signs in as, and the file it caches the session in.
 *
 * This is the whole of the difference between the middle three rows, which is
 * why it is one function rather than three fixtures: `parallel-index` and
 * `worker-index` differ in the identifier they read off `workerInfo` and in
 * nothing else, and a reader should be able to see that without diffing two
 * files.
 */
export function accountFor(
  strategy: Strategy,
  identity: { readonly workerIndex: number; readonly parallelIndex: number; readonly testId: string },
): { readonly email: string; readonly slot: string } {
  switch (strategy.scope) {
    case 'run':
      return { email: SHARED_ACCOUNT, slot: 'shared' }
    case 'parallel-index':
      return {
        email: `slot-p${identity.parallelIndex}@example.test`,
        slot: `p${identity.parallelIndex}`,
      }
    case 'worker-index':
      return {
        email: `slot-w${identity.workerIndex}@example.test`,
        slot: `w${identity.workerIndex}`,
      }
    case 'test':
      return { email: `${identity.testId}@example.test`, slot: identity.testId }
  }
}

/** A test title reduced to something usable as an account name. */
export function testIdFrom(titlePath: readonly string[]): string {
  const slug = titlePath
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug === '' ? 'unnamed' : slug.slice(0, 60)
}
