/**
 * The page the emulation probes are run against.
 *
 * One file of HTML with a media query for each thing a "mobile test" is
 * supposed to catch, and nothing else — no framework, no build step, no
 * network. Every rule below is load-bearing for exactly one probe in
 * `probes.ts`, and the two are meant to be read side by side.
 *
 * The interesting rule is `.reveal`. It is the shape of the single most common
 * mobile bug there is: a control that only appears on `:hover`, on a device
 * with no hover. It is written the way a careful author writes it — guarded by
 * `@media (hover: hover)`, so that a device without hover gets the control
 * unconditionally — and the measurement is whether a "mobile test" that only
 * resizes the window can tell the careful version from the careless one.
 */

export const PAGE_PORT = 3112

export const PAGE_URL = `http://127.0.0.1:${PAGE_PORT}`

export const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>emulation probe page</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font: 16px/1.4 system-ui, sans-serif; }

      /* A layout breakpoint: the only thing a viewport resize can move. */
      #layout::after { content: 'wide'; }
      @media (max-width: 767px) {
        #layout::after { content: 'stacked'; }
      }

      /* A control revealed on hover, hidden only where hover exists. The
         careful spelling — a device with no hover keeps the control. */
      .reveal { opacity: 1; }
      @media (hover: hover) {
        .reveal { opacity: 0; }
        #menu:hover .reveal { opacity: 1; }
      }

      /* A coarse pointer wants a bigger target. Purely a size change, and the
         probe reads the computed height rather than the rule. */
      #target { height: 24px; }
      @media (pointer: coarse) {
        #target { height: 48px; }
      }
    </style>
  </head>
  <body>
    <div id="layout"></div>
    <nav id="menu"><button class="reveal" id="reveal">edit</button></nav>
    <button id="target">tap me</button>
    <output id="taps">0</output>
    <script>
      // Counts real taps, so the spec can tell a dispatched touch from a click.
      document.getElementById('target').addEventListener('click', (event) => {
        const taps = document.getElementById('taps')
        taps.textContent = String(Number(taps.textContent) + 1)
        taps.dataset['pointerType'] = event.pointerType ?? 'none'
      })
    </script>
  </body>
</html>
`
