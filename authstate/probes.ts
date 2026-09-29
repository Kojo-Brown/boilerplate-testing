/**
 * What is asked of a context built from a saved storage state.
 *
 * Seven probes in two families, and keeping the families apart is the honest
 * part. Four ask what the file *contains*, which is a question about
 * `storageState`. Three ask whether an application would consider the restored
 * browser signed in, which is a question about the application — and the whole
 * argument of this directory is that those are different questions with
 * different answers, so they get different verdict vocabularies rather than a
 * shared "pass".
 *
 * Every probe runs against a *fresh* context created with
 * `browser.newContext({ storageState: file })`. Nothing is asked of the context
 * that did the signing in: that one has the session in memory and would report
 * every wiring as perfect, which is exactly the mistake a suite makes when it
 * asserts its own setup rather than what the setup saved.
 */

/** Which question a probe asks, and therefore which verdicts it may return. */
export type ProbeFamily = 'storage' | 'gate'

/** A verdict from a storage probe: is the credential in the restored context at all? */
export type StorageVerdict = 'present' | 'absent'

/** A verdict from a gate probe: would the application consider this browser signed in? */
export type GateVerdict = 'signed-in' | 'signed-out'

export type Verdict = StorageVerdict | GateVerdict

export const STORAGE_VERDICTS: readonly StorageVerdict[] = ['present', 'absent']
export const GATE_VERDICTS: readonly GateVerdict[] = ['signed-in', 'signed-out']

export interface Probe {
  readonly key: string
  readonly family: ProbeFamily
  /** One line for the table header. */
  readonly asks: string
  /** Why the answer is worth a column of its own. */
  readonly matters: string
}

export const PROBES: readonly Probe[] = [
  {
    key: 'cookie',
    family: 'storage',
    asks: 'Is the `HttpOnly` session cookie in the restored context?',
    matters:
      'The one credential no page script could have read, and therefore the one no ' +
      'hand-written workaround could have saved. If `storageState` did not keep it, ' +
      'nothing else could.',
  },
  {
    key: 'local-storage',
    family: 'storage',
    asks: 'Is the token in `localStorage` for the origin?',
    matters:
      'Where most single-page applications keep an access token, and the store ' +
      '`storageState` is usually described as covering. It covers it per origin the ' +
      'context has state for, which is not the same as per origin the application uses.',
  },
  {
    key: 'session-storage',
    family: 'storage',
    asks: 'Is the token in `sessionStorage` for the origin?',
    matters:
      'The store teams move a token into when a security review objects to `localStorage`. ' +
      'Whether a capture keeps it is the question this column exists to answer.',
  },
  {
    key: 'indexed-db',
    family: 'storage',
    asks: 'Is the token in IndexedDB for the origin?',
    matters:
      'Where Firebase Authentication and several other SDKs keep a session. A team using ' +
      'one of them does not choose IndexedDB; their auth library chooses it for them.',
  },
  {
    key: 'server-gate',
    family: 'gate',
    asks: 'Does `/app/server` — a server-rendered page reading the cookie — render signed in?',
    matters:
      'The answer for a classic session-cookie application, where the browser holds no ' +
      'credential a script can see and the server decides on every navigation.',
  },
  {
    key: 'spa-gate',
    family: 'gate',
    asks: 'Does `/app/spa` — a page reading `localStorage` — render signed in?',
    matters:
      'The answer for a token-bearing single-page application. Same browser, same saved ' +
      'file, different verdict — which is the point of having both columns.',
  },
  {
    key: 'idb-gate',
    family: 'gate',
    asks: 'Does `/app/idb` — a page reading IndexedDB — render signed in?',
    matters:
      'The answer for an application whose auth SDK keeps the session in IndexedDB. It is ' +
      'the column that moves when one option is added to one call.',
  },
]

export const PROBE_KEYS: readonly string[] = PROBES.map((probe) => probe.key)

export function probeByKey(key: string): Probe {
  const probe = PROBES.find((candidate) => candidate.key === key)

  if (probe === undefined) {
    throw new Error(`No probe named ${JSON.stringify(key)}. Known: ${PROBE_KEYS.join(', ')}`)
  }

  return probe
}

/** Whether a verdict is one the probe's family is allowed to return. */
export function verdictFits(probe: Probe, verdict: Verdict): boolean {
  return probe.family === 'storage'
    ? (STORAGE_VERDICTS as readonly string[]).includes(verdict)
    : (GATE_VERDICTS as readonly string[]).includes(verdict)
}
