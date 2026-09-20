/**
 * What each wiring installs, and what its handler does — without a browser.
 *
 * The browser suite can tell you that `stub-fulfill` answered a request. It
 * cannot tell you *why*, and it cannot tell you cheaply: a glob with a typo in
 * it and a stub table with a missing entry produce the same cell. Both are
 * ordinary logic, and both are one assertion away from being unambiguous here.
 *
 * The fake context below records rather than simulates. It does not implement
 * route precedence or HAR matching — those are Playwright's, they are what
 * `fidelity.spec.ts` measures, and a fake that reimplemented them would be a
 * second opinion about the thing under test.
 */

import { describe, expect, it } from 'vitest'

import {
  API_GLOB,
  STUB_BODIES,
  WIRINGS,
  severNetwork,
  stubFor,
  wiringByName,
  type RouteLike,
  type RoutingContext,
} from './wirings'

const HAR_PATH = '/tmp/fixture.har'

/** One thing a wiring did to its context. */
type Installed =
  | { kind: 'route'; url: string; handler: (route: RouteLike) => Promise<void> }
  | { kind: 'har'; har: string; options: { url?: string; notFound?: string; update?: boolean } }
  | { kind: 'offline'; offline: boolean }

function recordingContext(): { context: RoutingContext; installed: Installed[] } {
  const installed: Installed[] = []

  return {
    installed,
    context: {
      route: (url, handler) => {
        installed.push({ kind: 'route', url, handler })

        return Promise.resolve(undefined)
      },
      routeFromHAR: (har, options) => {
        installed.push({ kind: 'har', har, options })

        return Promise.resolve()
      },
      setOffline: (offline) => {
        installed.push({ kind: 'offline', offline })

        return Promise.resolve()
      },
    },
  }
}

/** What a route handler did with the request it was given. */
interface Handled {
  fulfilled: { status?: number; contentType?: string; body?: string } | null
  aborted: string | null | undefined
  fellBack: boolean
}

async function handle(
  handler: (route: RouteLike) => Promise<void>,
  request: { url: string; method?: string; postData?: string | null },
): Promise<Handled> {
  const result: Handled = { fulfilled: null, aborted: null, fellBack: false }

  await handler({
    request: () => ({
      url: () => request.url,
      method: () => request.method ?? 'GET',
      postData: () => request.postData ?? null,
    }),
    fulfill: (response) => {
      result.fulfilled = response

      return Promise.resolve()
    },
    abort: (errorCode) => {
      result.aborted = errorCode ?? ''

      return Promise.resolve()
    },
    fallback: () => {
      result.fellBack = true

      return Promise.resolve()
    },
  })

  return result
}

const install = async (name: string): Promise<Installed[]> => {
  const wiring = wiringByName(name)

  if (wiring === undefined) {
    throw new Error(`no wiring named ${name}`)
  }

  const { context, installed } = recordingContext()
  await wiring.apply(context, { harPath: HAR_PATH })

  return installed
}

describe('the catalogue', () => {
  it('names every wiring exactly once', () => {
    const names = WIRINGS.map((wiring) => wiring.name)

    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every wiring a summary and a reason somebody reaches for it', () => {
    for (const wiring of WIRINGS) {
      expect(wiring.summary.length, `${wiring.name} has no summary`).toBeGreaterThan(0)
      expect(wiring.rationale.length, `${wiring.name} has no rationale`).toBeGreaterThan(0)
    }
  })

  it('finds a wiring by name and nothing by a name it does not have', () => {
    expect(wiringByName('offline')?.name).toBe('offline')
    expect(wiringByName('offline-mode')).toBeUndefined()
  })
})

describe('live', () => {
  it('installs nothing at all, which is what makes it a control', async () => {
    expect(await install('live')).toEqual([])
  })
})

describe('stub-fulfill', () => {
  it('claims the API glob and nothing wider', async () => {
    const installed = await install('stub-fulfill')

    expect(installed).toHaveLength(1)
    expect(installed[0]?.kind).toBe('route')
    expect(installed[0]).toMatchObject({ url: API_GLOB })
  })

  it('answers a path its table covers with that table entry', async () => {
    const [entry] = await install('stub-fulfill')

    if (entry?.kind !== 'route') {
      throw new Error('stub-fulfill no longer installs a route')
    }

    const handled = await handle(entry.handler, { url: 'http://localhost:3111/api/profile' })

    expect(handled.fulfilled?.status).toBe(200)
    expect(handled.fulfilled?.contentType).toBe('application/json')
    expect(JSON.parse(handled.fulfilled?.body ?? 'null')).toEqual(STUB_BODIES['/api/profile'])
  })

  it('answers a cache-busted URL from the same table entry', async () => {
    const [entry] = await install('stub-fulfill')

    if (entry?.kind !== 'route') {
      throw new Error('stub-fulfill no longer installs a route')
    }

    const handled = await handle(entry.handler, { url: 'http://localhost:3111/api/profile?cb=7' })

    expect(JSON.parse(handled.fulfilled?.body ?? 'null')).toEqual(STUB_BODIES['/api/profile'])
  })

  it('falls back rather than failing for a path its table does not cover', async () => {
    const [entry] = await install('stub-fulfill')

    if (entry?.kind !== 'route') {
      throw new Error('stub-fulfill no longer installs a route')
    }

    const handled = await handle(entry.handler, { url: 'http://localhost:3111/api/notifications' })

    expect(handled.fellBack).toBe(true)
    expect(handled.fulfilled).toBeNull()
  })

  it('has no entry for the endpoint the recording predates', () => {
    // The gap is the fixture. A table that covered everything would make the
    // `unrecorded-get` column unreachable.
    expect(STUB_BODIES['/api/notifications']).toBeUndefined()
  })

  it('answers the flaky endpoint with a success, which is why the retry never runs', () => {
    expect(STUB_BODIES['/api/flaky']).toMatchObject({ ok: true })
  })
})

