/**
 * Four tests inside `test.describe.parallel`, the per-file opt-in to what
 * `fullyParallel: true` turns on globally. It is here so the grouping table
 * has a file that splits under a *sequential* config, which is the half of
 * the rule a repo that never sets `fullyParallel` would otherwise never see.
 */

import { test } from '@playwright/test'

test.describe.parallel('parallel block', () => {
  test('parallel-1', () => {})
  test('parallel-2', () => {})
  test('parallel-3', () => {})
  test('parallel-4', () => {})
})
