/**
 * The second measurement: what quarantining a test does to its identity.
 *
 * ---------------------------------------------------------------------------
 * Why this is a measurement and not a detail
 * ---------------------------------------------------------------------------
 * Every number in `history.ts` is a count over a test's past attempts, and
 * every count is joined on a key. `playwright.config.ts` ships the convention
 * that a flaky test is marked by putting `@flaky` *in its title*:
 *
 *     test('loads user list @flaky', async ({ page }) => { … })
 *
 * which renames the test. Both of the keys a report offers — the title, and
 * Playwright's own id, which is a hash of the file and the title — change at
 * the moment of quarantining. The history of the test's flakiness is therefore
 * discarded exactly when a dashboard is supposed to start using it to decide
 * whether the test may come back, and discarded again when it does.
 *
 * Playwright has had a tag *option* since 1.42:
 *
 *     test('loads user list', { tag: '@flaky' }, async ({ page }) => { … })
 *
 * The question is whether the option form is a drop-in replacement — whether
 * `grep` and `grepInvert`, which is how the quarantine project is selected,
 * still see a tag that is not in the title. The table below is three real
 * `playwright test --list` runs per column, and the answer is yes.
 *
 * The residue is narrower than it looks from the outside and is worth stating
 * exactly: both forms are greppable, and both appear as `tags: ['flaky']` in
 * the JSON report, because Playwright parses tags out of titles too. The only
 * thing the title form additionally changes is the title and the id. That is
 * the whole of the cost, and it is the part that cannot be repaired later.
 */

/** How a test can be marked as quarantined. */
export type TagForm = 'untagged' | 'in-title' | 'in-option'

/** What a `--list` run reports about the marked test. */
export interface Identity {
  readonly title: string
  /** Playwright's own test id: `<file hash>-<title hash>`. */
  readonly id: string
  readonly tags: readonly string[]
  /** Does `--grep=@flaky` select it? */
  readonly selected: boolean
  /** Does `--grep-invert=@flaky` exclude it? */
  readonly excluded: boolean
}

/**
 * The measured table, re-derived by `identity.test.ts`.
 *
 * Ids are not written down: they are hashes of a path, so they would change
 * the moment the fixture moved and would be checking Playwright's hash
 * function rather than this claim. What is written down is the *relation* — the
 * option form's id equals the untagged id, and the title form's does not — and
 * that is what the test asserts.
 */
export const EXPECTED_IDENTITY: Readonly<Record<TagForm, Omit<Identity, 'id'> & { readonly idEqualsUntagged: boolean }>> =
  {
    untagged: {
      title: 'subject',
      tags: [],
      selected: false,
      excluded: false,
      idEqualsUntagged: true,
    },
    'in-title': {
      title: 'subject @flaky',
      tags: ['flaky'],
      selected: true,
      excluded: true,
      idEqualsUntagged: false,
    },
    'in-option': {
      title: 'subject',
      tags: ['flaky'],
      selected: true,
      excluded: true,
      idEqualsUntagged: true,
    },
  }
