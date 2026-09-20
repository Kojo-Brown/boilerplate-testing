/**
 * The committed recording, and the little that needs to be known about its
 * shape.
 *
 * A HAR is a JSON document with an unusually large surface, and almost none of
 * it matters here: `recordHarMode: 'minimal'` drops timings, sizes, page
 * records and cookies precisely because a replayer does not read them. What is
 * left is a list of request/response pairs, and the four accessors below are
 * everything `har.test.ts` and the specs ask of it.
 *
 * The types are written out rather than imported from a HAR package for the
 * reason `workflow-templates/actionPins.ts` parses YAML by hand: a dependency
 * whose only job is to describe a file this repository writes and reads would
 * be a third opinion about that file's shape.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Where the committed recording lives. */
export const HAR_PATH = fileURLToPath(new URL('./har/origin.har', import.meta.url))

/** A HAR name/value pair, which is how the format records every header. */
export interface HarHeader {
  readonly name: string
  readonly value: string
}

export interface HarEntry {
  readonly request: {
    readonly method: string
    readonly url: string
    readonly headers?: readonly HarHeader[]
    readonly postData?: { readonly text?: string }
  }
  readonly response: {
    readonly status: number
    readonly headers?: readonly HarHeader[]
    readonly content: { readonly text?: string; readonly mimeType?: string }
  }
}

export interface Har {
  readonly log: { readonly entries: readonly HarEntry[] }
}

/** Parse the committed recording. */
export function readHar(path: string = HAR_PATH): Har {
  return JSON.parse(readFileSync(path, 'utf8')) as Har
}

/** The path and query of an entry's URL, with the origin stripped. */
export const pathOf = (entry: HarEntry): string => new URL(entry.request.url).pathname

/** Every entry for one method and path, in the order they were recorded. */
export const entriesFor = (har: Har, method: string, path: string): readonly HarEntry[] =>
  har.log.entries.filter((entry) => entry.request.method === method && pathOf(entry) === path)

/** `METHOD /path` for every entry, which is the form the assertions read in. */
export const signatures = (har: Har): readonly string[] =>
  har.log.entries.map((entry) => `${entry.request.method} ${pathOf(entry)}`)

/** An entry's body parsed as JSON, or `null` when it holds none or is not JSON. */
export function bodyOf(entry: HarEntry): unknown {
  const text = entry.response.content.text

  if (text === undefined) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Every header name in the recording, on both sides of every entry, lower-cased.
 *
 * The recording is a committed artefact of real traffic, which is the shape of
 * file a credential ends up in by accident. `har.test.ts` reads this and fails
 * on anything that carries one; the fixture origin has no auth of any kind, so
 * the assertion is a guard on the recorder rather than a cleanup step.
 */
export const headerNames = (har: Har): readonly string[] => [
  ...new Set(
    har.log.entries.flatMap((entry) =>
      [...(entry.request.headers ?? []), ...(entry.response.headers ?? [])].map((header) =>
        header.name.toLowerCase(),
      ),
    ),
  ),
]
