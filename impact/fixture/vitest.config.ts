/**
 * The fixture's own runner.
 *
 * `root` is stated rather than inferred because every measured run addresses
 * this file by path from the repository root — and from a *copy* of this
 * directory under `impact/.runs/`, which is how a fault is applied without
 * touching the subject. Vitest's root defaults to the working directory, so
 * without this line a run of the copy would collect the original.
 */

import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    root: here,
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Only the files a run actually loaded. The whole point of the coverage
      // column in the matrix is that it records what executed, including the
      // modules `rules/registry.ts` loads by name at run time; `all: true`
      // would add every file on disk and make the column unable to tell the
      // difference.
      all: false,
      reporter: ['json'],
    },
  },
})
