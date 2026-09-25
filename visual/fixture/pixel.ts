/**
 * A PNG of one flat colour, encoded by hand.
 *
 * The lifecycle measurement needs real image baselines on a real disk, and it
 * deliberately needs them *without a browser*: what `--update-snapshots` does
 * to a file is decided by Playwright's runner, not by anything that renders,
 * so making that half depend on a browser download would be paying for an
 * engine to establish a fact about the filesystem. Encoding the twenty bytes
 * by hand is cheaper than either a headless Chromium or a dependency, and it
 * keeps `lifecycle.test.ts` in `pnpm test` on every Node major.
 *
 * The encoder is deliberately the dullest possible one — 8-bit truecolour, no
 * filtering, one IDAT — because nothing here is a claim about PNG. It only has
 * to be a file the comparator will read as an image and call equal to itself.
 */

import { deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The dimensions every fixture baseline uses. Small on purpose: nothing reads them. */
export const PIXEL_SIZE = { width: 4, height: 4 } as const

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)

  for (let index = 0; index < 256; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1
    }

    table[index] = value >>> 0
  }

  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff

  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  }

  return (crc ^ 0xffff_ffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(typed))

  return Buffer.concat([length, typed, checksum])
}

/** Parse `#rrggbb` into three channel values. */
export function channels(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)

  if (!match) {
    throw new Error(`not a six-digit hex colour: ${hex}`)
  }

  return [
    Number.parseInt(match[1] as string, 16),
    Number.parseInt(match[2] as string, 16),
    Number.parseInt(match[3] as string, 16),
  ]
}

/** A {@link PIXEL_SIZE} PNG filled with `hex`. */
export function flatPng(hex: string): Buffer {
  const [red, green, blue] = channels(hex)
  const { width, height } = PIXEL_SIZE

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  const row = Buffer.concat([
    Buffer.from([0]), // filter type: none
    ...Array.from({ length: width }, () => Buffer.from([red, green, blue])),
  ])

  const raw = Buffer.concat(Array.from({ length: height }, () => row))

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
