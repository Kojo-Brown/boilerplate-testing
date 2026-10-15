/** Clearance discount, by SKU prefix. The second rule, so the loader has a list to sort. */

import type { Rule } from './registry.ts'

export const rule: Rule = {
  id: 'weekend',
  discountBasisPoints: (line) => (line.sku.startsWith('CLR-') ? 250 : 0),
}
