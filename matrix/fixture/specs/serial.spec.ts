/**
 * Five tests inside `test.describe.serial`, which pins them to one worker in
 * declaration order — and therefore to one shard, `fullyParallel` or not.
 */

import { test } from '@playwright/test'

test.describe.serial('serial block', () => {
  test('serial-1', () => {})
  test('serial-2', () => {})
  test('serial-3', () => {})
  test('serial-4', () => {})
  test('serial-5', () => {})
})
