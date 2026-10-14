// @vitest-environment node

/**
 * The identity table, re-derived: six real `playwright test --list` runs.
 *
 * The claim being measured is the one that decides whether a flakiness
 * dashboard can work at all — whether marking a test as quarantined changes
 * the key its history is joined on — and it is a claim about Playwright's
 * title hashing and its tag filtering, neither of which this repository could
 * model without reimplementing them.
 */

import { describe, expect, it } from 'vitest'

import { EXPECTED_IDENTITY, type TagForm } from '@/flake/identity'
import { measureIdentity } from '@/flake/runs'

const BUDGET = 60_000
const FORMS: readonly TagForm[] = ['untagged', 'in-title', 'in-option']

describe('marking a test as quarantined', () => {
  for (const form of FORMS) {
    describe(form, () => {
      it(
        'reports the title, tags, and filter behaviour the published table says',
        async () => {
          const untagged = await measureIdentity('untagged')
          const measured = await measureIdentity(form)

          expect({
            title: measured.title,
            tags: measured.tags,
            selected: measured.selected,
            excluded: measured.excluded,
            idEqualsUntagged: measured.id === untagged.id,
          }).toEqual(EXPECTED_IDENTITY[form])
        },
        BUDGET,
      )
    })
  }

  it(
    'changes the id when the tag goes in the title, and leaves it alone when it goes in the option',
    async () => {
      const [untagged, inTitle, inOption] = await Promise.all([
        measureIdentity('untagged'),
        measureIdentity('in-title'),
        measureIdentity('in-option'),
      ])

      // The whole argument for the registry in `quarantine.ts`, in two
      // assertions: one of these forms discards the test's history at the
      // moment of quarantining and the other does not.
      expect(inTitle.id).not.toBe(untagged.id)
      expect(inOption.id).toBe(untagged.id)
    },
    BUDGET,
  )

  it(
    'leaves both forms greppable, so the quarantine project still selects them',
    async () => {
      const [inTitle, inOption] = await Promise.all([measureIdentity('in-title'), measureIdentity('in-option')])

      // Worth stating as its own case: the cost of the title form is *only*
      // the title and the id. Playwright parses tags out of titles too, so
      // both forms are filtered identically and both appear as
      // `tags: ['flaky']` in the report.
      expect(inTitle.selected && inOption.selected).toBe(true)
      expect(inTitle.excluded && inOption.excluded).toBe(true)
      expect(inTitle.tags).toEqual(inOption.tags)
    },
    BUDGET,
  )
})
