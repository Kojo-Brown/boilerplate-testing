/**
 * The capture half, measured in Chromium.
 *
 * One test per wiring. Each one signs in the way that wiring says to, reads
 * back what the live browsing context is holding (the control), saves the
 * storage state to a file, opens a **fresh context from that file**, asks all
 * seven probes, and compares the row with `capture.ts`.
 *
 * Four things about the arrangement are deliberate:
 *
 * **The control comes first, and it is what makes an `absent` mean anything.**
 * "sessionStorage is absent in all four rows" is a finding about `storageState`
 * only if the sessions put a token in `sessionStorage` to begin with; a fixture
 * that quietly never wrote one produces the identical column and a finding
 * about the fixture. So `wirings.ts` declares what each recipe leaves in the
 * live context and this spec checks that declaration before reading the file.
 *
 * **The control is read from the page that signed in**, not from a fresh one.
 * `sessionStorage` is scoped to a browsing context rather than to a browser
 * context, so a second tab in the same `BrowserContext` reports it empty — and
 * a control that opened its own page would "discover" the token missing before
 * `storageState` had been anywhere near it.
 *
 * **Nothing is asked of the signing-in context after that.** It holds the
 * session in memory and would report every wiring as perfect. What is under
 * measurement is the file.
 *
 * **The row is compared whole.** A per-cell `expect` reports the first
 * disagreement and stops, and the interesting failures here are shaped —
 * "`indexedDB: true` moved two cells, not one" is a fact about a row.
 */

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EXPECTED_CAPTURE, type CaptureRow } from './capture.ts'
import { FIXTURE_PASSWORD, IDB, TOKEN_KEY, SESSION_COOKIE } from './origin.ts'
import { PROBES, type Verdict } from './probes.ts'
import { CLIENT_STORES, WIRINGS, type Wiring } from './wirings.ts'

/** Read the IndexedDB record the fixture application writes, from inside a page. */
const IDB_READ = ([database, store, key]: readonly string[]): Promise<string | null> =>
  new Promise<string | null>((resolve) => {
    const open = indexedDB.open(database as string, 1)

    open.onupgradeneeded = (): void => {
      open.result.createObjectStore(store as string)
    }
    open.onerror = (): void => resolve(null)
    open.onsuccess = (): void => {
      const read = open.result
        .transaction(store as string, 'readonly')
        .objectStore(store as string)
        .get(key as string)

      read.onerror = (): void => resolve(null)
      read.onsuccess = (): void => resolve(typeof read.result === 'string' ? read.result : null)
    }
  })

/** Open a page already on the origin, so its stores are readable. */
async function openAt(context: BrowserContext, origin: string): Promise<Page> {
  const page = await context.newPage()

  await page.goto(`${origin}/app/spa`)

  return page
}

/** Read the three client-side stores from one page. */
async function storesIn(page: Page): Promise<Record<string, boolean>> {
  return {
    'local-storage': (await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)) !== null,
    'session-storage':
      (await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY)) !== null,
    'indexed-db':
      (await page.evaluate(IDB_READ, [IDB.database, IDB.store, IDB.key] as const)) !== null,
  }
}

/**
 * Sign in the way one wiring says to, leaving the session in `context`.
 *
 * Returns the page the recipe used, still open, so the control can be read from
 * the browsing context that holds the `sessionStorage`. `api-only` returns
 * `null` because it opens no page at all, which is the whole of that recipe.
 */
async function establish(
  context: BrowserContext,
  wiring: Wiring,
  email: string,
  origin: string,
): Promise<Page | null> {
  if (wiring.login === 'ui') {
    const page = await context.newPage()

    await page.goto(`${origin}/login`)
    await page.fill('#email', email)
    await page.fill('#password', FIXTURE_PASSWORD)
    await page.click('#submit')
    await expect(page.locator('#state')).toHaveAttribute('data-state', 'signed-in')

    return page
  }

  const response = await context.request.post(`${origin}/api/login`, {
    data: { email, password: FIXTURE_PASSWORD },
  })

  expect(response.status()).toBe(200)

  if (wiring.login === 'api') {
    return null
  }

  // `api-then-seed`: the workaround. Open a page so there is an origin to write
  // to, then write the token by hand — which is the only store this recipe
  // reaches, because it writes from the outside rather than running the
  // application's own sign-in path.
  const { token } = (await response.json()) as { token: string }
  const page = await context.newPage()

  await page.goto(`${origin}/app/spa`)
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [TOKEN_KEY, token] as const,
  )

  return page
}

