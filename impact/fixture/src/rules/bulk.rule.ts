/**
 * Quantity discount. Rewritten by the `runtime-rule` fault.
 *
 * The import below is type-only, and its direction matters: this file imports
 * the registry, the registry does not import this file. Reverse reachability
 * from a change here therefore finds nobody.
 */

import type { Rule } from './registry.ts'

export const rule: Rule = {
  id: 'bulk',
  discountBasisPoints: (line) => (line.quantity >= 12 ? 500 : 0),
}
