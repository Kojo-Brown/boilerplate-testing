/**
 * The page under test, and every mutation of it, as one pure function.
 *
 * ---------------------------------------------------------------------------
 * Why the layout is measured rather than drawn
 * ---------------------------------------------------------------------------
 * Almost every element below has an explicit width and height, which is not
 * how anybody writes a page. It is how you write a *subject*: the catalogue in
 * `changes.ts` claims that each change moves either more than 4,000 pixels or
 * fewer than 1,500, and `wirings.ts` predicts eleven cells from that claim. A
 * fixture whose elements were sized by their content would make those bands a
 * property of the font the runner happened to have, and the first CI run on a
 * different Chromium build would decide the table.
 *
 * The one element sized by its content is the body copy, because `subpixel-jitter`
 * is a claim about text re-hinting and there is no way to ask for that without
 * glyphs. It is kept to a single short line so its band has room: it moves
 * about a thousand pixels against a budget of four.
 *
 * ---------------------------------------------------------------------------
 * Why the animations are paused
 * ---------------------------------------------------------------------------
 * Two changes are about a screenshot catching an animation mid-flight, and the
 * obvious way to write them — start an animation, wait, capture — makes the
 * measurement a race. Every animation here is `animation-play-state: paused`
 * with a negative `animation-delay`, which puts it at exactly the phase that
 * delay names and holds it there. The phase is then a parameter rather than an
 * elapsed time, so "this render caught it further along" is arithmetic.
 *
 * That changes nothing about what is being measured. `animations: 'disabled'`
 * finishes or cancels the animations it finds through `document.getAnimations()`,
 * and a paused animation is one of them; what it does *not* find is the
 * progress bar below, whose width a `requestAnimationFrame` callback writes,
 * because that is not an animation as far as the engine is concerned. That is
 * the whole of the `script-animation-phase` finding and it does not depend on
 * how the other two are driven.
 *
 * ---------------------------------------------------------------------------
 * The header stamp is positioned absolutely
 * ---------------------------------------------------------------------------
 * `stamp-enlarged` doubles the stamp's font size, and in normal flow that
 * would push the whole page down — every wiring would flag it, and the table
 * would say masking catches a resize when what it caught was a reflow. The
 * header is a fixed 56px box and the stamp is absolutely positioned inside it,
 * so the stamp's own bounding box is the only thing the change moves.
 */

import { CHANGE_IDS } from './changes.ts'

/** The viewport every capture uses. The document is deliberately taller. */
export const VIEWPORT = { width: 800, height: 600 } as const

/** `page-grew` adds exactly this much to the document's height. */
export const GROWTH_PX = 96

/** The attribute a wiring's mask selects on. */
export const DYNAMIC_ATTRIBUTE = 'data-visual-dynamic'

export const MASK_SELECTOR = `[${DYNAMIC_ATTRIBUTE}]`

/** The two renders of a cell: the baseline, and the one being compared to it. */
export const BASELINE_NONCE = 0
export const VARIANT_NONCE = 1

const BRAND = '#2563eb'
const BRAND_NEXT_SHADE = '#3b82f6'
const BRAND_HAIRLINE = '#2563ec'
const SUCCESS = '#16a34a'
const ERROR = '#dc2626'
const MUTED = '#6b7280'
const PANEL = '#f3f4f6'
const PANEL_ERROR = '#fee2e2'

/** The avatar's two tints, as `avatar-tint` swaps between them. */
const AVATAR_TINTS = ['#7c3aed', '#0891b2'] as const

/** The stamp's two readings, as `stamp-text` swaps between them. */
const STAMP_TEXTS = ['Updated 12:01:33', 'Updated 18:47:02'] as const

/** Phases, in milliseconds, for the two paused CSS animations. */
const CSS_PHASES = [0, 1500] as const

/** Widths, in pixels, the scripted progress bar is driven to. */
const SCRIPT_WIDTHS = [40, 240] as const

export interface RenderOptions {
  /**
   * Which mutation to apply, or `null` for the unmutated page.
   *
   * A change id that is not in the catalogue throws rather than rendering the
   * baseline, so a typo in a spec is a failure rather than a row of `same`.
   */
  readonly change: string | null
  /**
   * Which of the two renders this is. Only the regions a varying change names
   * read it; everything else is identical at either value, which is what makes
   * a flagged cell attributable to the change under test.
   */
  readonly nonce: number
}

function pick<T>(pair: readonly [T, T], nonce: number): T {
  return nonce === BASELINE_NONCE ? pair[0] : pair[1]
}

/**
 * The document, as a string.
 *
 * Returned rather than served so that `subject.test.ts` can audit every
 * mutation without a port, and so that `server.ts` is only a binding.
 */
