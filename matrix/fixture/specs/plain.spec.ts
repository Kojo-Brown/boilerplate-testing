/**
 * Five tests, no hooks and no describe: the file that answers "what is the
 * shard unit?" on its own. Under `fullyParallel: false` these five are one
 * group and move together; under `fullyParallel: true` they are five groups
 * and this file is split across shards.
 */

import { test } from '@playwright/test'

test('plain-1', () => {})
test('plain-2', () => {})
test('plain-3', () => {})
test('plain-4', () => {})
test('plain-5', () => {})
