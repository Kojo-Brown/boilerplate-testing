/**
 * The four ways people establish a session before saving it.
 *
 * Each of these is a recipe somebody ships, and three of the four come straight
 * out of Playwright's own authentication guide. They are listed here as data
 * rather than written inline in the spec so that `capture.spec.ts` runs the
 * same loop over all four — adjacent rows then differ by exactly one decision,
 * which is what lets `matrix.test.ts` assert the adjacency rather than the
 * prose claiming it.
 *
 * What they deliberately hold still: every wiring signs into the same account,
 * against the same origin, and saves to a file with `storageState`. The only
 * thing that varies is how the session got into the context and which options
 * the save was given. So a difference between two rows is a difference between
 * two recipes, not between two applications.
 */

/** How a wiring gets the session into the context before saving it. */
export type LoginRoute =
  /** `context.request.post('/api/login')`. No page is ever opened. */
  | 'api'
  /** API login, then a page is opened and the token written by hand. */
  | 'api-then-seed'
  /** The sign-in form is filled and submitted, and the application writes its own storage. */
  | 'ui'

/** The three stores a page can write, and the three a capture might or might not keep. */
export const CLIENT_STORES = ['local-storage', 'session-storage', 'indexed-db'] as const

export type ClientStore = (typeof CLIENT_STORES)[number]

export interface Wiring {
  readonly key: string
  /** How the session is established. */
  readonly login: LoginRoute
  /** Whether the save asks for `{ indexedDB: true }`. */
  readonly indexedDB: boolean
  /**
   * What the recipe leaves in the **live** browsing context, before anything is
   * saved. This is the control, and `capture.spec.ts` checks it against the
   * browser on every run.
   *
   * Without it every `absent` in the capture table is ambiguous between "the
   * save dropped it" and "the fixture never wrote it", and only the first is a
   * finding about Playwright. It is declared per wiring rather than measured
   * into a variable because a control that is derived from the run agrees with
   * the run by construction.
   */
  readonly writes: readonly ClientStore[]
  /** One line for the table. */
  readonly summary: string
  /** Where this recipe comes from, so a reader can go and disagree with it. */
  readonly provenance: string
}

export const WIRINGS: readonly Wiring[] = [
  {
    key: 'api-only',
    login: 'api',
    indexedDB: false,
    writes: [],
    summary: 'Sign in with an API request and save. No page is ever opened.',
    provenance:
      "Playwright's authentication guide, \"Authenticate with API request\" — the fastest " +
      'recipe in the document and the one recommended when the application has a login endpoint.',
  },
  {
    key: 'api-then-seed',
    login: 'api-then-seed',
    indexedDB: false,
    writes: ['local-storage'],
    summary: 'Sign in with an API request, open a page, write the token to storage by hand, save.',
    provenance:
      'The workaround a team writes on the day `api-only` turns out not to sign their ' +
      'single-page application in. This repository\'s own `playwright/setup/auth.setup.ts` ' +
      'is exactly this, and the comment in it ("Navigate to the origin so we can write to ' +
      'localStorage") is the moment the workaround was discovered.',
  },
  {
    key: 'ui-login',
    login: 'ui',
    indexedDB: false,
    writes: ['local-storage', 'session-storage', 'indexed-db'],
    summary: 'Drive the real sign-in form and save whatever the application wrote.',
    provenance:
      "Playwright's authentication guide, the headline recipe: a `setup` project that " +
      'performs the login the way a user would and calls `page.context().storageState()`.',
  },
  {
    key: 'ui-login-idb',
    login: 'ui',
    indexedDB: true,
    writes: ['local-storage', 'session-storage', 'indexed-db'],
    summary: 'Drive the real sign-in form and save with `{ indexedDB: true }`.',
    provenance:
      'The same recipe with the option added in Playwright 1.51, whose own documentation ' +
      'names the case it is for: "If your application uses IndexedDB to store authentication ' +
      'tokens, like Firebase Authentication, enable this."',
  },
]

export const WIRING_KEYS: readonly string[] = WIRINGS.map((wiring) => wiring.key)

export function wiringByKey(key: string): Wiring {
  const wiring = WIRINGS.find((candidate) => candidate.key === key)

  if (wiring === undefined) {
    throw new Error(`No wiring named ${JSON.stringify(key)}. Known: ${WIRING_KEYS.join(', ')}`)
  }

  return wiring
}
