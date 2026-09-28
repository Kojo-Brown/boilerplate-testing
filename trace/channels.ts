/**
 * A trace zip, read as the seven channels the Trace Viewer shows.
 *
 * The viewer's panes are not seven views of one log. They are seven separate
 * recordings that happen to share a timeline, written by two different
 * processes, and a trace can be rich in one and empty in another. That is the
 * whole subject of this directory: a test that failed because an endpoint
 * answered 500 has a complete network recording and an empty console, and
 * somebody who only reads the red action at the top of the viewer will conclude
 * the locator is wrong.
 *
 * ---------------------------------------------------------------------------
 * The file layout, which is not documented and not stable
 * ---------------------------------------------------------------------------
 * Playwright makes no promise about the inside of a trace zip, so everything
 * below is what version 1.62.1 actually writes, read off real archives:
 *
 *   test.trace          the runner's own recording: the step tree, and one
 *                       `error` entry per failure with the spec's file and line
 *   <n>-trace.trace     the browser recording: actions, `log` lines, DOM
 *                       snapshots, console messages, screencast frames, and
 *                       `event` entries for everything the context emitted
 *   <n>-trace.network   `resource-snapshot` entries, HAR-shaped
 *   <n>-trace.stacks    the first-party files the stacks point into
 *   resources/          snapshot bodies, screencast JPEGs, and `src@…` — the
 *                       text of those first-party files
 *
 * The number prefix is per browser context, so a test that opens two contexts
 * writes two of each. {@link readTrace} folds them together, because a channel
 * being empty is a claim about the test rather than about one of its contexts.
 *
 * This is why `check.ts` is a gate and not a comment: when a release changes
 * any of the above, the parse degrades to zeroes, the zeroes disagree with the
 * table `README.md` publishes, and the build goes red on the run after the
 * upgrade rather than on the day somebody relies on a stale guide.
 */

import { readZip } from './zip.ts'

/** The seven channels, in the order `README.md`'s table lists them. */
export const CHANNEL_NAMES = [
  'error',
  'actions',
  'snapshot',
  'network',
  'console',
  'pageerror',
  'source',
] as const

export type ChannelName = (typeof CHANNEL_NAMES)[number]

/** What each channel is, for the table's header and for the reader. */
export const CHANNEL_DESCRIPTIONS: Readonly<Record<ChannelName, string>> = {
  error: 'the failure message and its call log',
  actions: 'the action and step list',
  snapshot: 'DOM snapshots either side of each action',
  network: 'requests and responses',
  console: 'messages the page logged',
  pageerror: 'uncaught exceptions inside the page',
  source: 'first-party source, embedded',
}

/** How many entries each channel holds, and what they say. */
export type Census = Readonly<Record<ChannelName, number>>

/** Everything the parse recovered, beyond the counts. */
export type Trace = {
  /** Entry counts per channel. */
  readonly census: Census
  /** The failure message, ANSI stripped, or `null` for a trace of a pass. */
  readonly error: string | null
  /** Every request's method, URL and status. */
  readonly requests: readonly Request[]
  /** Every console message's type and text. */
  readonly console: readonly ConsoleMessage[]
  /** Every uncaught page exception's message. */
  readonly pageErrors: readonly string[]
  /** The first-party files whose text the trace embeds. */
  readonly sources: readonly string[]
  /** Names of the zip's own entries, for `check.ts`'s report. */
  readonly files: readonly string[]
}

export type Request = {
  readonly method: string
  readonly url: string
  /**
   * `-1` when the request never got an answer, which is what a hang looks like.
   * Playwright's own sentinel, not this parser's: `hanging-api` is how it was
   * found, and `check.ts` asserts it rather than assuming a 0.
   */
  readonly status: number
}

export type ConsoleMessage = {
  readonly type: string
  readonly text: string
  /**
   * Where the message came from.
   *
   * Kept because without it the browser's own subresource-failure message —
   * `Failed to load resource: … 500` — names a status and no resource, and the
   * `failing-api` row of the evidence table claims that message identifies the
   * cause. With the URL it does; the claim needs the field to be true.
   */
  readonly url: string
}

/**
 * The colour codes Playwright writes into the error message it records.
 *
 * They are in the trace because the message is the same string the terminal
 * reporter prints. Stripped here so that a `README.md` assertion about the text
 * of an error is about the text rather than about SGR parameters.
 */
