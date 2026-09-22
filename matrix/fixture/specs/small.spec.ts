/**
 * One test, no hooks, no describe. The smallest possible group.
 *
 * Every spec in this directory is deliberately empty: they exist to be
 * *counted* by `playwright test --list`, not to exercise a browser. None of
 * them destructures a `page` fixture, so no browser is ever launched and the
 * whole sharding measurement runs on a machine that has none installed.
 */

import { test } from '@playwright/test'

test('small-1', () => {})
