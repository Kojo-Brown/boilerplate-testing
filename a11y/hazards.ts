/**
 * The twelve defects planted in `page.ts`, and what axe-core does with each.
 *
 * Every row here is a claim about a real browser, and every one of them is
 * checked: `journey.spec.ts` re-derives the `axe` column against Chromium on
 * each run, so a row that stops being true fails the suite rather than rotting
 * in a table. Nothing in this file was written from the documentation — the
 * four `verdict` values are the four distinct things axe-core 4.12 was observed
 * to do, and two of them were not what the first draft of this directory
 * predicted.
 *
 * The verdicts, in the order they cost a reader more:
 *
 *   - `violation`  — axe reports it in `results.violations`. The assertion
 *                    every guide writes catches it.
 *   - `incomplete` — axe noticed and declined to decide, so it lands in
 *                    `results.incomplete`. `expect(violations).toEqual([])`
 *                    ignores this bucket entirely, which is the finding: axe
 *                    found the defect and the canonical assertion threw the
 *                    answer away.
 *   - `disabled`   — a rule for it exists and does not run, because it ships
 *                    `enabled: false`. `axe.getRules()` lists it anyway, so the
 *                    rule looks active to anyone who checks that way.
 *   - `none`       — axe has no rule, and cannot have one: the defect is a
 *                    property of a transition, of what was announced, or of
 *                    what a key does, none of which is visible in a snapshot of
 *                    the DOM.
 */

import { JOURNEY_STATES, type JourneyState } from './states.ts'

export const VERDICTS = ['violation', 'incomplete', 'disabled', 'none'] as const

export type Verdict = (typeof VERDICTS)[number]

export interface Hazard {
  /** Stable id; also the Playwright test title for this hazard's cell. */
  readonly id: string
  /** The journey state in which the defect exists in the DOM at all. */
  readonly state: JourneyState
  /** What is wrong, in one line. */
  readonly defect: string
  /** The axe-core rule that has anything to say about it, if any. */
  readonly rule: string | null
  /** What axe-core 4.12 does with it, measured. */
  readonly verdict: Verdict
  /** The success criterion the defect fails. */
  readonly wcag: string
  /** Why the verdict is what it is — the mechanism, not a restatement. */
  readonly because: string
}

