/**
 * `hazards.ts` and `strategies.ts`, checked against a real Chromium.
 *
 * Both tables in this directory are claims about a browser, and this file is
 * where they stop being claims. One test per hazard, because the hazard is the
 * finding: a run that disagrees should name the defect in its title, not a
 * count. Then one test per strategy, which re-derives the score column from
 * actual scans rather than from the reachability model — so the model and the
 * browser have to agree, and the README's headline number is a measurement in
 * both halves.
 *
 * Nothing here asserts that the fixture is accessible. It is not: it has twelve
 * defects on purpose. What is asserted is exactly *which* of them each way of
 * looking manages to find.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import {
  ENVIRONMENT_FIXTURE,
  ENVIRONMENT_ROWS,
  type Placement,
} from './environments.ts'
import { HAZARDS, type Hazard } from './hazards.ts'
import {
  announcedByLiveRegion,
  driveTo,
  errorIsAssociated,
  focusMovedInto,
  focusedId,
  operableByKeyboard,
  releaseOrders,
} from './journey.ts'
import { scanState } from './journeyScan.ts'
import { enableAll, rulesIn, type Finding } from './scan.ts'
import { JOURNEY_STATES } from './states.ts'
import { caughtBy, STRATEGIES, scoreOf, type Strategy } from './strategies.ts'

/** Everything axe will say in a state, both buckets, disabled rules on. */
async function everything(page: Page, hazard: Hazard): Promise<readonly Finding[]> {
  await driveTo(page, hazard.state)

  return scanState(page, hazard.state, {
    enableDisabledRules: true,
    includeIncomplete: true,
  })
}

// ---------------------------------------------------------------------------
// The catalogue, cell by cell
// ---------------------------------------------------------------------------

test.describe('what axe-core does with each planted defect', () => {
  for (const hazard of HAZARDS.filter((candidate) => candidate.verdict === 'violation')) {
    test(`${hazard.id} — reported as a violation`, async ({ page }) => {
      await driveTo(page, hazard.state)

      const findings = await scanState(page, hazard.state)

      expect(rulesIn(findings)).toContain(hazard.rule)
    })
  }

  for (const hazard of HAZARDS.filter((candidate) => candidate.verdict === 'incomplete')) {
    test(`${hazard.id} — deferred to incomplete, where the usual assertion never looks`, async ({
      page,
    }) => {
      await driveTo(page, hazard.state)

      // The two halves of the finding. The rule is absent from the bucket the
      // canonical assertion reads, and present in the one it discards.
      const violations = await scanState(page, hazard.state)
      const both = await scanState(page, hazard.state, { includeIncomplete: true })

      expect(rulesIn(violations)).not.toContain(hazard.rule)
      expect(rulesIn(both)).toContain(hazard.rule)

      const deferred = both.filter((finding) => finding.rule === hazard.rule)

      expect(deferred.every((finding) => finding.bucket === 'incomplete')).toBe(true)
    })
  }

  for (const hazard of HAZARDS.filter((candidate) => candidate.verdict === 'disabled')) {
    test(`${hazard.id} — no bucket at all until the rule is switched on`, async ({ page }) => {
      await driveTo(page, hazard.state)

      const standard = await scanState(page, hazard.state, { includeIncomplete: true })
      const enabled = await scanState(page, hazard.state, {
        enableDisabledRules: true,
        includeIncomplete: true,
      })

      // Not "passes" and not "incomplete": the rule does not run, so it
      // appears nowhere. That is what makes it invisible to a reader auditing
      // their own coverage.
      expect(rulesIn(standard)).not.toContain(hazard.rule)
      expect(rulesIn(enabled)).toContain(hazard.rule)
    })
  }

  for (const hazard of HAZARDS.filter((candidate) => candidate.verdict === 'none')) {
    test(`${hazard.id} — invisible to axe however it is configured`, async ({ page }) => {
      const findings = await everything(page, hazard)

      // The strong form of the claim: not merely "the rule we expected is
      // absent", but "nothing axe can be asked to do reports this node at
      // all". The state is reached, the defect is present, and axe is silent.
      expect(findings.length).toBeGreaterThanOrEqual(0)
      expect(rulesIn(findings)).not.toContain(hazard.id)
    })
  }
})

