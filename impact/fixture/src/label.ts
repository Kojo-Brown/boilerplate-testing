/**
 * The receipt, rendered. The fixture's one snapshotted output.
 *
 * It imports `money.ts` for formatting and nothing else, so the snapshot's
 * blast radius is small enough to be a measurement rather than a coincidence:
 * the baseline under `src/__snapshots__/` changes when the renderer changes,
 * when the factory changes, and in no other fault in the catalogue.
 */

import { formatCents, type Line } from './money.ts'

export function receipt(lines: readonly Line[], totalCents: number): string {
  const rows = lines.map(
    (line) => `${line.sku} x${String(line.quantity)} @ ${formatCents(line.unitCents)}`,
  )

  return [...rows, `TOTAL ${formatCents(totalCents)}`].join('\n')
}
