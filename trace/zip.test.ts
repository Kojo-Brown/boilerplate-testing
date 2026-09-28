// @vitest-environment node
//
// The reader, against archives this file builds byte by byte.
//
// A zip writer in a test file looks like overkill until you notice what the
// alternative is: committing a binary fixture, which makes the one thing this
// reader is for — surviving a change in how Playwright writes traces —
// untestable, because the fixture would never change either. Built here, each
// archive states its own layout, and the two compression methods, the deferred
// sizes a streaming writer leaves in the local header, and every refusal are
// separate cases.

import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { readZip } from './zip.ts'

type Source = {
  readonly name: string
  readonly content: string
  /** `true` to deflate, `false` to store. */
  readonly compress: boolean
  /**
   * `true` to write zeroes for the sizes in the *local* header and leave the
   * real ones in the central directory, the way a streaming writer does.
   */
  readonly deferSizes?: boolean
}

/**
 * A zip, assembled the way the format specifies.
 *
 * Deliberately not a general writer: no zip64, no data descriptors, no
 * timestamps, CRCs left at zero because the reader does not check them. It
 * produces exactly the archives the cases below need.
 */
function buildZip(sources: readonly Source[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const source of sources) {
    const raw = Buffer.from(source.content, 'utf8')
    const data = source.compress ? deflateRawSync(raw) : raw
    const name = Buffer.from(source.name, 'utf8')
    const method = source.compress ? 8 : 0
    const declared = source.deferSizes === true ? 0 : data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(source.deferSizes === true ? 0x08 : 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(declared, 18)
    local.writeUInt32LE(source.deferSizes === true ? 0 : raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(sources.length, 8)
  end.writeUInt16LE(sources.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}

const read = (sources: readonly Source[]): ReadonlyMap<string, string> =>
  new Map(readZip(buildZip(sources)).map((entry) => [entry.name, entry.bytes.toString('utf8')]))

describe('reading an archive', () => {
  it('reads a stored entry', () => {
    expect(read([{ name: 'a.trace', content: '{"type":"before"}', compress: false }])).toEqual(
      new Map([['a.trace', '{"type":"before"}']]),
    )
  })

  it('inflates a deflated entry', () => {
    // Long enough that deflate is smaller than the input, so the case is really
    // testing decompression rather than a stored fallback.
    const content = '{"type":"console","text":"repeated"}\n'.repeat(40)

    expect(read([{ name: 'b.trace', content, compress: true }]).get('b.trace')).toBe(content)
  })

  it('reads several entries, mixing both methods', () => {
    const entries = read([
      { name: 'test.trace', content: 'first', compress: false },
      { name: '0-trace.trace', content: 'second'.repeat(30), compress: true },
      { name: '0-trace.network', content: 'third', compress: false },
    ])

    expect([...entries.keys()]).toEqual(['test.trace', '0-trace.trace', '0-trace.network'])
    expect(entries.get('test.trace')).toBe('first')
    expect(entries.get('0-trace.network')).toBe('third')
  })

  it('finds the data when the local header defers its sizes', () => {
    // What a streaming writer emits, and what Playwright's does. The sizes are
    // read from the central directory; a reader that trusted the local header
    // would return nothing here.
    const entries = read([
      { name: 'streamed.trace', content: 'deferred', compress: false, deferSizes: true },
    ])

    expect(entries.get('streamed.trace')).toBe('deferred')
  })

  it('skips directory entries', () => {
    const entries = read([
      { name: 'resources/', content: '', compress: false },
      { name: 'resources/src@abc.txt', content: 'source', compress: false },
    ])

    expect([...entries.keys()]).toEqual(['resources/src@abc.txt'])
  })

  it('reads an empty archive as no entries', () => {
    expect(readZip(buildZip([]))).toEqual([])
  })
})

describe('refusals', () => {
  it('rejects bytes that are not a zip', () => {
    expect(() => readZip(Buffer.from('PK not really', 'utf8'))).toThrow(/Not a zip archive/)
  })

  it('rejects a truncated archive', () => {
    const whole = buildZip([{ name: 'a.trace', content: 'x', compress: false }])

    expect(() => readZip(whole.subarray(0, whole.length - 8))).toThrow(/Not a zip archive/)
  })

  it('rejects a compression method it has not been shown', () => {
    const whole = buildZip([{ name: 'a.trace', content: 'x', compress: false }])
    // Method 12 is bzip2. Patched into both headers so the archive is
    // internally consistent and the refusal is about the method.
    whole.writeUInt16LE(12, 8)
    whole.writeUInt16LE(12, whole.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10)

    expect(() => readZip(whole)).toThrow(/Unsupported compression method 12/)
  })

  it('rejects a zip64 archive rather than misreading its offsets', () => {
    const whole = buildZip([{ name: 'a.trace', content: 'x', compress: false }])
    const end = whole.length - 22
    whole.writeUInt32LE(0xffffffff, end + 16)

    expect(() => readZip(whole)).toThrow(/zip64/)
  })

  it('rejects a central directory whose offset points at nothing', () => {
    const whole = buildZip([{ name: 'a.trace', content: 'x', compress: false }])
    whole.writeUInt32LE(4, whole.length - 22 + 16)

    expect(() => readZip(whole)).toThrow(/Corrupt central directory/)
  })
})
