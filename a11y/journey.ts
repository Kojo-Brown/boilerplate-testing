/**
 * Driving the fixture, and the four assertions axe cannot make.
 *
 * The drive half is ordinary Playwright and is here so that `journey.spec.ts`
 * reads as the measurement rather than as a sequence of clicks. The assertion
 * half is the point of the directory: each of the four functions below states
 * something about a *transition* — what moved, what was announced, what a key
 * did — and none of them can be expressed as a question about a snapshot of
 * the DOM, which is why no axe rule covers any of them.
 *
 * They are written as predicates returning a boolean rather than as assertions
 * so that `journey.spec.ts` can use them in both directions. The fixture is
 * deliberately broken, so every one of them is expected to come back `false`
 * here; a reader copying this directory into a real application wants them to
 * come back `true`, and the same function serves both.
 */

import type { Page } from '@playwright/test'

import { RELEASE_ORDERS } from './page.ts'
import type { JourneyState } from './states.ts'

/** The id of the element that currently has focus, or the tag name if it has none. */
export async function focusedId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement

    if (!active || active === document.body) {
      return 'BODY'
    }

    return active.id === '' ? active.tagName : active.id
  })
}

/** Resolve the order list, which the fixture holds until it is asked. */
export async function releaseOrders(page: Page): Promise<void> {
  await page.evaluate((name) => {
    const release = (window as unknown as Record<string, () => void>)[name]

    if (typeof release !== 'function') {
      throw new Error(`the fixture exposes no ${name}()`)
    }

    release()
  }, RELEASE_ORDERS)

  await page.waitForSelector('#results')
}

// ---------------------------------------------------------------------------
// The four assertions axe has no rule for
// ---------------------------------------------------------------------------

/**
 * Whether focus ended up inside `container`.
 *
 * The dialog and the route change are the same question asked twice. Note what
 * it takes to ask it: a reference to where focus was *before*, which a scan of
 * the finished document does not have and cannot reconstruct.
 */
export async function focusMovedInto(page: Page, container: string): Promise<boolean> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector)
    const active = document.activeElement

    return root !== null && active !== null && root.contains(active)
  }, container)
}

/**
 * Whether `field` is programmatically associated with a visible error message.
 *
 * Both halves matter and they fail differently. `aria-invalid` missing is the
 * unassociated case; `aria-describedby` pointing at an id that does not
 * resolve is the typo case, which axe files under `incomplete`.
 */
export async function errorIsAssociated(page: Page, field: string): Promise<boolean> {
  return page.evaluate((selector) => {
    const input = document.querySelector(selector)

    if (!input) {
      return false
    }

    if (input.getAttribute('aria-invalid') !== 'true') {
      return false
    }

    const describedBy = input.getAttribute('aria-describedby')

    if (describedBy === null) {
      return false
    }

    return describedBy
      .split(/\s+/)
      .filter((id) => id !== '')
      .every((id) => {
        const target = document.getElementById(id)

        return target !== null && (target.textContent ?? '').trim() !== ''
      })
  }, field)
}

/**
 * Whether `region` would actually announce what `act` puts into it.
 *
 * Three conditions, and the fixture fails two of them in different places,
 * which is why all three are here. The region has to *be* a live region; it has
 * to already be in the tree; and it has to be empty, so that what arrives is a
 * change rather than the initial content. `#errors` satisfies the last two and
 * is not a live region at all. `#toast` is a perfectly good `role="status"`
 * that is created with its message already inside it and only then appended,
 * so the change never happens in the tree.
 *
 * The first draft of this helper omitted the live-region check and passed
 * `#errors`, which is worth recording: a "has it been announced" assertion that
 * only looks at timing gives a false green on the commonest spelling of the
 * bug, a plain `<div>` somebody writes error text into.
 *
 * This is the assertion that cannot be retrofitted. It observes the document
 * across an event, and the finished DOM of the correct and the incorrect
 * version are identical, so there is nothing for a scanner to look at.
 */
export async function announcedByLiveRegion(
  page: Page,
  region: string,
  act: () => Promise<void>,
): Promise<boolean> {
  const before = await page.evaluate((selector) => {
    const node = document.querySelector(selector)

    if (!node) {
      return { present: false, empty: false, live: false }
    }

    const role = node.getAttribute('role')
    const live = node.getAttribute('aria-live')

    return {
      present: true,
      empty: (node.textContent ?? '').trim() === '',
      // The implicit live roles, plus the explicit attribute. `aria-live="off"`
      // is spelled out rather than truthy-checked: it is the one value that
      // means the opposite of the others.
      live:
        (role !== null && ['status', 'alert', 'log'].includes(role)) ||
        (live !== null && live !== 'off'),
    }
  }, region)

  await act()

  await page.waitForSelector(region)

  const after = await page.evaluate((selector) => {
    const node = document.querySelector(selector)

    return (node?.textContent ?? '').trim() !== ''
  }, region)

  return before.present && before.live && before.empty && after
}

/**
 * Whether `control` does the same thing from the keyboard as from the mouse.
 *
 * `role` and `tabindex` can both be right — axe checks exactly that and passes
 * — while Enter does nothing, because Enter on a `div` does not synthesise a
 * click. The only way to find out is to press the key and look at the effect.
 */
export async function operableByKeyboard(
  page: Page,
  control: string,
  effect: () => Promise<boolean>,
): Promise<boolean> {
  await page.focus(control)
  await page.keyboard.press('Enter')

  if (await effect()) {
    return true
  }

  await page.keyboard.press('Space')

  return effect()
}

// ---------------------------------------------------------------------------
// Walking the journey
// ---------------------------------------------------------------------------

/**
 * Put the page into `state`, performing every step before it.
 *
 * The steps are cumulative and the order is `JOURNEY_STATES`, so a test that
 * wants `route-changed` pays for the whole journey and a test that wants
 * `landing-load` pays for a navigation. That is the honest cost model: the
 * states are not independent, and pretending they were — by deep-linking to
 * each one — would quietly reintroduce the per-page strategy this directory is
 * measuring.
 *
 * The dialog is closed on the way past. Leaving it open would carry its
 * `aria-hidden` background into the form states and put two hazards' findings
 * in one scan, which would make every later cell ambiguous.
 */
export async function driveTo(page: Page, state: JourneyState): Promise<void> {
  await page.goto('/')

  if (state === 'landing-load') {
    return
  }

  await releaseOrders(page)

  if (state === 'landing-settled') {
    return
  }

  await page.click('#edit')
  await page.waitForSelector('#dialog')

  if (state === 'dialog-open') {
    return
  }

  await page.click('#dialog-close')
  await page.waitForSelector('#dialog', { state: 'detached' })

  await page.click('#save')
  await page.waitForSelector('#name-err')

  if (state === 'validation-error') {
    return
  }

  await page.fill('#name', 'Ada Lovelace')
  await page.fill('#email', 'ada@example.test')
  await page.click('#save')
  await page.waitForSelector('#toast')

  if (state === 'toast') {
    return
  }

  await page.click('#to-details')
  await page.waitForSelector('#details-view:not([hidden])')
}
