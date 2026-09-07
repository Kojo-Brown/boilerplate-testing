// @vitest-environment node
/**
 * The image table, audited — and the audit is the point of the table.
 *
 * Two rules, and neither is about a preference:
 *
 *   1. **No `latest`, no bare major.** A container image is a dependency with
 *      no lockfile. `postgres:latest` and `postgres:17` both resolve to
 *      whatever was pushed most recently, so a suite pinned to either can go
 *      red on a morning nobody committed anything — and what moves inside a
 *      major is exactly what a test depends on: the entrypoint's startup
 *      sequence, the log lines a wait strategy matches, whether the image
 *      ships a `HEALTHCHECK`.
 *   2. **One place names an image.** `images.ts` is the only file allowed to
 *      contain one, and `stores.ts` is the only file allowed to construct a
 *      container. Without that, the table is a suggestion: the next suite that
 *      needs a slightly different Postgres writes the string inline, and the
 *      pin nobody can see is the pin nobody updates.
 *
 * Both run in `pnpm test`, on every commit, with no container runtime.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { IMAGES, STORE_NAMES, TAG_RULES, imageFor, tagOf } from './images.ts'

const here = new URL('.', import.meta.url)
const directory = fileURLToPath(here)

const sources = readdirSync(directory)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file, text: readFileSync(fileURLToPath(new URL(file, here)), 'utf8') }))

describe('the image table', () => {
  it('names an image for every store, and no store the code does not have', () => {
    expect(Object.keys(IMAGES).sort()).toEqual([...STORE_NAMES].sort())
  })

  it('gives every pin a reason somebody can disagree with', () => {
    for (const store of STORE_NAMES) {
      expect(IMAGES[store].why.length).toBeGreaterThan(40)
    }
  })

  it('pins every image to something more specific than a moving tag', () => {
    for (const store of STORE_NAMES) {
      const image = imageFor(store)
      const tag = tagOf(image)

      expect(tag, `${image} carries no tag at all, so it resolves to :latest`).not.toBeNull()
      expect(TAG_RULES.noLatest.test(image), `${image} is pinned to a moving tag`).toBe(false)
      expect(TAG_RULES.noBareMajor.test(tag ?? ''), `${image} is pinned to a bare major`).toBe(false)
    }
  })
})

describe('the CI job', () => {
  // The workflow pulls the images ahead of the suites so that a registry
  // problem is reported as one. That means the tags exist in a second place,
  // which is exactly the drift `images.ts` was written to prevent — so the
  // second place is audited against the first rather than trusted.
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/ci.yml', here)), 'utf8')
  const pulled = [...workflow.matchAll(/^\s*docker pull (\S+)\s*$/gm)].map((match) => match[1])

  it('pulls every image the table names', () => {
    expect(pulled.sort()).toEqual(STORE_NAMES.map(imageFor).sort())
  })

  it('pulls no image the table does not name', () => {
    for (const image of pulled) {
      expect(STORE_NAMES.map(imageFor)).toContain(image)
    }
  })
})

describe('the rest of the directory', () => {
  it('names no container image outside images.ts', () => {
    const offenders = sources
      .filter(({ file }) => file !== 'images.ts' && file !== 'images.test.ts')
      .flatMap(({ file, text }) =>
        STORE_NAMES.filter((store) => text.includes(imageFor(store))).map(
          (store) => `${file} names ${imageFor(store)} directly instead of calling imageFor('${store}')`,
        ),
      )

    expect(offenders).toEqual([])
  })

  it('constructs a container in stores.ts and nowhere else', () => {
    const constructors = /new (?:GenericContainer|PostgreSqlContainer|RedisContainer|KafkaContainer)\(/

    const offenders = sources
      .filter(({ file }) => file !== 'stores.ts' && !file.endsWith('.test.ts'))
      .filter(({ text }) => constructors.test(text))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })
})
