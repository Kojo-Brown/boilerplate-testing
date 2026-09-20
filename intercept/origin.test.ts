/**
 * The fixture origin's routes, without a socket.
 *
 * Everything the browser suite measures rests on this file answering the way
 * the matrix assumes it does, and almost none of that needs a server: a route
 * table is a function. The one thing a unit test here is *not* able to say is
 * whether the bytes survive `node:http`, which is what `server.test.ts` is for.
 */

import { describe, expect, it } from 'vitest'

import {
  CONTROL_PATHS,
  CURRENT_SCHEMA,
  RECORDED_SCHEMA,
  createState,
  feedItems,
  readWord,
  respond,
  type OriginResponse,
} from './origin'

const get = (url: string, state = createState(), schema = CURRENT_SCHEMA): OriginResponse =>
  respond({ method: 'GET', url, body: '' }, state, schema)

const post = (url: string, body: string, state = createState()): OriginResponse =>
  respond({ method: 'POST', url, body }, state)

const parse = (response: OriginResponse): Record<string, unknown> =>
  JSON.parse(response.body) as Record<string, unknown>

describe('the document and its stylesheet', () => {
  it('serves an HTML document at the root', () => {
    const response = get('/')

    expect(response.status).toBe(200)
    expect(response.contentType).toContain('text/html')
    expect(response.body).toContain('<main id="app">')
  })

  it('links exactly one stylesheet, which is the one subresource the probes measure', () => {
    const links = [...get('/').body.matchAll(/<link[^>]*>/g)]

    expect(links).toHaveLength(1)
    expect(links[0]?.[0]).toContain('/assets/app.css')
  })

  it('carries no inline script, so the page never issues a request of its own', () => {
    expect(get('/').body).not.toContain('<script')
  })

  it('serves the stylesheet the client reads a colour back out of', () => {
    const response = get('/assets/app.css')

    expect(response.status).toBe(200)
    expect(response.contentType).toBe('text/css')
    expect(response.body).toContain('rgb(17, 17, 17)')
  })
})

describe('the API routes', () => {
  it('stamps every JSON body with the origin as its source', () => {
    for (const path of ['/api/profile', '/api/feed', '/api/notifications']) {
      expect(parse(get(path))['source'], `${path} is unstamped`).toBe('origin')
    }
  })

  it('answers the profile identically with and without a cache-busting query', () => {
    expect(get('/api/profile?cb=7').body).toBe(get('/api/profile').body)
  })

  it('serves the feed at the version it was asked for', () => {
    expect(parse(get('/api/feed', createState(), RECORDED_SCHEMA))['schema']).toBe(RECORDED_SCHEMA)
    expect(parse(get('/api/feed'))['schema']).toBe(CURRENT_SCHEMA)
  })

  it('changes the item shape between the two versions rather than a headline', () => {
    // The drift has to be one a consumer would trip over. A string where an
    // object is expected is that; a different title is not.
    expect(feedItems(RECORDED_SCHEMA).every((item) => typeof item === 'string')).toBe(true)
    expect(feedItems(CURRENT_SCHEMA).every((item) => typeof item === 'object')).toBe(true)
  })

  it('echoes the word it was sent, upper-cased', () => {
    expect(parse(post('/api/echo', JSON.stringify({ word: 'live' })))['echoed']).toBe('LIVE')
  })

  it('echoes nothing for a body it cannot read, rather than falling over', () => {
    expect(post('/api/echo', 'not json').status).toBe(200)
    expect(parse(post('/api/echo', 'not json'))['echoed']).toBe('')
  })

  it('answers an unknown path with a 404 that is still stamped', () => {
    const response = get('/api/nothing-here')

    expect(response.status).toBe(404)
    expect(parse(response)['source']).toBe('origin')
  })
})

describe('the flaky endpoint', () => {
  it('fails the first request after a reset and succeeds after that', () => {
    const state = createState()

    expect(get('/api/flaky', state).status).toBe(503)
    expect(get('/api/flaky', state).status).toBe(200)
    expect(get('/api/flaky', state).status).toBe(200)
  })

  it('fails again once the ledger is reset', () => {
    const state = createState()

    get('/api/flaky', state)
    respond({ method: 'POST', url: CONTROL_PATHS.reset, body: '' }, state)

    expect(get('/api/flaky', state).status).toBe(503)
  })

  it('names which attempt each answer was, so a replay of the wrong one is visible', () => {
    const state = createState()

    expect(parse(get('/api/flaky', state))['attempt']).toBe('first')
    expect(parse(get('/api/flaky', state))['attempt']).toBe('later')
  })
})

describe('the request ledger', () => {
  it('records the method and the full URL of every request it answers', () => {
    const state = createState()

    get('/api/profile', state)
    post('/api/echo', '{}', state)

    expect(state.log).toEqual(['GET /api/profile', 'POST /api/echo'])
  })

  it('keeps the query string, so two cache-busted requests are two entries', () => {
    const state = createState()

    get('/api/profile', state)
    get('/api/profile?cb=7', state)

    expect(state.log).toEqual(['GET /api/profile', 'GET /api/profile?cb=7'])
  })

  it('reports the ledger without recording the reading of it', () => {
    const state = createState()

    get('/api/profile', state)

    expect(parse(get(CONTROL_PATHS.log, state))['log']).toEqual(['GET /api/profile'])
    expect(state.log).toEqual(['GET /api/profile'])
  })

  it('hands back a copy, so a caller cannot edit the ledger it just read', () => {
    const state = createState()

    get('/api/profile', state)
    const reported = parse(get(CONTROL_PATHS.log, state))['log'] as string[]
    reported.push('GET /api/invented')

    expect(state.log).toEqual(['GET /api/profile'])
  })

  it('empties the ledger and the flaky flag together on a reset', () => {
    const state = createState()

    get('/api/flaky', state)
    respond({ method: 'POST', url: CONTROL_PATHS.reset, body: '' }, state)

    expect(state.log).toEqual([])
    expect(state.flakyServed).toBe(false)
  })

  it('leaves the control endpoints out of the recording entirely', () => {
    const state = createState()

    get(CONTROL_PATHS.log, state)
    respond({ method: 'POST', url: CONTROL_PATHS.reset, body: '' }, state)

    expect(state.log).toEqual([])
  })
})

describe('readWord', () => {
  it('reads the word out of a well-formed body', () => {
    expect(readWord(JSON.stringify({ word: 'ada' }))).toBe('ada')
  })

  it('returns the empty string for a body that is not JSON', () => {
    expect(readWord('{')).toBe('')
  })

  it('returns the empty string for JSON with no word', () => {
    expect(readWord(JSON.stringify({ phrase: 'ada' }))).toBe('')
  })

  it('returns the empty string when the word is not a string', () => {
    expect(readWord(JSON.stringify({ word: 42 }))).toBe('')
  })

  it('returns the empty string for a JSON value that is not an object', () => {
    expect(readWord('"ada"')).toBe('')
    expect(readWord('null')).toBe('')
  })
})
