/**
 * The journey the scans are run against.
 *
 * One origin, two views, no framework and no build step — the same shape as
 * `matrix/page.ts` and `intercept/origin.ts`, for the same reason: every line
 * below is load-bearing for exactly one hazard in `hazards.ts`, and the two
 * files are meant to be read side by side.
 *
 * What makes this a *journey* fixture rather than a page fixture is where the
 * defects are put. Two of the twelve are in the document a `goto` returns. The
 * other ten only exist after something has happened — a list has resolved, a
 * dialog has opened, a submit has failed, a toast has been raised, a route has
 * changed client-side — and that placement is the measurement. A scan that
 * runs once per URL cannot see a state the journey has not reached yet, and no
 * amount of rule configuration changes that.
 *
 * Every defect here is the *careless* spelling of something real. None is
 * exaggerated to make a rule fire: the dangling `aria-describedby` is a typo,
 * the toast is inserted the way every toast library inserts one, and the
 * `role="button"` div has the `tabindex` its author remembered and the key
 * handler they forgot.
 */

export const PAGE_PORT = 3113

export const PAGE_URL = `http://127.0.0.1:${PAGE_PORT}`

/**
 * The name of the function the fixture exposes to resolve the order list.
 *
 * This started as a `setTimeout`, and the measurement is why it is not one any
 * more. With the list arriving after 150 ms, the scan-at-load strategy saw the
 * *settled* list about as often as the skeleton: injecting axe-core into a
 * fresh document and running 100 rules takes several hundred milliseconds, so
 * the scan that is supposed to happen "immediately" reliably lost the race to
 * its own start-up cost.
 *
 * That is worth stating plainly because it is a property of every real suite
 * written this way, not of this fixture: **a scan-on-load strategy is racing
 * the application's data layer, and axe's own injection time is long enough
 * that it often wins by accident.** Such a suite is not merely blind to late
 * content, it is nondeterministic about it — which is the worse failure, because
 * it passes locally and fails in CI on a slower runner, or the reverse.
 *
 * So the list is gated on an explicit call instead of a clock. A strategy that
 * does not call it sees the skeleton every time, on any machine, and the cell
 * it produces is a measurement rather than a race.
 */
export const RELEASE_ORDERS = 'releaseOrders'

/** The two URLs a per-page strategy knows about. */
export const PAGE_PATHS = ['/', '/details'] as const

