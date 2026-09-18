/**
 * The same component, in jsdom, for the sake of the comparison.
 *
 * As with `OverflowTooltip.jsdom.test.tsx`, the job here is to *record* what
 * jsdom answers rather than to test the component. jsdom 26 implements the
 * `<dialog>` element as markup and none of its behaviour: `showModal` is not a
 * function on the instance, so the component's only interaction throws, and
 * everything the browser specs assert — the top layer, the backdrop, the focus
 * trap, `cancel` on Escape, focus restoration — has nothing to be asserted
 * about.
 *
 * If a future jsdom implements `showModal`, the first case here fails and
 * whoever sees it should read `ct/README.md` before deleting this file: a
 * `showModal` that opens the element without a top layer would make the
 * *inertness* assertions silently vacuous rather than loudly absent, which is
 * worse.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ConfirmButton } from './components/ConfirmButton'

const LABEL = 'Delete project'
const QUESTION = 'Delete Ptolemy and everything in it?'
const CONFIRM = 'Delete it'

const noop = (): void => {}

const dialogElement = (): HTMLDialogElement => {
  const dialog = screen.getByText(QUESTION).closest('dialog')

  if (dialog === null) {
    throw new Error('the component rendered no <dialog> at all')
  }

  return dialog
}

const renderButton = (): void => {
  render(
    <ConfirmButton
      label={LABEL}
      question={QUESTION}
      confirmLabel={CONFIRM}
      onConfirm={noop}
      onDismiss={noop}
    />,
  )
}

afterEach(cleanup)

describe('ConfirmButton under jsdom', () => {
  it('renders the trigger and the dialog markup', () => {
    renderButton()

    // What jsdom does have: the elements, their roles and their text. A
    // closed <dialog> is hidden from the accessibility tree, so the question
    // is queried as text rather than through a role.
    expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument()
    expect(screen.getByText(QUESTION)).toBeInTheDocument()
    expect(dialogElement()).toBeInTheDocument()
  })

  it('leaves showModal undefined on the dialog element', () => {
    renderButton()

    const dialog = dialogElement()

    expect(typeof dialog.showModal).toBe('undefined')
    expect(() => dialog.showModal()).toThrow(TypeError)
  })

  it('keeps the dialog closed, because the call that would open it is the missing one', () => {
    renderButton()

    // The trigger's handler does one thing — `showModal()` — so pressing it
    // here cannot open anything. The press itself is deliberately not
    // simulated: React 19 does not rethrow an error from an event handler, it
    // reports it as an uncaught error on the window, which Vitest then fails
    // the *file* with rather than the case. The observable state is the same
    // one this asserts, and asserting it directly keeps the failure legible.
    expect(dialogElement().open).toBe(false)
  })
})
