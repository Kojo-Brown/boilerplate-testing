/**
 * Discount rules, loaded by name at run time.
 *
 * `loadRules` reads its own directory and imports whatever matches
 * `*.rule.ts`. No import statement names a rule file, so the rules are
 * invisible to any amount of static analysis — this is the plugin-directory
 * shape that `readdir` plus a computed specifier gives you, and it is common
 * enough (route tables, migrations, seeders, ESLint rule sets) that a
 * selection strategy which cannot cope with it will quietly skip real work.
 *
 * Coverage can see it, because coverage records what ran.
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { Line } from '../money.ts'

/** A discount rule. Each `*.rule.ts` in this directory exports one as `rule`. */
export interface Rule {
  readonly id: string
  readonly discountBasisPoints: (line: Line) => number
}

const RULES_DIRECTORY = fileURLToPath(new URL('.', import.meta.url))

export async function loadRules(): Promise<readonly Rule[]> {
  const entries = await readdir(RULES_DIRECTORY)
  const files = entries.filter((entry) => entry.endsWith('.rule.ts')).sort()
  const rules: Rule[] = []

  for (const file of files) {
    const loaded = (await import(pathToFileURL(join(RULES_DIRECTORY, file)).href)) as {
      rule?: Rule
    }

    if (loaded.rule === undefined) throw new Error(`${file} exports no rule`)

    rules.push(loaded.rule)
  }

  return rules
}

/** The best discount any rule offers for a line, in basis points. */
export async function bestDiscount(line: Line): Promise<number> {
  const rules = await loadRules()

  return Math.max(0, ...rules.map((rule) => rule.discountBasisPoints(line)))
}
