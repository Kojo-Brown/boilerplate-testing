/**
 * Compiling and loading a variant of `render.ts`.
 *
 * Each variant is the real source with its edits applied, written to a
 * temporary directory and imported, with Node stripping the types on the way
 * in. `@vite-ignore` matters: without it Vitest rewrites the dynamic import at
 * transform time and never reaches the generated file.
 *
 * The control — the source compiled through the same pipeline with no edits —
 * is loaded the same way and checked first by `detection.test.ts`. Without it a
 * pipeline that changed behaviour on its own (a stripped type that was
 * load-bearing, a stale temporary file, a cached module) would make every
 * variant look caught and the whole matrix would be measuring the compiler.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { applyEdits, variantNamed, type VariantId } from './edits.ts'
import type { Order } from './render.ts'

/** The one function a variant has to expose for a probe to run against it. */
export type Renderer = (order: Order) => string

const SOURCE_PATH = fileURLToPath(new URL('./render.ts', import.meta.url))

export function renderSource(): string {
  return readFileSync(SOURCE_PATH, 'utf8')
}

function isRendererModule(value: unknown): value is { renderOrderSummary: Renderer } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).renderOrderSummary === 'function'
  )
}

const loaded = new Map<string, Promise<Renderer>>()

function load(key: string, source: string): Promise<Renderer> {
  const existing = loaded.get(key)

  if (existing !== undefined) {
    return existing
  }

  const pending = (async (): Promise<Renderer> => {
    const directory = mkdtempSync(join(tmpdir(), 'snapshot-variant-'))
    const file = join(directory, 'render.ts')

    writeFileSync(file, source)

    const module: unknown = await import(/* @vite-ignore */ pathToFileURL(file).href)

    if (!isRendererModule(module)) {
      throw new Error(`compiled variant ${key} does not export renderOrderSummary`)
    }

    return module.renderOrderSummary
  })()

  loaded.set(key, pending)

  return pending
}

/** `render.ts` through the compile-and-import pipeline, unedited. */
export function loadControl(): Promise<Renderer> {
  return load('control', renderSource())
}

export function loadVariant(id: VariantId): Promise<Renderer> {
  return load(id, applyEdits(renderSource(), variantNamed(id).edits))
}
