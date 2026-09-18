/**
 * The other half of what a browser has and jsdom does not: the top layer.
 *
 * `<dialog>.showModal()` is one call, and everything that makes a modal a
 * modal comes with it — the backdrop, the focus trap, Escape firing `cancel`,
 * focus returning to whatever opened it, and the rest of the document going
 * inert. jsdom implements none of it; it does not define `showModal` at all
 * (`ConfirmButton.jsdom.test.tsx` measures that), so a jsdom test of this
 * component cannot open the dialog, let alone assert what happens while it
 * is open.
 *
 * Two of these specs are about what a person *cannot* do while the dialog is
 * open — reach the trigger behind it, or tab out of it. Those are the
 * assertions a hand-rolled overlay fails and the reason to use the element.
 */

import { expect, test } from '@playwright/experimental-ct-react'
import { ConfirmButton } from './components/ConfirmButton'

const LABEL = 'Delete project'
const QUESTION = 'Delete Ptolemy and everything in it?'
const CONFIRM = 'Delete it'

/**
 * Props whose callbacks record into an array *in this process*.
 *
 * Function props cross the boundary as remote handles: the component in the
 * browser calls a proxy, Playwright ships the call back over the wire, and the
 * closure runs here. That is a round trip, so the recording is always read
 * through `expect.poll` rather than asserted on the next line — see
 * `ct/README.md`.
 */
function recorder(): { readonly events: string[] } {
  return { events: [] }
}

test('opens a modal dialog when its trigger is pressed', async ({ mount, page }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
      onDismiss={() => log.events.push('dismiss')}
    />,
  )

  const dialog = page.getByRole('dialog')

  await expect(dialog).toBeHidden()

  await component.getByRole('button', { name: LABEL }).click()

  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(QUESTION)

  // `:modal` is true only for a dialog in the top layer, which is what
  // separates `showModal()` from `show()`. The element, its `open` attribute
  // and its contents are identical either way.
  await expect(page.locator('dialog:modal')).toBeVisible()
})

test('focuses the safe choice rather than the destructive one', async ({ mount, page }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
    />,
  )

  await component.getByRole('button', { name: LABEL }).click()

  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
})

test('holds focus inside the dialog when tabbing past its last control', async ({ mount, page }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
    />,
  )

  await component.getByRole('button', { name: LABEL }).click()

  // Four tabs from Cancel with two controls in the dialog: enough to leave it
  // twice over if focus were not trapped. Where exactly focus lands is the
  // browser's business — that it never lands outside is the modal's contract.
  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press('Tab')
  }

  const focusedInsideDialog = await page.evaluate(() => {
    const active = document.activeElement

    return active !== null && active.closest('dialog') !== null
  })

  expect(focusedInsideDialog).toBe(true)
})

test('puts the trigger behind it out of reach while it is open', async ({ mount, page }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
    />,
  )

  const trigger = component.getByRole('button', { name: LABEL })

  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // The trigger is still rendered, still visible and still enabled. What has
  // changed is that the dialog's backdrop is painted over it, so a real click
  // cannot reach it — Playwright's actionability check reports exactly that
  // rather than clicking through, which is why this assertion is possible at
  // all. `force: true` would bypass the check and assert nothing.
  await expect(trigger).toBeEnabled()
  await expect(trigger.click({ timeout: 2_000 })).rejects.toThrow(/intercepts pointer events/)
})

test('closes and reports a dismissal when Escape is pressed', async ({ mount, page }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
      onDismiss={() => log.events.push('dismiss')}
    />,
  )

  const trigger = component.getByRole('button', { name: LABEL })

  await trigger.click()
  await page.keyboard.press('Escape')

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect.poll(() => log.events).toEqual(['dismiss'])

  // Focus goes back where it came from, which is the browser's doing and the
  // single most-forgotten behaviour in a hand-rolled modal.
  await expect(trigger).toBeFocused()
})

test('closes and reports a dismissal when the backdrop is clicked', async ({ mount, page }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
      onDismiss={() => log.events.push('dismiss')}
    />,
  )

  await component.getByRole('button', { name: LABEL }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // The top-left corner of the viewport: outside the centred dialog box, on
  // the backdrop. A click there has the <dialog> element itself as its target,
  // which is the comparison the component uses to tell the two apart.
  await page.mouse.click(4, 4)

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect.poll(() => log.events).toEqual(['dismiss'])
})

test('reports a confirmation only from the confirming button', async ({ mount, page }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
      onDismiss={() => log.events.push('dismiss')}
    />,
  )

  await component.getByRole('button', { name: LABEL }).click()
  await page.getByRole('button', { name: CONFIRM }).click()

  await expect(page.getByRole('dialog')).toBeHidden()

  // Exactly one event, and not a dismissal alongside it: the dialog's `close`
  // event fires on the confirming path too, so a component that reported from
  // both the button and the close handler would report twice.
  await expect.poll(() => log.events).toEqual(['confirm'])
})

test('reports nothing at all until the person chooses', async ({ mount }) => {
  const log = recorder()
  const component = await mount(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={() => log.events.push('confirm')}
      onDismiss={() => log.events.push('dismiss')}
    />,
  )

  await component.getByRole('button', { name: LABEL }).click()

  // Opening is not an outcome. Written as a poll that has to stay empty rather
  // than a bare assertion, so a callback that arrives late still fails it.
  await expect.poll(() => log.events, { timeout: 1_000 }).toEqual([])
})
