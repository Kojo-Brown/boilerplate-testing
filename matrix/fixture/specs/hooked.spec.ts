/**
 * The same five tests as `plain.spec.ts` plus one file-level `beforeAll`.
 *
 * That hook is the entire difference, and it changes how the file shards:
 * Playwright cannot hand five independently-parallel tests to five workers
 * when a `beforeAll` has to run once for the file, so it chunks them into
 * groups of `ceil(5 / shardTotal)` instead. The chunk size depends on the
 * shard count, which is why this file's contribution to the partition changes
 * shape as `--shard=k/n` changes `n`.
 */

import { test } from '@playwright/test'

test.beforeAll(() => {})

test('hooked-1', () => {})
test('hooked-2', () => {})
test('hooked-3', () => {})
test('hooked-4', () => {})
test('hooked-5', () => {})
