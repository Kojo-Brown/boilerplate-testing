/**
 * Compiling and loading one faulted copy of `session.ts`.
 *
 * Each variant is the real source with its edits applied, written to a
 * temporary directory and imported, with Node stripping the types on the way
 * in. `@vite-ignore` matters: without it Vitest rewrites the dynamic import at
 * transform time and never reaches the generated file.
 *
 * `session.ts` imports only a type from `environment.ts`, and a type-only
 * import is erased along with the types, so a copy in a temporary directory
 * resolves nothing and needs no files copied alongside it. That is not luck —
 * it is why the {@link Subject} interface below is six functions rather than a
 * module namespace, and why the constants stay in the original module where
 * both the probes and the copy can see the same values.
 *
 * The control — the source through the same pipeline with no edits — is loaded
 * the same way and is checked first by `detection.test.ts`. Without it, a
 * pipeline that changed behaviour by itself would make every variant look
 * caught and the matrix would be a measurement of Node's type stripping.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { applyEdits, faultNamed, type FaultId } from './faults.ts'
import type { Environment } from './environment.ts'
import type { ScheduledRefresh, Session, Timed } from './session.ts'

/** Everything a probe may call on a subject. */
export interface Subject {
  readonly issue: (env: Environment, userId: string) => Session
  readonly isExpired: (env: Environment, session: Session) => boolean
  readonly refreshDelayMs: (env: Environment) => number
  readonly scheduleRefresh: (
    env: Environment,
    session: Session,
    onRefresh: (session: Session) => void,
  ) => ScheduledRefresh
  readonly renew: (env: Environment, session: Session) => Session
  readonly timed: <T>(env: Environment, fn: () => T) => Timed<T>
}

const SUBJECT_EXPORTS = [
  'issue',
  'isExpired',
  'refreshDelayMs',
  'scheduleRefresh',
  'renew',
  'timed',
] as const

const SOURCE_PATH = fileURLToPath(new URL('./session.ts', import.meta.url))

/** `session.ts` exactly as it sits on disk. */
export function sessionSource(): string {
  return readFileSync(SOURCE_PATH, 'utf8')
}

function asSubject(value: unknown, key: string): Subject {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`compiled variant ${key} did not produce a module`)
  }

  const module = value as Record<string, unknown>
  const missing = SUBJECT_EXPORTS.filter((name) => typeof module[name] !== 'function')

  if (missing.length > 0) {
    throw new Error(`compiled variant ${key} is missing: ${missing.join(', ')}`)
  }

  return module as unknown as Subject
}

const loaded = new Map<string, Promise<Subject>>()

function load(key: string, source: string): Promise<Subject> {
  const existing = loaded.get(key)

  if (existing !== undefined) {
    return existing
  }

  const pending = (async (): Promise<Subject> => {
    const directory = mkdtempSync(join(tmpdir(), 'determinism-variant-'))
    const file = join(directory, 'session.ts')

    writeFileSync(file, source)

    return asSubject(await import(/* @vite-ignore */ pathToFileURL(file).href), key)
  })()

  loaded.set(key, pending)

  return pending
}

/** The unedited source, through the same compile-and-import pipeline. */
export function loadControl(): Promise<Subject> {
  return load('control', sessionSource())
}

export function loadFaulted(id: FaultId): Promise<Subject> {
  return load(id, applyEdits(sessionSource(), faultNamed(id).edits))
}
