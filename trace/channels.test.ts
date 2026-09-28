// @vitest-environment node
//
// The parser, against archives built line by line.
//
// `check.ts` runs it against eight real traces, which proves it works on what
// Playwright writes today and nothing about what it does with what Playwright
// writes tomorrow. These cases cover the other half: the shapes it must keep
// classifying, the shapes it must keep ignoring, and the malformed shapes it has
// to survive, because a parser that throws on an unexpected entry turns a
// changed trace format into a crash with no report instead of a red cell.

import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { CHANNEL_NAMES, readTrace, type Census } from './channels.ts'

/** A zip of NDJSON, stored uncompressed except where a case says otherwise. */
function pack(files: Readonly<Record<string, readonly unknown[] | string>>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  let entries = 0

  for (const [path, lines] of Object.entries(files)) {
    const content =
      typeof lines === 'string' ? lines : lines.map((line) => JSON.stringify(line)).join('\n')
    const raw = Buffer.from(content, 'utf8')
    const data = deflateRawSync(raw)
    const name = Buffer.from(path, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
    entries += 1
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries, 8)
  end.writeUInt16LE(entries, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}

const EMPTY: Census = {
  error: 0,
  actions: 0,
  snapshot: 0,
  network: 0,
  console: 0,
  pageerror: 0,
  source: 0,
}

const pageError = (message: string): unknown => ({
  type: 'event',
  class: 'BrowserContext',
  method: 'pageError',
  params: { error: { error: { message, name: 'TypeError' } } },
})

const resource = (method: string, url: string, status: number | null): unknown => ({
  type: 'resource-snapshot',
  snapshot: {
    request: { method, url },
    ...(status === null ? {} : { response: { status } }),
  },
})

describe('the census', () => {
  it('is all zeroes for an archive with no recordings in it', () => {
    expect(readTrace(pack({ 'resources/abc': 'not ndjson at all' })).census).toEqual(EMPTY)
  })

  it('counts one action per `before`, whether or not it completed', () => {
    const trace = readTrace(
      pack({
        '0-trace.trace': [
          { type: 'before', apiName: 'page.goto' },
          { type: 'after' },
          { type: 'before', apiName: 'locator.click' },
        ],
      }),
    )

    expect(trace.census.actions).toBe(2)
  })

  it('folds two browser contexts into one set of counts', () => {
    // A test that opens two contexts writes two of each file. An empty channel
    // is a claim about the test, not about one of its contexts.
    const trace = readTrace(
      pack({
        '0-trace.trace': [{ type: 'frame-snapshot' }],
        '1-trace.trace': [{ type: 'frame-snapshot' }, { type: 'frame-snapshot' }],
        '0-trace.network': [resource('GET', 'http://x/a', 200)],
        '1-trace.network': [resource('GET', 'http://x/b', 404)],
      }),
    )

    expect(trace.census.snapshot).toBe(3)
    expect(trace.census.network).toBe(2)
  })

  it('ignores files that are neither a trace nor a network log', () => {
    const trace = readTrace(
      pack({
        'resources/src@abc.txt': 'export const x = 1',
        'resources/page@abc-1.jpeg': 'not really a jpeg',
        '0-trace.trace': [{ type: 'before' }],
      }),
    )

    expect(trace.census.actions).toBe(1)
    expect(trace.census.source).toBe(0)
  })

  it('has a count for every channel the README publishes', () => {
    const trace = readTrace(pack({ '0-trace.trace': [{ type: 'before' }] }))

    expect(Object.keys(trace.census).sort()).toEqual([...CHANNEL_NAMES].sort())
  })
})

describe('the error', () => {
  it('strips the colour codes Playwright writes into the message', () => {
    const trace = readTrace(
      pack({
        'test.trace': [
          { type: 'error', message: 'Expected: \u001b[32m"1240"\u001b[39m\nReceived: ""' },
        ],
      }),
    )

    expect(trace.error).toBe('Expected: "1240"\nReceived: ""')
    expect(trace.census.error).toBe(1)
  })

  it('keeps the first of several, which is the one the viewer opens on', () => {
    const trace = readTrace(
      pack({
        'test.trace': [
          { type: 'error', message: 'first' },
          { type: 'error', message: 'second' },
        ],
      }),
    )

    expect(trace.error).toBe('first')
    expect(trace.census.error).toBe(1)
  })

  it('is null for a trace of a test that passed', () => {
    expect(readTrace(pack({ 'test.trace': [{ type: 'before' }] })).error).toBeNull()
  })
})

describe('requests', () => {
  it('records the status of an answered request', () => {
    const trace = readTrace(
      pack({ '0-trace.network': [resource('POST', 'http://x/api/save', 201)] }),
    )

    expect(trace.requests).toEqual([{ method: 'POST', url: 'http://x/api/save', status: 201 }])
  })

  it('records a request that never got an answer as -1', () => {
    // Playwright's own sentinel, and the whole of what the `hanging-api` row
    // rests on: the request is in the log, with no status.
    const trace = readTrace(pack({ '0-trace.network': [resource('GET', 'http://x/slow', null)] }))

    expect(trace.requests[0]?.status).toBe(-1)
  })

  it('skips an entry with no request in it rather than inventing one', () => {
    const trace = readTrace(pack({ '0-trace.network': [{ type: 'resource-snapshot' }] }))

    expect(trace.requests).toEqual([])
    expect(trace.census.network).toBe(0)
  })
})

describe('console messages', () => {
  it('keeps the type, the text and the URL', () => {
    const trace = readTrace(
      pack({
        '0-trace.trace': [
          {
            type: 'console',
            messageType: 'error',
            text: 'Failed to load resource: 500',
            location: { url: 'http://x/api/broken' },
          },
        ],
      }),
    )

    expect(trace.console).toEqual([
      { type: 'error', text: 'Failed to load resource: 500', url: 'http://x/api/broken' },
    ])
  })

  it('survives a message with no location', () => {
    const trace = readTrace(
      pack({ '0-trace.trace': [{ type: 'console', messageType: 'log', text: 'hello' }] }),
    )

    expect(trace.console[0]?.url).toBe('')
  })
})

describe('page errors', () => {
  it('unwraps the doubly nested message', () => {
    const trace = readTrace(pack({ '0-trace.trace': [pageError("reading 'format'")] }))

    expect(trace.pageErrors).toEqual(["reading 'format'"])
    expect(trace.census.pageerror).toBe(1)
  })

  it('ignores other context events', () => {
    const trace = readTrace(
      pack({
        '0-trace.trace': [
          { type: 'event', class: 'BrowserContext', method: 'page', params: {} },
          pageError('boom'),
        ],
      }),
    )

    expect(trace.pageErrors).toEqual(['boom'])
  })

  it('reads a page error whose payload is not the expected shape as empty text', () => {
    // Counted, but with nothing to show: a shape change should cost one wrong
    // cell in the table, not a crash with no report.
    const trace = readTrace(
      pack({ '0-trace.trace': [{ type: 'event', method: 'pageError', params: {} }] }),
    )

    expect(trace.pageErrors).toEqual([''])
    expect(trace.census.pageerror).toBe(1)
  })
})

describe('sources', () => {
  it('lists the first-party files the stacks point into, sorted and deduplicated', () => {
    const trace = readTrace(
      pack({
        '0-trace.stacks': JSON.stringify({ files: ['/repo/b.spec.ts', '/repo/a.spec.ts'] }),
        '1-trace.stacks': JSON.stringify({ files: ['/repo/a.spec.ts'] }),
      }),
    )

    expect(trace.sources).toEqual(['/repo/a.spec.ts', '/repo/b.spec.ts'])
    expect(trace.census.source).toBe(2)
  })

  it('reads a stacks file with no files in it as no sources', () => {
    // What `missing-env` produces: the file is there, and it names nothing,
    // because nothing first-party ever ran in the browser.
    const trace = readTrace(pack({ '0-trace.stacks': JSON.stringify({ stacks: [] }) }))

    expect(trace.sources).toEqual([])
    expect(trace.census.source).toBe(0)
  })
})

describe('the file list', () => {
  it('names every entry, for the report', () => {
    const trace = readTrace(
      pack({ 'test.trace': [{ type: 'before' }], 'resources/src@a.txt': 'x' }),
    )

    expect(trace.files).toEqual(['test.trace', 'resources/src@a.txt'])
  })
})