/** Ask one gate page for its verdict. */
async function gate(page: Page, origin: string, path: string): Promise<Verdict> {
  await page.goto(`${origin}${path}`)

  const value = await page
    .locator('#gate')
    .evaluate((node: HTMLElement) => node.dataset['gate'] ?? 'missing')

  if (value !== 'signed-in' && value !== 'signed-out') {
    throw new Error(`${path} never settled: #gate read ${JSON.stringify(value)}`)
  }

  return value
}

/** Run all seven probes against a context restored from a saved file. */
async function probeRestored(
  browser: Browser,
  statePath: string,
  origin: string,
): Promise<CaptureRow> {
  const restored = await browser.newContext({ storageState: statePath })

  try {
    const cookies = await restored.cookies(origin)
    const page = await restored.newPage()

    // The SPA gate is asked first and its page reused for the three storage
    // reads: `localStorage`, `sessionStorage` and IndexedDB are per origin, and
    // a context that has not navigated has no origin to read them from.
    const spaGate = await gate(page, origin, '/app/spa')
    const stores = await storesIn(page)
    const serverGate = await gate(page, origin, '/app/server')
    const idbGate = await gate(page, origin, '/app/idb')

    return {
      cookie: cookies.some((cookie) => cookie.name === SESSION_COOKIE) ? 'present' : 'absent',
      'local-storage': stores['local-storage'] === true ? 'present' : 'absent',
      'session-storage': stores['session-storage'] === true ? 'present' : 'absent',
      'indexed-db': stores['indexed-db'] === true ? 'present' : 'absent',
      'server-gate': serverGate,
      'spa-gate': spaGate,
      'idb-gate': idbGate,
    }
  } finally {
    await restored.close()
  }
}

let stateDir = ''

test.beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'authstate-'))
})

test.afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true })
})

for (const wiring of WIRINGS) {
  test(`${wiring.key} restores the cells capture.ts declares`, async ({ browser, baseURL }) => {
    const origin = baseURL ?? ''

    expect(origin, 'the config must supply a baseURL').not.toBe('')

    const reset = await browser.newContext()

    await reset.request.post(`${origin}/api/reset`)
    await reset.close()

    const email = `${wiring.key}@example.test`
    const statePath = join(stateDir, `${wiring.key}.json`)
    const signingIn = await browser.newContext()

    try {
      const loginPage = await establish(signingIn, wiring, email, origin)

      await signingIn.storageState({ path: statePath, indexedDB: wiring.indexedDB })

      // The control, read after the save so it cannot change the file. A
      // recipe that opens no page has no browsing context to read from, so one
      // is opened for it — and it has to be navigated to the origin before
      // anything can be read, because `localStorage` on `about:blank` is a
      // `SecurityError` rather than an empty store. That is the `api-only`
      // context stated exactly: not a browser with empty storage, a browser
      // that has never been anywhere.
      const control = await storesIn(loginPage ?? (await openAt(signingIn, origin)))

      expect(
        CLIENT_STORES.map((store) => `${store}=${control[store] === true}`),
        `the ${wiring.key} recipe left different stores in the live context than wirings.ts ` +
          'declares, so nothing can be concluded from what the saved file is missing',
      ).toEqual(CLIENT_STORES.map((store) => `${store}=${wiring.writes.includes(store)}`))
    } finally {
      await signingIn.close()
    }

    const measured = await probeRestored(browser, statePath, origin)
    const declared = EXPECTED_CAPTURE[wiring.key]

    expect(declared, `capture.ts declares no row for the ${wiring.key} wiring`).toBeDefined()

    expect(
      PROBES.map((probe) => `${probe.key}=${measured[probe.key]}`),
      `the ${wiring.key} row measured in Chromium differs from capture.ts`,
    ).toEqual(PROBES.map((probe) => `${probe.key}=${declared?.[probe.key]}`))
  })
}
