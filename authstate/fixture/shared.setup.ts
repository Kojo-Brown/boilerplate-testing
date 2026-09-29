/**
 * The setup project, which exists for exactly one strategy.
 *
 * `shared-file` is Playwright's headline recipe and the thing that makes it a
 * recipe rather than a `beforeAll` is this: one project signs in, once, and
 * every other project restores what it saved. The measure project declares
 * `dependencies: ['setup']`, so this runs to completion before any worker asks
 * for a session.
 *
 * The config only registers this project when the strategy under measurement
 * needs it, which is what keeps the other four rows honest about their login
 * cost — a setup project that ran for every strategy would put a sign-in in
 * every row's `logins` column and flatten the one column that is about price.
 */

import { test as setup } from '@playwright/test'

import { SHARED_ACCOUNT } from '../strategies.ts'
import { ORIGIN, signInAndSave, stateFile } from './session.ts'

setup('the shared account signs in once and saves its state', async ({ playwright }) => {
  const context = await signInAndSave(
    playwright.request,
    ORIGIN(),
    SHARED_ACCOUNT,
    stateFile('shared'),
  )

  await context.dispose()
})
