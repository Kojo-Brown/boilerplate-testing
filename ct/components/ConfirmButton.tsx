/**
 * A destructive action behind a native modal confirmation.
 *
 * Everything this component delegates to the platform is something jsdom does
 * not implement at all: `HTMLDialogElement.showModal` is `undefined` there
 * (measured — see `ConfirmButton.jsdom.test.tsx`), and with it go the top
 * layer, the backdrop, the focus trap, the `cancel` event Escape fires, and
 * the focus restore on close. A jsdom test of this component can assert that
 * the trigger renders and nothing beyond it.
 *
 * `<dialog>` is used rather than a hand-rolled overlay for the same reason:
 * the focus trap and the inert background are the hard parts of a modal, the
 * browser already has them, and a component that reimplements them ships its
 * own bugs. What is left here is the wiring — open on click, report which way
 * it closed, and close only through the one path that reports.
 */

import { useCallback, useRef, type CSSProperties } from 'react'

export interface ConfirmButtonProps {
  /** Label of the trigger, e.g. "Delete project". */
  readonly label: string
  /** The question the dialog asks. */
  readonly question: string
  /** Label of the confirming button inside the dialog. */
  readonly confirmLabel: string
  /** Called once, when the person confirms. */
  readonly onConfirm: () => void
  /** Called whenever the dialog closes without confirming: Escape, backdrop, Cancel. */
  readonly onDismiss?: (() => void) | undefined
}

const DIALOG: CSSProperties = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: 24,
  minWidth: 280,
}

export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  onDismiss,
}: ConfirmButtonProps): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const outcome = useRef<'confirm' | 'dismiss'>('dismiss')

  const open = useCallback(() => {
    outcome.current = 'dismiss'
    // `showModal`, not `show`: only the modal form puts the dialog in the top
    // layer, which is what makes the backdrop paint and the rest of the page
    // inert. `show()` renders the same markup and traps nothing.
    dialog.current?.showModal()
  }, [])

  const confirm = useCallback(() => {
    outcome.current = 'confirm'
    dialog.current?.close()
  }, [])

  const dismiss = useCallback(() => {
    dialog.current?.close()
  }, [])

  // A click that lands on the <dialog> element itself landed on the backdrop:
  // the dialog's own box is covered by its children and its padding, and the
  // backdrop is painted by the dialog element. Clicks inside the box have a
  // descendant as their target, so this is the one comparison that separates
  // them without measuring anything.
  const onDialogClick = useCallback((event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      dialog.current?.close()
    }
  }, [])

  // `close` fires however the dialog closed — Escape, a `close()` call, or the
  // form below. Reporting from here rather than from each call site is what
  // makes "closed without confirming" a single path that cannot be forgotten.
  const onClose = useCallback(() => {
    if (outcome.current === 'confirm') {
      onConfirm()

      return
    }

    onDismiss?.()
  }, [onConfirm, onDismiss])

  return (
    <>
      <button type="button" onClick={open}>
        {label}
      </button>

      <dialog ref={dialog} style={DIALOG} onClick={onDialogClick} onClose={onClose}>
        <p>{question}</p>

        {/*
          `autoFocus` so the focused control when the dialog opens is the
          non-destructive one. Without it the browser focuses the first
          focusable descendant, which would be whichever button happens to be
          first in the DOM — a layout decision deciding a safety property.
        */}
        <button type="button" autoFocus onClick={dismiss}>
          Cancel
        </button>
        <button type="button" onClick={confirm}>
          {confirmLabel}
        </button>
      </dialog>
    </>
  )
}