export function render(options: RenderOptions): string {
  const { change, nonce } = options

  if (change !== null && !CHANGE_IDS.includes(change)) {
    throw new Error(`no change named ${change}`)
  }

  const applies = (id: string): boolean => change === id

  const brandColour = applies('brand-shade')
    ? BRAND_NEXT_SHADE
    : applies('brand-hairline')
      ? BRAND_HAIRLINE
      : BRAND

  const stampColour = applies('stamp-recoloured') ? ERROR : MUTED
  const stampSize = applies('stamp-enlarged') ? 30 : 12
  const stampText = applies('stamp-text') ? pick(STAMP_TEXTS, nonce) : STAMP_TEXTS[0]
  const avatarTint = applies('avatar-tint') ? pick(AVATAR_TINTS, nonce) : AVATAR_TINTS[0]
  const copyOffset = applies('subpixel-jitter') ? pick([0, 0.4] as const, nonce) : 0
  const cssPhase = applies('css-animation-phase') ? pick(CSS_PHASES, nonce) : CSS_PHASES[0]
  const scriptWidth = applies('script-animation-phase') ? pick(SCRIPT_WIDTHS, nonce) : SCRIPT_WIDTHS[0]
  const statusColour = applies('status-inverted') ? ERROR : SUCCESS
  const panelColour = applies('panel-recoloured') ? PANEL_ERROR : PANEL

  const exportButton = applies('control-removed')
    ? ''
    : `<button class="export" type="button">Export</button>`

  const extraRow = applies('page-grew')
    ? `<div class="grown" style="height:${GROWTH_PX}px"></div>`
    : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Order summary</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: ${VIEWPORT.width}px;
        background: #ffffff;
        color: #111827;
        font: 14px/1.4 system-ui, sans-serif;
        overflow-x: hidden;
      }
      .sheet { padding: 16px; }

      /* Fixed box: see the header note at the top of this file. */
      .head { position: relative; height: 56px; }
      .head h1 { font-size: 22px; line-height: 32px; font-weight: 600; }
      .stamp {
        position: absolute; top: 4px; left: 360px;
        font-size: ${stampSize}px; line-height: ${Math.round(stampSize * 1.2)}px;
        color: ${stampColour}; white-space: nowrap;
      }

      .brand { width: 320px; height: 120px; background: ${brandColour}; margin-top: 8px; }
      .status {
        width: 200px; height: 48px; margin-top: 16px; border-radius: 24px;
        background: ${statusColour}; color: #ffffff;
        font-size: 14px; line-height: 48px; text-align: center;
      }
      .copy {
        margin-top: 16px; height: 40px; color: #374151; white-space: nowrap;
        transform: translateX(${copyOffset}px);
      }
      .avatar {
        display: block; width: 64px; height: 64px; border-radius: 8px;
        margin-top: 8px; background: ${avatarTint};
      }
      .controls { height: 44px; margin-top: 16px; }
      .export {
        width: 180px; height: 44px; border: 0; border-radius: 6px;
        background: ${BRAND}; color: #ffffff; font: inherit; cursor: pointer;
      }

      .motion { height: 48px; margin-top: 16px; display: flex; align-items: center; gap: 8px; }
      .spinner {
        width: 48px; height: 48px; border-radius: 50%;
        border: 8px solid ${PANEL}; border-top-color: ${BRAND};
        animation: spin 2000ms linear infinite;
        animation-play-state: paused; animation-delay: -${cssPhase}ms;
      }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .fade {
        width: 200px; height: 48px; background: ${BRAND};
        animation: fade 3000ms linear forwards;
        animation-play-state: paused; animation-delay: -${cssPhase}ms;
      }
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      .progress { width: 400px; height: 40px; background: ${PANEL}; }
      .progress > i { display: block; height: 40px; width: 0; background: ${SUCCESS}; }

      .spacer { height: 160px; }
      .panel { height: 200px; background: ${panelColour}; padding: 16px; color: #374151; }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="head">
        <h1>Order summary</h1>
        <span class="stamp" ${DYNAMIC_ATTRIBUTE}="stamp">${stampText}</span>
      </div>
      <div class="brand"></div>
      <div class="status">Paid</div>
      <p class="copy">Two items, shipped on the 14th to the billing address.</p>
      <span class="avatar" ${DYNAMIC_ATTRIBUTE}="avatar"></span>
      <div class="controls">${exportButton}</div>
      <div class="motion">
        <div class="spinner"></div>
        <div class="fade"></div>
        <div class="progress"><i data-width="${scriptWidth}"></i></div>
      </div>
      ${extraRow}
      <div class="spacer"></div>
    </div>
    <section class="panel">Support panel, below the fold.</section>
    <script>
      // Written by a rAF callback on purpose. The animations:'disabled'
      // capture option reaches what the engine is animating; this is script
      // writing a style, and the option has no opinion about it. See
      // visual/README.md.
      requestAnimationFrame(function () {
        var fill = document.querySelector('.progress > i')
        if (fill) { fill.style.width = fill.getAttribute('data-width') + 'px' }
        document.documentElement.setAttribute('data-painted', '1')
      })
    </script>
  </body>
</html>
`
}

/** Every revision the fixture can serve, baseline first. */
export function revisions(): readonly (string | null)[] {
  return [null, ...CHANGE_IDS]
}
