/**
 * A text cell that only offers a tooltip when its text is actually clipped.
 *
 * The behaviour is one line of logic — `scrollWidth > clientWidth` — and it is
 * the canonical example of something a component can only be asked in a real
 * browser. Both numbers are produced by layout, and jsdom has no layout
 * engine: every element it reports is 0 wide, so the condition is false for
 * every input and the component's only interesting branch is unreachable.
 *
 * The measurement is repeated through a `ResizeObserver` rather than taken
 * once on mount, because the same text clips or does not clip depending on the
 * width it is given — a table column being dragged, a flex row reflowing, a
 * font finishing loading. jsdom does not implement `ResizeObserver` either, so
 * a jsdom test of this component has to supply one, and the stub it supplies
 * is then the thing the test measures.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'

export interface OverflowTooltipProps {
  /** The full text. Shown clipped when it does not fit, in full in the tooltip. */
  readonly text: string
  /** CSS width of the cell — a number is treated as pixels, as React does. */
  readonly width: number | string
}

/** The clipping itself is CSS, and it has to be real CSS for `scrollWidth` to differ. */
const CELL: CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export function OverflowTooltip({ text, width }: OverflowTooltipProps): React.JSX.Element {
  const cell = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)

  useEffect(() => {
    const element = cell.current

    if (element === null) {
      return
    }

    // `scrollWidth` is the content's width, `clientWidth` the box it is shown
    // in. They are integers, so a sub-pixel overhang rounds away and the
    // tooltip does not appear for text that is clipped by a quarter of a
    // pixel. That is the browser's answer and this component does not correct
    // it: a tooltip offered for text nobody can see clipped is worse.
    const measure = (): void => {
      setClipped(element.scrollWidth > element.clientWidth)
    }

    measure()

    const observer = new ResizeObserver(measure)

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [text])

  return (
    <span
      ref={cell}
      style={{ ...CELL, width }}
      // The whole point of the component: a `title` on text that is not
      // clipped is a tooltip that repeats what the reader can already see,
      // and screen readers announce it.
      {...(clipped ? { title: text } : {})}
    >
      {text}
    </span>
  )
}