describe('stubFor', () => {
  it('ignores the query string when looking a path up', () => {
    expect(stubFor('http://localhost:3111/api/profile?cb=7')).toBe(STUB_BODIES['/api/profile'])
  })

  it('returns null for a path the table does not hold', () => {
    expect(stubFor('http://localhost:3111/api/notifications')).toBeNull()
  })

  it('returns null for a non-API path, so the document is never stubbed', () => {
    expect(stubFor('http://localhost:3111/')).toBeNull()
  })
})

describe('the HAR wirings', () => {
  it('scopes har-abort to the API and closes it', async () => {
    expect(await install('har-abort')).toEqual([
      { kind: 'har', har: HAR_PATH, options: { url: API_GLOB, notFound: 'abort' } },
    ])
  })

  it('scopes har-fallback to the API and leaves it open', async () => {
    expect(await install('har-fallback')).toEqual([
      { kind: 'har', har: HAR_PATH, options: { url: API_GLOB, notFound: 'fallback' } },
    ])
  })

  it('differs between the two by one option and nothing else', async () => {
    const [abort] = await install('har-abort')
    const [fallback] = await install('har-fallback')

    if (abort?.kind !== 'har' || fallback?.kind !== 'har') {
      throw new Error('one of the HAR wirings no longer replays a HAR')
    }

    expect({ ...abort.options, notFound: undefined }).toEqual({
      ...fallback.options,
      notFound: undefined,
    })
  })

  it('takes the URL filter off for har-whole-page, so the document replays too', async () => {
    expect(await install('har-whole-page')).toEqual([
      { kind: 'har', har: HAR_PATH, options: { notFound: 'abort' } },
    ])
  })

  it('replays the path it was handed rather than one of its own', async () => {
    const { context, installed } = recordingContext()
    const wiring = wiringByName('har-abort')

    await wiring?.apply(context, { harPath: '/somewhere/else.har' })

    expect(installed[0]).toMatchObject({ har: '/somewhere/else.har' })
  })
})

describe('abort-api', () => {
  it('claims the API glob and fails everything it claims', async () => {
    const [entry] = await install('abort-api')

    if (entry?.kind !== 'route') {
      throw new Error('abort-api no longer installs a route')
    }

    expect(entry.url).toBe(API_GLOB)

    const handled = await handle(entry.handler, { url: 'http://localhost:3111/api/profile' })

    expect(handled.aborted).toBe('internetdisconnected')
    expect(handled.fellBack).toBe(false)
  })
})

describe('the offline wirings', () => {
  it('switches the connection off and touches no route', async () => {
    expect(await install('offline')).toEqual([{ kind: 'offline', offline: true }])
  })

  it('switches the connection off before installing the replay', async () => {
    // Order is the claim: the `offline` event has to fire while the routes
    // that will answer the page are already on their way in, not after the
    // page has been told it is disconnected and given up.
    const installed = await install('offline-har')

    expect(installed.map((entry) => entry.kind)).toEqual(['offline', 'har'])
    expect(installed[1]).toMatchObject({ options: { notFound: 'fallback' } })
  })

  it('leaves the replay unscoped, so the document is served too', async () => {
    const installed = await install('offline-har')

    if (installed[1]?.kind !== 'har') {
      throw new Error('offline-har no longer replays a HAR')
    }

    expect(installed[1].options.url).toBeUndefined()
  })
})

describe('severNetwork', () => {
  it('claims every URL rather than only the API', async () => {
    const { context, installed } = recordingContext()

    await severNetwork(context)

    expect(installed).toHaveLength(1)
    expect(installed[0]).toMatchObject({ kind: 'route', url: '**/*' })
  })

  it('fails what reaches it with the code Chromium reports for an unreachable host', async () => {
    const { context, installed } = recordingContext()

    await severNetwork(context)
    const entry = installed[0]

    if (entry?.kind !== 'route') {
      throw new Error('severNetwork no longer installs a route')
    }

    const handled = await handle(entry.handler, { url: 'http://localhost:3111/anything' })

    expect(handled.aborted).toBe('failed')
  })
})
