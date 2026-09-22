/**
 * The file the `setup` project matches. Its one test is what a real suite's
 * `auth.setup.ts` would be — a login whose storage state the browser projects
 * then reuse — and the reason it is here is the cost that carries under
 * sharding: a dependency project is re-run in full by every shard that holds
 * at least one test of a project depending on it.
 */

import { test } from '@playwright/test'

test('setup-1', () => {})