export const HAZARDS: readonly Hazard[] = [
  {
    id: 'muted-contrast',
    state: 'landing-load',
    defect: '#949494 body text on white is 3.0:1',
    rule: 'color-contrast',
    verdict: 'violation',
    wcag: '1.4.3 Contrast (Minimum)',
    because:
      'it is in the document the server returns, and deciding it needs a layout and a computed colour — which is exactly what an end-to-end run has and a jsdom render does not.',
  },
  {
    id: 'icon-target-size',
    state: 'landing-load',
    defect: 'two 20x20 icon buttons, adjacent, with no gap',
    rule: 'target-size',
    verdict: 'disabled',
    wcag: '2.5.8 Target Size (Minimum)',
    because:
      'axe-core ships `target-size` with `enabled: false`, so the rule never runs and the defect appears in no bucket at all. Turned on explicitly it reports both buttons as a serious violation, so this is a switch rather than a limitation.',
  },
  {
    id: 'list-img-alt',
    state: 'landing-settled',
    defect: 'every order row renders an <img> with no alt attribute',
    rule: 'image-alt',
    verdict: 'violation',
    wcag: '1.1.1 Non-text Content',
    because:
      'the rows are not in the document the server returns. axe catches this the moment it is asked after the list resolves, and cannot before.',
  },
  {
    id: 'dialog-unnamed',
    state: 'dialog-open',
    defect: 'role="dialog" with no accessible name',
    rule: 'aria-dialog-name',
    verdict: 'violation',
    wcag: '4.1.2 Name, Role, Value',
    because:
      'the dialog is built on click and exists in no document any navigation returns. Once it is open the rule is unambiguous.',
  },
  {
    id: 'background-hidden-focusable',
    state: 'dialog-open',
    defect: 'the background is aria-hidden="true" and still focusable — `inert` is what this wanted',
    rule: 'aria-hidden-focus',
    verdict: 'incomplete',
    wcag: '4.1.2 Name, Role, Value',
    because:
      'the `focusable-modal-open` check returns "Check that focusable elements are not tabbable in the current state". axe sees that a modal is open and declines to decide — so the one state in which this defect can exist is precisely the state axe refuses to judge, and the result lands in `incomplete` where the usual assertion never looks.',
  },
  {
    id: 'dialog-focus-not-moved',
    state: 'dialog-open',
    defect: 'focus stays on the trigger button when the dialog opens',
    rule: null,
    verdict: 'none',
    wcag: '2.4.3 Focus Order',
    because:
      'nothing in the DOM is wrong. What is wrong is that nothing happened, and a snapshot of a document cannot record an event that did not occur.',
  },
  {
    id: 'name-describedby-dangling',
    state: 'validation-error',
    defect: 'aria-describedby="name-error" pointing at an element whose id is "name-err"',
    rule: 'aria-valid-attr-value',
    verdict: 'incomplete',
    wcag: '1.3.1 Info and Relationships',
    because:
      'axe reports `needsReview` with messageKey `noId` — "ARIA attribute element ID does not exist on the page". A dangling IDREF is explicitly a review item rather than a violation, because the target may be added later. The typo is the commonest real spelling of this bug and the canonical assertion passes it.',
  },
  {
    id: 'email-error-unassociated',
    state: 'validation-error',
    defect: 'the email error is prose beside the field: no aria-invalid, no aria-describedby',
    rule: null,
    verdict: 'none',
    wcag: '3.3.1 Error Identification',
    because:
      'there is no attribute to be wrong. Every element is individually valid, and only a reader who knows which message belongs to which field can say the association is missing.',
  },
  {
    id: 'error-not-announced',
    state: 'validation-error',
    defect: 'errors are written into a container that is not a live region',
    rule: null,
    verdict: 'none',
    wcag: '3.3.1 Error Identification',
    because:
      'whether something was announced is a fact about a change over time. A scan of the state after the change sees a div with text in it, which is not wrong.',
  },
  {
    id: 'toast-inserted-with-content',
    state: 'toast',
    defect: 'the role="status" element is created with its message already inside it, then appended',
    rule: null,
    verdict: 'none',
    wcag: '4.1.3 Status Messages',
    because:
      'a live region has to be in the accessibility tree before its content changes. The finished DOM is indistinguishable from a correct one — the defect is entirely in the order of two operations.',
  },
  {
    id: 'route-focus-not-moved',
    state: 'route-changed',
    defect: 'a client-side route change swaps the view and leaves focus on the body',
    rule: null,
    verdict: 'none',
    wcag: '2.4.3 Focus Order',
    because:
      'the same reason as the dialog, one step further out: after a full page load the browser resets focus itself, so this defect exists only on the transition a per-page strategy never performs.',
  },
  {
    id: 'fake-button-keyboard',
    state: 'route-changed',
    defect: 'a div with role="button" and tabindex="0" that listens only for click',
    rule: null,
    verdict: 'none',
    wcag: '2.1.1 Keyboard',
    because:
      'role and tabindex are both correct, so every static rule passes it. Enter on a div does not synthesise a click, and the only way to find that out is to press Enter.',
  },
]

/** Hazards that exist in the DOM at a given state. */
export function hazardsAt(state: JourneyState): readonly Hazard[] {
  return HAZARDS.filter((hazard) => hazard.state === state)
}

/** Hazards by verdict, in catalogue order. */
export function hazardsWith(verdict: Verdict): readonly Hazard[] {
  return HAZARDS.filter((hazard) => hazard.verdict === verdict)
}

/** The distinct axe rules this directory makes a claim about. */
export function rulesNamed(): readonly string[] {
  return [...new Set(HAZARDS.map((hazard) => hazard.rule).filter((rule) => rule !== null))].sort()
}

/**
 * The hazards ordered as the journey meets them, which is the order the README
 * table is printed in and the order `journey.spec.ts` drives.
 */
export function hazardsInJourneyOrder(): readonly Hazard[] {
  return [...HAZARDS].sort(
    (left, right) => JOURNEY_STATES.indexOf(left.state) - JOURNEY_STATES.indexOf(right.state),
  )
}