export const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orders</title>
    <style>
      body { margin: 0; font: 16px/1.4 system-ui, sans-serif; background: #fff; color: #111; }
      main { padding: 16px; }

      /* HAZARD muted-contrast — #949494 on #fff is 3.0:1, under the 4.5:1 that
         normal-size text needs. In the header, so it is in the document a
         \`goto\` returns: this is one of the two hazards a per-page scan at load
         can actually see, and it is the one that needs a rendering engine to
         decide. */
      .muted { color: #949494; background: #fff; }

      /* HAZARD icon-target-size — two 20x20 controls with no gap between them.
         Under 24x24 and too crowded to earn the spacing exception, so this is a
         real 2.5.8 failure rather than an undersized-but-isolated control. */
      .icon { width: 20px; height: 20px; padding: 0; margin: 0; border: 1px solid #767676;
              background: #fff; font-size: 11px; vertical-align: middle; }
      .icons { display: flex; gap: 0; }

      [hidden] { display: none !important; }
      .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); }
      .dialog { position: fixed; top: 20%; left: 50%; transform: translateX(-50%);
                background: #fff; border: 1px solid #111; padding: 16px; min-width: 280px; }
      .error { color: #b40000; }
      .toast { position: fixed; bottom: 16px; left: 16px; background: #111; color: #fff;
               padding: 8px 12px; }

      /* The div that is dressed as a button. Nothing about the styling is the
         defect — the missing key handler is. */
      .fake-button { display: inline-block; border: 1px solid #111; padding: 8px 12px;
                     background: #eee; cursor: pointer; }
      .row img { width: 32px; height: 32px; vertical-align: middle; background: #ddd; }
    </style>
  </head>
  <body>
    <div id="app">
      <header>
        <h1>Orders</h1>
        <!-- HAZARD muted-contrast -->
        <p class="muted" id="count">12 results</p>
        <!-- HAZARD icon-target-size -->
        <div class="icons">
          <button class="icon" id="refresh" aria-label="Refresh">R</button>
          <button class="icon" id="export" aria-label="Export">E</button>
        </div>
      </header>

      <main id="main">
        <!-- The list view. -->
        <section id="list-view">
          <!-- Replaced by #results once the list resolves. A scan that runs at
               load sees this, and there is nothing wrong with it. -->
          <div id="skeleton">Loading orders…</div>

          <p>
            <button id="edit" type="button">Edit preferences</button>
            <button id="to-details" type="button">Open order 1001</button>
          </p>

          <form id="form" novalidate>
            <p>
              <label for="name">Name</label>
              <input id="name" name="name" type="text" />
            </p>
            <p>
              <label for="email">Email</label>
              <input id="email" name="email" type="email" />
            </p>
            <!-- Empty, and not a live region. Errors are written into it. -->
            <div id="errors"></div>
            <button id="save" type="submit">Save</button>
          </form>
        </section>

        <!-- The details view, reached by a client-side route change. -->
        <section id="details-view" hidden>
          <h2 id="details-heading">Order 1001</h2>
          <!-- HAZARD fake-button-keyboard — role and tabindex are right, so
               every static rule passes it. Only \`click\` is listened for, and
               Enter on a div does not synthesise one. -->
          <div class="fake-button" id="archive" role="button" tabindex="0">Archive</div>
          <p><button id="to-list" type="button">Back to orders</button></p>
        </section>
      </main>
    </div>

    <script>
      function el(id) {
        var found = document.getElementById(id)
        if (!found) throw new Error('fixture is missing #' + id)
        return found
      }

      // -------------------------------------------------------------------
      // The list resolves when it is told to, not when a timer fires.
      //
      // HAZARD list-img-alt — every row carries an <img> with no alt. It is in
      // no document any \`goto\` returns, which is the whole point: the markup a
      // scan-on-load sees is the skeleton, and the skeleton is clean.
      //
      // See RELEASE_ORDERS in page.ts for why this is a gate and not a clock.
      // \`?orders=auto\` is for a human opening the fixture in their own browser.
      // -------------------------------------------------------------------
      var released = false

      window.${RELEASE_ORDERS} = function () {
        if (released) return
        released = true

        var rows = ['1001', '1002', '1003']
          .map(function (id) {
            return (
              '<li class="row"><img src="data:image/gif;base64,' +
              'R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=" /> Order ' +
              id +
              '</li>'
            )
          })
          .join('')

        el('skeleton').outerHTML = '<ul id="results">' + rows + '</ul>'
      }

      if (new URLSearchParams(window.location.search).get('orders') === 'auto') {
        window.${RELEASE_ORDERS}()
      }

      // -------------------------------------------------------------------
      // The dialog.
      //
      // HAZARD dialog-unnamed — role="dialog" with no accessible name.
      // HAZARD background-hidden-focusable — the background is marked
      //   aria-hidden="true" and left focusable. \`inert\` is what this wanted.
      // HAZARD dialog-focus-not-moved — focus stays on the trigger.
      // -------------------------------------------------------------------
      el('edit').addEventListener('click', function () {
        var backdrop = document.createElement('div')
        backdrop.className = 'backdrop'
        backdrop.id = 'backdrop'

        var dialog = document.createElement('div')
        dialog.className = 'dialog'
        dialog.id = 'dialog'
        dialog.setAttribute('role', 'dialog')
        dialog.innerHTML =
          '<p>Preferences</p>' +
          '<p><label for="alerts">Alerts</label> <input id="alerts" type="checkbox" /></p>' +
          '<p><button id="dialog-close" type="button">Close</button></p>'

        el('main').setAttribute('aria-hidden', 'true')
        document.body.appendChild(backdrop)
        document.body.appendChild(dialog)

        el('dialog-close').addEventListener('click', function () {
          el('main').removeAttribute('aria-hidden')
          dialog.remove()
          backdrop.remove()
        })
      })

      // -------------------------------------------------------------------
      // The form.
      //
      // HAZARD name-describedby-dangling — aria-describedby points at
      //   "name-error"; the element written is "name-err". A typo, and the one
      //   error-state defect a static rule does catch.
      // HAZARD email-error-unassociated — the email error is prose next to the
      //   field and nothing more: no aria-invalid, no aria-describedby.
      // HAZARD error-not-announced — #errors is not a live region and the text
      //   appears in it after load, so nothing is announced.
      // HAZARD toast-inserted-with-content — the toast element is created with
      //   its message already inside it and then appended. A live region has to
      //   be in the accessibility tree *before* its content changes.
      // -------------------------------------------------------------------
      el('form').addEventListener('submit', function (event) {
        event.preventDefault()

        var name = el('name')
        var email = el('email')
        var errors = el('errors')

        errors.textContent = ''
        name.removeAttribute('aria-invalid')
        name.removeAttribute('aria-describedby')

        var nameMissing = name.value.trim() === ''
        var emailMissing = email.value.trim() === ''

        if (nameMissing || emailMissing) {
          var html = ''

          if (nameMissing) {
            name.setAttribute('aria-invalid', 'true')
            name.setAttribute('aria-describedby', 'name-error')
            html += '<span class="error" id="name-err">Name is required</span> '
          }

          if (emailMissing) {
            html += '<span class="error">Email is required</span>'
          }

          errors.innerHTML = html
          return
        }

        var toast = document.createElement('div')
        toast.className = 'toast'
        toast.id = 'toast'
        toast.setAttribute('role', 'status')
        toast.textContent = 'Preferences saved'
        document.body.appendChild(toast)
      })

      // -------------------------------------------------------------------
      // The route change.
      //
      // HAZARD route-focus-not-moved — the view is swapped and focus is left
      //   wherever the click put it. There is no DOM state that is wrong here;
      //   what is wrong is that nothing happened.
      // -------------------------------------------------------------------
      function show(view) {
        el('list-view').hidden = view !== 'list'
        el('details-view').hidden = view !== 'details'
      }

      el('to-details').addEventListener('click', function () {
        window.history.pushState({ view: 'details' }, '', '/details')
        show('details')
      })

      el('to-list').addEventListener('click', function () {
        window.history.pushState({ view: 'list' }, '', '/')
        show('list')
      })

      // Click only. Enter and Space on a div do not synthesise one.
      el('archive').addEventListener('click', function () {
        el('details-heading').textContent = 'Order 1001 (archived)'
      })

      // A direct load of /details starts on the details view, so the per-page
      // strategies reach it without the journey.
      if (window.location.pathname === '/details') {
        show('details')
      } else {
        show('list')
      }
    </script>
  </body>
</html>
`