// eslint-disable-next-line no-control-regex -- Matching an escape sequence is the point.
const ANSI = /\u001b\[[0-9;]*m/g

/** One NDJSON line of a `.trace` or `.network` file. */
type Entry = {
  readonly type?: string
  readonly method?: string
  readonly class?: string
  readonly message?: string
  readonly messageType?: string
  readonly text?: string
  readonly params?: Record<string, unknown>
  readonly snapshot?: Record<string, unknown>
  readonly apiName?: string
}

function parseNdjson(bytes: Buffer): readonly Entry[] {
  const entries: Entry[] = []

  for (const line of bytes.toString('utf8').split('\n')) {
    if (line.trim() === '') {
      continue
    }

    entries.push(JSON.parse(line) as Entry)
  }

  return entries
}

/** Reads one trace zip. */
export function readTrace(bytes: Buffer): Trace {
  const zip = readZip(bytes)
  const files = zip.map((entry) => entry.name)

  let error: string | null = null
  let actions = 0
  let snapshots = 0
  const requests: Request[] = []
  const messages: ConsoleMessage[] = []
  const pageErrors: string[] = []
  const sources = new Set<string>()

  for (const file of zip) {
    if (file.name.endsWith('.stacks')) {
      const stacks = JSON.parse(file.bytes.toString('utf8')) as { files?: readonly string[] }

      for (const path of stacks.files ?? []) {
        sources.add(path)
      }

      continue
    }

    if (!file.name.endsWith('.trace') && !file.name.endsWith('.network')) {
      continue
    }

    for (const entry of parseNdjson(file.bytes)) {
      if (entry.type === 'error' && typeof entry.message === 'string') {
        // The runner records one `error` per failure. The first is the one the
        // viewer opens on and the one a reader is looking at.
        error ??= entry.message.replace(ANSI, '')

        continue
      }

      if (entry.type === 'before') {
        // `before`/`after` bracket one action. Counting `before` counts actions
        // whether or not they completed — and the action that did not complete
        // is the failing one.
        actions += 1

        continue
      }

      if (entry.type === 'frame-snapshot') {
        snapshots += 1

        continue
      }

      if (entry.type === 'console') {
        messages.push({
          type: String(entry.messageType ?? ''),
          text: String(entry.text ?? ''),
          url: readConsoleUrl(entry),
        })

        continue
      }

      if (entry.type === 'event' && entry.method === 'pageError') {
        pageErrors.push(readPageError(entry))

        continue
      }

      if (entry.type === 'resource-snapshot') {
        const request = readRequest(entry)

        if (request !== null) {
          requests.push(request)
        }
      }
    }
  }

  return {
    census: {
      error: error === null ? 0 : 1,
      actions,
      snapshot: snapshots,
      network: requests.length,
      console: messages.length,
      pageerror: pageErrors.length,
      source: sources.size,
    },
    error,
    requests,
    console: messages,
    pageErrors,
    sources: [...sources].sort(),
    files,
  }
}

/**
 * The message out of a `pageError` event.
 *
 * Doubly nested — `params.error.error.message` — because the event carries a
 * serialised `Error` inside a wrapper. Read defensively rather than asserted,
 * so that a shape change costs a wrong count in one row of the table instead of
 * a crash with no report.
 */
function readPageError(entry: Entry): string {
  const outer = entry.params?.['error']

  if (typeof outer !== 'object' || outer === null) {
    return ''
  }

  const inner = (outer as Record<string, unknown>)['error']

  if (typeof inner !== 'object' || inner === null) {
    return ''
  }

  const message = (inner as Record<string, unknown>)['message']

  return typeof message === 'string' ? message : ''
}

function readConsoleUrl(entry: Entry): string {
  const location = (entry as { location?: unknown }).location

  if (typeof location !== 'object' || location === null) {
    return ''
  }

  const url = (location as Record<string, unknown>)['url']

  return typeof url === 'string' ? url : ''
}

function readRequest(entry: Entry): Request | null {
  const snapshot = entry.snapshot

  if (snapshot === undefined) {
    return null
  }

  const request = snapshot['request']
  const response = snapshot['response']

  if (typeof request !== 'object' || request === null) {
    return null
  }

  const { method, url } = request as Record<string, unknown>
  const status =
    typeof response === 'object' && response !== null
      ? (response as Record<string, unknown>)['status']
      : -1

  return {
    method: typeof method === 'string' ? method : '',
    url: typeof url === 'string' ? url : '',
    status: typeof status === 'number' ? status : -1,
  }
}
