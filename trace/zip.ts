/**
 * The 90 lines of ZIP reading this directory needs, and no dependency.
 *
 * A Playwright trace is a zip. Nothing else here can start until something can
 * open one, and the three obvious ways to get that capability are all worse
 * than writing it down:
 *
 *   - `unzip` on `PATH` makes the measurement depend on a binary that is not
 *     declared anywhere, is absent from most Windows machines, and reports
 *     failure as a number rather than an error.
 *   - `yauzl` is already in the store as somebody else's transitive
 *     dependency. Importing it without declaring it is the bug
 *     `shape/boundaries.ts` exists to catch, and declaring it adds a
 *     dependency for one call.
 *   - Playwright bundles a zip reader, under `playwright-core/lib/`. It is not
 *     exported, so reaching it means a deep import that its next patch
 *     release is free to move.
 *
 * So: the central directory, read backwards from the end-of-central-directory
 * record, and `inflateRawSync` for the one compression method Playwright's
 * writer emits. This is a reader for the zips *this* repository produces, not
 * a general one, and it says so by throwing on everything it has not been
 * shown to handle rather than guessing — an unknown compression method, a
 * zip64 archive, a comment between the record and the end of the file. A
 * misparse that returns plausible bytes would surface as a wrong cell in
 * `README.md`'s table with no hint of where it came from.
 */

import { inflateRawSync } from 'node:zlib'

/** Signature of the end-of-central-directory record. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

/** Signature of one central-directory file header. */
const CENTRAL_FILE_HEADER = 0x02014b50

/** The sentinel a zip64 archive writes where a 32-bit field would overflow. */
const ZIP64_SENTINEL = 0xffffffff

/** Stored — the bytes are the entry. */
const METHOD_STORE = 0

/** Deflate — the method Playwright's trace writer uses. */
const METHOD_DEFLATE = 8

/** One entry's name and its already-decompressed bytes. */
export type ZipEntry = {
  readonly name: string
  readonly bytes: Buffer
}

/**
 * Where the end-of-central-directory record starts.
 *
 * Scanned backwards because the record is last and variable-length: it ends
 * with a comment whose length it declares, so its position cannot be computed
 * from the file size. The 22 bytes are the record's own fixed size, and the
 * search stops there rather than at 0 so that a signature-shaped four bytes
 * inside the compressed data of a tiny archive cannot be mistaken for it.
 */
function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset
    }
  }

  throw new Error('Not a zip archive: no end-of-central-directory record')
}

/**
 * Every entry in the archive, decompressed.
 *
 * The central directory is walked rather than the local headers, because a
 * local header is allowed to carry zeroes for the sizes and defer them to a
 * data descriptor after the data — which is exactly what a streaming writer
 * like Playwright's does. The central directory always has the real numbers.
 */
export function readZip(buffer: Buffer): readonly ZipEntry[] {
  const end = findEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(end + 10)
  const directoryOffset = buffer.readUInt32LE(end + 16)

  if (directoryOffset === ZIP64_SENTINEL || entryCount === 0xffff) {
    throw new Error('zip64 archives are not supported by this reader')
  }

  const entries: ZipEntry[] = []
  let cursor = directoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
      throw new Error(`Corrupt central directory: bad header at entry ${String(index)}`)
    }

    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    // The local header repeats the name and carries its own extra field, whose
    // length differs from the central one's. Both have to be skipped to find
    // the data, and only the local header knows by how much.
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const data = buffer.subarray(dataStart, dataStart + compressedSize)

    // A directory entry, which a zip records as a name ending in `/` with no
    // data. Listing them would put `resources/` in the channel census.
    if (!name.endsWith('/')) {
      entries.push({ name, bytes: decompress(data, method, name) })
    }

    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function decompress(data: Buffer, method: number, name: string): Buffer {
  if (method === METHOD_STORE) {
    return Buffer.from(data)
  }

  if (method === METHOD_DEFLATE) {
    return inflateRawSync(data)
  }

  throw new Error(`Unsupported compression method ${String(method)} for entry ${name}`)
}
