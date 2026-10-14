/**
 * Loading the quarantine registry.
 *
 * Separated from `quarantine.ts` so that everything deciding anything is pure
 * and testable against registries that are not this repository's — and so that
 * the fixture can be pointed at its own file through `FLAKE_REGISTRY` without
 * the runtime helper knowing it is in a fixture.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseRegistry, type Registry } from './quarantine.ts'

export const EMPTY_REGISTRY: Registry = { version: 1, entries: [] }

/**
 * Where the registry lives.
 *
 * A function rather than a constant, and defensive about `import.meta.url`,
 * for one reason: `@/vitest/flaky` imports this module, and that helper is
 * meant to be imported by any test file in a project — including the jsdom
 * ones, where Vitest's `import.meta.url` is an `http:` URL that
 * `fileURLToPath` refuses. Resolving at module scope made importing the
 * quarantine helper throw in exactly the suites most likely to need it.
 */
export function registryPath(): string {
  const url = import.meta.url

  return url.startsWith('file:')
    ? fileURLToPath(new URL('./quarantine.json', url))
    : join(process.cwd(), 'flake/quarantine.json')
}

/**
 * Read the registry.
 *
 * A missing file is an empty registry rather than an error: a project that
 * copies this directory and has nothing quarantined should not have to create
 * a file to say so. A *malformed* file is an error, because the failure mode
 * of guessing there is that a quarantined test is silently back in the suite.
 */
export function loadRegistry(path: string = process.env['FLAKE_REGISTRY'] ?? registryPath()): Registry {
  if (!existsSync(path)) return EMPTY_REGISTRY

  return parseRegistry(readFileSync(path, 'utf8'))
}
