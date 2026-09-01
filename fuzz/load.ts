/**
 * Compiling and loading a variant of `config.ts`.
 *
 * Each variant is the real source with its edits applied, written to a
 * temporary directory and imported, with Node stripping the types on the way
 * in. `@vite-ignore` matters: without it Vitest rewrites the dynamic import at
 * transform time and never reaches the generated file.
 *
 * The control — the source compiled through the same pipeline with no edits —
 * is loaded the same way and checked first by `detection.test.ts`. Without it
 * a pipeline that changed behaviour by itself would make every variant look
 * caught, and the matrix would be a measurement of Node's type stripping.
 *
 * ---------------------------------------------------------------------------
 * Why the subject is an interface rather than a module namespace
 * ---------------------------------------------------------------------------
 * There are seventeen copies of `config.ts` alive during a run, and a
 * `JsonParseError` thrown by one of them is not an `instanceof` the class
 * exported by another. Every probe therefore receives a `Subject` — three
 * functions and nothing else — and recognises a parse failure structurally.
 * That constraint is not an artefact of the harness: it is the same constraint
 * anyone has who catches an error across a package boundary, and code that
 * only works because both sides share a class identity is code that breaks the
 * first time a duplicate copy of a dependency is installed.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { applyEdits, variantNamed, type VariantId } from './edits.ts'
import type { Json, LoadResult, ValidationResult } from './config.ts'

/** The three functions a probe may call on a subject. */
export interface Subject {
  readonly parseJson: (text: string) => Json
  readonly validateConfig: (value: unknown) => ValidationResult
  readonly loadConfig: (text: string) => LoadResult
}

const SOURCE_PATH = fileURLToPath(new URL('./config.ts', import.meta.url))

export function configSource(): string {
  return readFileSync(SOURCE_PATH, 'utf8')
}

function isSubjectModule(value: unknown): value is Subject {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const module = value as Record<string, unknown>

  return (
    typeof module.parseJson === 'function' &&
    typeof module.validateConfig === 'function' &&
    typeof module.loadConfig === 'function'
  )
}

const loaded = new Map<string, Promise<Subject>>()

function load(key: string, source: string): Promise<Subject> {
  const existing = loaded.get(key)

  if (existing !== undefined) {
    return existing
  }

  const pending = (async (): Promise<Subject> => {
    const directory = mkdtempSync(join(tmpdir(), 'fuzz-variant-'))
    const file = join(directory, 'config.ts')

    writeFileSync(file, source)

    const module: unknown = await import(/* @vite-ignore */ pathToFileURL(file).href)

    if (!isSubjectModule(module)) {
      throw new Error(`compiled variant ${key} does not export the three subject functions`)
    }

    return { parseJson: module.parseJson, validateConfig: module.validateConfig, loadConfig: module.loadConfig }
  })()

  loaded.set(key, pending)

  return pending
}

/** `config.ts` through the compile-and-import pipeline, unedited. */
export function loadControl(): Promise<Subject> {
  return load('control', configSource())
}

export function loadVariant(id: VariantId): Promise<Subject> {
  return load(id, applyEdits(configSource(), variantNamed(id).edits))
}
