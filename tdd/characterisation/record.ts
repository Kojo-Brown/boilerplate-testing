/**
 * Re-record the golden master.
 *
 *     pnpm characterise:record
 *
 * Run this exactly twice in the life of a characterisation exercise: once at
 * the start, against the code as inherited, and again if you deliberately
 * change behaviour afterwards — in which case the diff on
 * `golden-master.json` is the change, and reviewing it is the point of the
 * whole arrangement.
 *
 * What this must never become is a step people run when the suite goes red.
 * A recording refreshed to match whatever the code now does is not a test;
 * it is a very slow way of asserting that the code equals itself. That is the
 * standing failure mode of `toMatchSnapshot()` with `--update` in easy reach,
 * and the reason the recording here is a plain committed file with a script
 * that is inconvenient to reach for: the only honest reason to re-run it is
 * one you can write in a commit message.
 *
 * Imports carry `.ts` extensions because Node runs this file directly, with
 * its own type stripping and its own resolver. Everything else under this
 * folder is loaded through Vite and keeps the extensionless form.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { CORPUS, fingerprint } from './corpus.ts'
import { observeAll } from './observe.ts'
import * as legacy from './legacy/renewal.ts'

const target = fileURLToPath(new URL('./golden-master.json', import.meta.url))

const master = {
  recordedFrom: 'legacy/renewal.ts',
  fingerprint: fingerprint(CORPUS),
  caseCount: CORPUS.length,
  cases: observeAll(legacy, CORPUS),
}

writeFileSync(target, `${JSON.stringify(master, null, 2)}\n`)

console.log(`recorded ${CORPUS.length} cases at fingerprint ${master.fingerprint}`)
