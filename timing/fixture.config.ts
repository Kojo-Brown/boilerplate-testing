/**
 * The fixture suite's config — the subject of the timing measurement.
 *
 * Its own config, and a `node` environment, because what `record.ts` records
 * is how long a suite takes. Loading the repository's jsdom setup would add a
 * fixed cost per file that has nothing to do with the fixture and would move
 * whenever that setup changed; running the fixture under the main config would
 * also mean its five files were collected by `pnpm test`, where they are the
 * subject rather than tests of anything.
 *
 * `fileParallelism: false` is the point of the file rather than an aside. With
 * workers running files concurrently, a file's measured duration includes
 * however much of a core it got, so the five durations move together and move
 * with whatever else is on the machine — the noise would be real but it would
 * be noise about the pool, not about the suite. Serial, each file's number is
 * its own work, which is the number a per-file budget claims to police.
 */
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Absolute, and derived from this file's own URL rather than left to
  // default to `process.cwd()`: the gate and the recorder both spawn Vitest
  // with this config from the repository root, where a relative `include`
  // matches nothing and a run that collects nothing still exits 0.
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['fixture/*.test.ts'],
    fileParallelism: false,
    // The recorded durations are the measurement; a reporter that redraws
    // them while they are being taken is noise in the thing being measured.
    reporters: ['json'],
  },
})
