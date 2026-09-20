// @vitest-environment node
//
// Reads the committed recording off disk and resolves it relative to
// `import.meta.url`. Under the project-default jsdom environment that URL is
// rewritten to an http: one and `fileURLToPath` throws.

/**
 * The committed recording, as a fixture that has to keep being wrong.
 *
 * `har/origin.har` is the only file in this repository whose value depends on
 * being *out of date*. Two of the twelve probes — `drifted-get` and
 * `unrecorded-get` — measure what a suite believes when its recording has
 * fallen behind the origin, and a re-record taken without thinking would erase
 * both of them and leave a green matrix that measures nothing.
 *
 * So the staleness is asserted rather than assumed. This suite fails if the
 * recording ever holds today's schema, or an entry for the endpoint it is
 * supposed to predate, and it fails with a sentence saying why the file is
 * meant to be old.
 */

import { describe, expect, it } from 'vitest'

import { bodyOf, entriesFor, headerNames, readHar, signatures, type HarEntry } from './har'
import { CURRENT_SCHEMA, ORIGIN_URL, RECORDED_SCHEMA, CONTROL_PATHS } from './origin'
import { RECORDED_WORD, SENT_WORD } from './probes'

const har = readHar()

/** The first recorded entry for a method and path, or a failure that names it.
 *
 * Throwing rather than returning `undefined` keeps every assertion below about
 * the entry's *contents*: a missing entry is already a failure of the two
 * suites above, and would otherwise be reported here as a type error about a
 * property of nothing.
 */
function entry(method: string, path: string): HarEntry {
  const [found] = entriesFor(har, method, path)

  if (found === undefined) {
    throw new Error(`the recording no longer holds ${method} ${path}`)
  }

  return found
}

describe('what the recording holds', () => {
  it('replays the document and its stylesheet, which is what makes a whole-page replay possible', () => {
    expect(signatures(har)).toContain('GET /')
    expect(signatures(har)).toContain('GET /assets/app.css')
  })

  it('holds the three API requests the matrix replays', () => {
    expect(signatures(har)).toContain('GET /api/profile')
    expect(signatures(har)).toContain('GET /api/feed')
    expect(signatures(har)).toContain('POST /api/echo')
  })

  it('holds both answers the flaky endpoint gave, in the order it gave them', () => {
    const flaky = entriesFor(har, 'GET', '/api/flaky')

    expect(flaky.map((recorded) => recorded.response.status)).toEqual([503, 200])
  })

  it('was recorded against one origin, whose port is baked into every URL', () => {
    // A HAR is matched by URL, and a URL contains a port. A recording taken
    // against an ephemeral port would replay against nothing, which is why
    // `ORIGIN_PORT` is fixed.
    for (const recorded of har.log.entries) {
      expect(recorded.request.url.startsWith(ORIGIN_URL), recorded.request.url).toBe(true)
    }
  })
})

describe('what the recording deliberately does not hold', () => {
  it('has no entry for the endpoint the `unrecorded-get` probe is about', () => {
    expect(signatures(har)).not.toContain('GET /api/notifications')
  })

  it('has no cache-busted URL, so the `query-variance` probe is a genuine miss', () => {
    for (const recorded of har.log.entries) {
      expect(recorded.request.url, 'a recorded URL carries a query string').not.toContain('?')
    }
  })

  it('has no control endpoint in it, because the page never asks for one', () => {
    for (const path of Object.values(CONTROL_PATHS)) {
      expect(signatures(har).some((signature) => signature.endsWith(path))).toBe(false)
    }
  })

  it('has never seen the word the specs post', () => {
    // The `post-echo` probe rests on this: the body the spec sends is one the
    // recording cannot match. If the recorder ever sent the same word, the
    // column would silently become a duplicate of `known-get`.
    expect(entry('POST', '/api/echo').request.postData?.text ?? '').not.toContain(SENT_WORD)
  })
})

describe('the recording is older than the origin, and that is the point', () => {
  it('was taken at a schema the origin no longer serves', () => {
    expect(RECORDED_SCHEMA).toBeLessThan(CURRENT_SCHEMA)
  })

  it('holds the feed at the recorded schema rather than at today’s', () => {
    expect(bodyOf(entry('GET', '/api/feed'))).toMatchObject({ schema: RECORDED_SCHEMA })
  })

  it('holds feed items in the old shape, which a consumer would read as undefined', () => {
    const { items } = bodyOf(entry('GET', '/api/feed')) as { items: unknown[] }

    expect(items.every((item) => typeof item === 'string')).toBe(true)
  })

  it('echoes the recorded word, upper-cased, exactly as the origin did then', () => {
    expect(bodyOf(entry('POST', '/api/echo'))).toMatchObject({
      echoed: RECORDED_WORD.toUpperCase(),
    })
  })
})

describe('the recording carries nothing it should not', () => {
  it('has no credential-shaped header on either side of any entry', () => {
    // A HAR is a transcript of real traffic and is the classic way a token
    // reaches a repository. The fixture origin has no authentication at all,
    // so this is a guard on the recorder rather than a cleanup: if it ever
    // fails, the recording was taken against something other than the fixture.
    const forbidden = ['authorization', 'cookie', 'set-cookie', 'proxy-authorization']

    expect(headerNames(har).filter((name) => forbidden.includes(name))).toEqual([])
  })

  it('records every body as text rather than as an opaque blob', () => {
    // `content: 'embed'`. A recording whose bodies are attachments is a
    // directory rather than a file, and the assertions above could not read it.
    for (const recorded of har.log.entries) {
      expect(typeof recorded.response.content.text, recorded.request.url).toBe('string')
    }
  })

  it('stays small enough to read in a diff', () => {
    // Not a performance budget: a recording nobody can review is a recording
    // nobody notices a credential in. Seven entries of a fixture origin come
    // to about 12KB.
    expect(JSON.stringify(har).length).toBeLessThan(64 * 1024)
  })
})
