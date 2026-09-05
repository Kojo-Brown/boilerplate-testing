/**
 * Compiling and loading one faulted copy of `ledger.ts`.
 *
 * The same pipeline `determinism/load.ts` uses, and for the same reasons: each
 * variant is the real source with its edits applied, written to a temporary
 * directory and imported, with Node stripping the types on the way in.
 * `@vite-ignore` matters — without it Vitest rewrites the dynamic import at
 * transform time and never reaches the generated file.
 *
 * `ledger.ts` imports nothing, which is why a copy on its own resolves. That is
 * not luck: it is why `createMutex` lives in the subject rather than in a module
 * beside it, and half of `faults.ts` edits those twenty lines.
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
import type { Subject } from './runtime.ts'

const SUBJECT_EXPORTS = ['createLedger', 'createMutex'] as const

const SOURCE_PATH = fileURLToPath(new URL('./ledger.ts', import.meta.url))

/** `ledger.ts` exactly as it sits on disk. */
export function ledgerSource(): string {
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
    const directory = mkdtempSync(join(tmpdir(), 'concurrency-variant-'))
    const file = join(directory, 'ledger.ts')

    writeFileSync(file, source)

    return asSubject(await import(/* @vite-ignore */ pathToFileURL(file).href), key)
  })()

  loaded.set(key, pending)

  return pending
}

/** The unedited source, through the same compile-and-import pipeline. */
export function loadControl(): Promise<Subject> {
  return load('control', ledgerSource())
}

export function loadFaulted(id: FaultId): Promise<Subject> {
  return load(id, applyEdits(ledgerSource(), faultNamed(id).edits))
}