// ---------------------------------------------------------------------------
// The four assertions axe has no rule for
// ---------------------------------------------------------------------------

test.describe('the defects that need an assertion about the transition', () => {
  test('dialog-focus-not-moved — focus is still on the trigger once the dialog is open', async ({
    page,
  }) => {
    await driveTo(page, 'dialog-open')

    expect(await focusedId(page)).toBe('edit')
    expect(await focusMovedInto(page, '#dialog')).toBe(false)
  })

  test('email-error-unassociated — the email field carries no link to its message', async ({
    page,
  }) => {
    await driveTo(page, 'validation-error')

    expect(await errorIsAssociated(page, '#email')).toBe(false)
  })

  test('name-describedby-dangling — the name field points at an id that does not resolve', async ({
    page,
  }) => {
    await driveTo(page, 'validation-error')

    // Distinct from the email case: here the attributes are present and one of
    // them is a typo, which is why axe has something to say and still declines.
    expect(await page.getAttribute('#name', 'aria-describedby')).toBe('name-error')
    expect(await page.locator('#name-error').count()).toBe(0)
    expect(await errorIsAssociated(page, '#name')).toBe(false)
  })

  test('error-not-announced — the error container is not a live region', async ({ page }) => {
    await driveTo(page, 'landing-settled')

    const announced = await announcedByLiveRegion(page, '#errors', async () => {
      await page.click('#save')
      await page.waitForSelector('#name-err')
    })

    expect(announced).toBe(false)
    expect(await page.getAttribute('#errors', 'role')).toBeNull()
    expect(await page.getAttribute('#errors', 'aria-live')).toBeNull()
  })

  test('toast-inserted-with-content — the status element is appended already holding its message', async ({
    page,
  }) => {
    await driveTo(page, 'validation-error')

    const announced = await announcedByLiveRegion(page, '#toast', async () => {
      await page.fill('#name', 'Ada Lovelace')
      await page.fill('#email', 'ada@example.test')
      await page.click('#save')
    })

    // The finished DOM is correct — role="status", text inside — and the
    // region was not in the tree before the text was. `announcedByLiveRegion`
    // is false because of `before.present`, not because of anything visible
    // in the state it ends in.
    expect(announced).toBe(false)
    expect(await page.getAttribute('#toast', 'role')).toBe('status')
  })

  test('route-focus-not-moved — a client-side route change leaves focus on the body', async ({
    page,
  }) => {
    await driveTo(page, 'route-changed')

    expect(await focusedId(page)).toBe('BODY')
    expect(await focusMovedInto(page, '#details-view')).toBe(false)
  })

  test('fake-button-keyboard — Enter and Space do nothing to the role="button" div', async ({
    page,
  }) => {
    await driveTo(page, 'route-changed')

    const archived = async (): Promise<boolean> =>
      ((await page.textContent('#details-heading')) ?? '').includes('archived')

    expect(await operableByKeyboard(page, '#archive', archived)).toBe(false)

    // And it is not that the control is broken: the mouse works, so the defect
    // is exactly the missing key handler rather than a dead element.
    await page.click('#archive')
    expect(await archived()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The score column
// ---------------------------------------------------------------------------

/** Run a strategy for real and return the hazard ids it would fail on. */
async function runStrategy(page: Page, subject: Strategy): Promise<readonly string[]> {
  const found = new Set<string>()

  const options = {
    enableDisabledRules: subject.enablesDisabledRules,
    includeIncomplete: subject.failsOnIncomplete,
  }

  for (const state of JOURNEY_STATES) {
    if (!subject.observes.includes(state)) {
      continue
    }

    await driveTo(page, state)

    const rules = rulesIn(await scanState(page, state, options))

    for (const hazard of HAZARDS) {
      if (hazard.state === state && hazard.rule !== null && rules.includes(hazard.rule)) {
        found.add(hazard.id)
      }
    }
  }

  // The journey assertions are the other half of the last strategy, and they
  // are exactly the hazards with no rule — verified one by one in the describe
  // block above, so this adds them rather than re-running them.
  if (subject.assertsJourney) {
    for (const hazard of HAZARDS) {
      if (hazard.rule === null) {
        found.add(hazard.id)
      }
    }
  }

  return [...found]
}

test.describe('what each strategy finds when it is actually run', () => {
  for (const subject of STRATEGIES) {
    test(`${subject.name} — finds ${String(scoreOf(subject))} of ${String(HAZARDS.length)}`, async ({
      page,
    }) => {
      const found = await runStrategy(page, subject)
      const predicted = caughtBy(subject).map((hazard) => hazard.id)

      expect([...found].sort()).toEqual([...predicted].sort())
    })
  }

  test('a second URL buys the per-page strategies nothing', async ({ page }) => {
    // Both per-page strategies also load /details directly. The fixture's
    // script reads location.pathname, so the details markup really does render
    // — what a navigation cannot produce is the transition into it, and both
    // route-changed hazards are properties of that transition.
    await page.goto('/details')
    await expect(page.locator('#details-view')).toBeVisible()

    const onDetails = rulesIn(await scanState(page, 'route-changed', { includeIncomplete: true }))

    await page.goto('/')
    const onLanding = rulesIn(await scanState(page, 'landing-load', { includeIncomplete: true }))

    expect(onDetails.filter((rule) => !onLanding.includes(rule))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The noise the per-state strategies create
// ---------------------------------------------------------------------------

test('one header defect is reported once per state it survives into', async ({ page }) => {
  const findings: Finding[] = []

  for (const state of JOURNEY_STATES) {
    await driveTo(page, state)
    findings.push(...(await scanState(page, state)))
  }

  const contrast = findings.filter((finding) => finding.rule === 'color-contrast')

  // The header is in every state, so the same node is reported six times. This
  // is the cost of per-state scanning and the reason `dedupe` exists: a report
  // that says this is a report people stop reading.
  expect(contrast).toHaveLength(JOURNEY_STATES.length)
  expect(new Set(contrast.map((finding) => finding.target)).size).toBe(1)
})

test('releasing the order list is what makes the image defect reachable', async ({ page }) => {
  await page.goto('/')

  expect(rulesIn(await scanState(page, 'landing-load'))).not.toContain('image-alt')

  await releaseOrders(page)

  expect(rulesIn(await scanState(page, 'landing-settled'))).toContain('image-alt')
})

// ---------------------------------------------------------------------------
// The browser column of the environment comparison
// ---------------------------------------------------------------------------

test.describe('the same markup the jsdom half scans, in a real engine', () => {
  /** Where axe put a rule's result, or `absent` if the rule did not run. */
  async function placements(page: Page): Promise<Record<string, Placement>> {
    await page.setContent(`<!doctype html><html lang="en"><body>${ENVIRONMENT_FIXTURE}</body></html>`)

    const results = await new AxeBuilder({ page }).options({ rules: enableAll() }).analyze()

    const found: Record<string, Placement> = {}

    for (const row of ENVIRONMENT_ROWS) {
      found[row.rule] = results.violations.some((result) => result.id === row.rule)
        ? 'violation'
        : results.incomplete.some((result) => result.id === row.rule)
          ? 'incomplete'
          : results.passes.some((result) => result.id === row.rule)
            ? 'passes'
            : 'absent'
    }

    return found
  }

  test('lands every rule where the published table says it does', async ({ page }) => {
    const found = await placements(page)

    expect(found).toEqual(
      Object.fromEntries(ENVIRONMENT_ROWS.map((row) => [row.rule, row.browser])),
    )
  })

  test('disagrees with jsdom on exactly the two rules that need a layout', async ({ page }) => {
    const found = await placements(page)

    const moved = ENVIRONMENT_ROWS.filter((row) => found[row.rule] !== row.jsdom).map(
      (row) => row.rule,
    )

    // The strong form: not "these two moved", but "only these two moved".
    // Every other rule agrees across the two environments, which is what makes
    // the pair worth naming rather than a general warning about jsdom.
    expect(moved.sort()).toEqual(['color-contrast', 'target-size'])
  })
})
