/**
 * Visual regression spec using `expect(page).toHaveScreenshot()`.
 *
 * Snapshots are stored in `playwright/visual.spec.ts-snapshots/` (one folder
 * per platform+browser to avoid OS font-rendering divergence).
 *
 * First run — generate baselines:
 *   pnpm test:e2e --update-snapshots playwright/visual.spec.ts
 *
 * Subsequent runs — compare against baselines:
 *   pnpm test:e2e playwright/visual.spec.ts
 *
 * CI — always compare; never auto-update:
 *   pnpm test:e2e --project=chromium playwright/visual.spec.ts
 *
 * A failed screenshot diff produces:
 *   playwright-results/<test-title>-diff.png   — pixel diff overlay
 *   playwright-results/<test-title>-actual.png — what was captured
 *   playwright-results/<test-title>-expected.png
 */
import { test, expect, renderHtml, setColorScheme } from './fixtures/visual'

// ---------------------------------------------------------------------------
// Minimal HTML fixtures (no dev server required)
// ---------------------------------------------------------------------------

const BUTTON_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #fff; color: #111; }
      .container { padding: 2rem; display: flex; gap: 1rem; flex-wrap: wrap; }
      button {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 0.5rem 1.25rem; border-radius: 6px; font-size: 0.875rem;
        font-weight: 500; cursor: pointer; border: 1.5px solid transparent;
        transition: background 120ms ease, box-shadow 120ms ease;
      }
      .btn-primary   { background: #2563eb; color: #fff; border-color: #2563eb; }
      .btn-secondary { background: #fff; color: #374151; border-color: #d1d5db; }
      .btn-danger    { background: #dc2626; color: #fff; border-color: #dc2626; }
      .btn-ghost     { background: transparent; color: #2563eb; border-color: transparent; }
      .btn-disabled  { opacity: 0.45; cursor: not-allowed; }
    </style>
  </head>
  <body>
    <div class="container">
      <button class="btn-primary">Primary</button>
      <button class="btn-secondary">Secondary</button>
      <button class="btn-danger">Danger</button>
      <button class="btn-ghost">Ghost</button>
      <button class="btn-primary btn-disabled" disabled>Disabled</button>
    </div>
  </body>
</html>
`

const CARD_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #f3f4f6; padding: 2rem; }
      .card {
        background: #fff; border-radius: 12px; padding: 1.5rem;
        box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08);
        max-width: 360px;
      }
      .card-title   { font-size: 1.125rem; font-weight: 600; color: #111827; }
      .card-meta    { font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem; }
      .card-body    { margin-top: 1rem; font-size: 0.875rem; color: #374151; line-height: 1.5; }
      .badge        {
        display: inline-block; padding: 2px 8px; border-radius: 999px;
        font-size: 0.7rem; font-weight: 600; background: #dbeafe; color: #1d4ed8;
        margin-top: 1rem;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="card-title">User profile</div>
      <div class="card-meta" data-dynamic>Updated just now</div>
      <div class="card-body">
        Full-stack engineer passionate about TypeScript and clean architecture.
        Building reliable systems one spec at a time.
      </div>
      <span class="badge">Active</span>
    </div>
  </body>
</html>
`

const FORM_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #fff; padding: 2rem; }
      .field       { margin-bottom: 1rem; }
      label        { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
      input, select {
        width: 100%; padding: 0.5rem 0.75rem; border: 1.5px solid #d1d5db;
        border-radius: 6px; font-size: 0.875rem; color: #111827;
        outline: none;
      }
      input:focus, select:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
      input[aria-invalid="true"] { border-color: #dc2626; }
      .error { font-size: 0.75rem; color: #dc2626; margin-top: 0.25rem; }
      .form  { max-width: 380px; }
      button {
        width: 100%; padding: 0.625rem; background: #2563eb; color: #fff;
        border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500;
        cursor: pointer; margin-top: 0.5rem;
      }
    </style>
  </head>
  <body>
    <form class="form" novalidate>
      <div class="field">
        <label for="email">Email address</label>
        <input id="email" type="email" placeholder="you@example.com" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" placeholder="••••••••" />
      </div>
      <div class="field">
        <label for="role">Role</label>
        <select id="role">
          <option value="">Select a role…</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
      </div>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>
`

const DARK_MODE_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      :root { --bg: #fff; --surface: #f9fafb; --text: #111827; --muted: #6b7280; --border: #e5e7eb; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #0f172a; --surface: #1e293b; --text: #f1f5f9; --muted: #94a3b8; --border: #334155; }
      }
      body   { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; padding: 2rem; }
      .panel {
        background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
        padding: 1.5rem; max-width: 340px;
      }
      h2     { font-size: 1rem; font-weight: 600; }
      p      { font-size: 0.875rem; color: var(--muted); margin-top: 0.5rem; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h2>Adaptive theme</h2>
      <p>This panel uses CSS custom properties that respond to prefers-color-scheme.</p>
    </div>
  </body>
</html>
`

const RESPONSIVE_HTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #fff; }
      nav  {
        display: flex; align-items: center; gap: 1rem;
        padding: 1rem 1.5rem; border-bottom: 1px solid #e5e7eb;
        background: #fff;
      }
      .logo    { font-weight: 700; font-size: 1.125rem; color: #111827; }
      .nav-links { display: flex; gap: 1rem; margin-left: auto; }
      .nav-links a { font-size: 0.875rem; color: #374151; text-decoration: none; }
      main   { padding: 2rem 1.5rem; }
      h1     { font-size: 1.5rem; font-weight: 700; color: #111827; }
      p      { color: #6b7280; margin-top: 0.5rem; font-size: 0.875rem; }
      .grid  { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
      .cell  { background: #f3f4f6; border-radius: 8px; padding: 1rem; font-size: 0.75rem; color: #374151; }
      @media (max-width: 640px) {
        .nav-links { display: none; }
      }
    </style>
  </head>
  <body>
    <nav>
      <span class="logo">Acme</span>
      <div class="nav-links">
        <a href="#">Dashboard</a>
        <a href="#">Settings</a>
        <a href="#">Help</a>
      </div>
    </nav>
    <main>
      <h1>Welcome back</h1>
      <p>Here is a summary of your recent activity.</p>
      <div class="grid">
        <div class="cell">Widget A</div>
        <div class="cell">Widget B</div>
        <div class="cell">Widget C</div>
      </div>
    </main>
  </body>
</html>
`

// ---------------------------------------------------------------------------
// 1. Full-page screenshots
// ---------------------------------------------------------------------------

test.describe('Full-page snapshots', () => {
  test('button variants render consistently', async ({ page, takePageSnapshot }) => {
    await renderHtml(page, BUTTON_HTML)
    await takePageSnapshot('buttons-all-variants')
  })

  test('card component renders consistently', async ({ page, takePageSnapshot }) => {
    await renderHtml(page, CARD_HTML)
    // [data-dynamic] is masked by the fixture's default selector list,
    // so the "Updated just now" text never causes a diff.
    await takePageSnapshot('card-default')
  })

  test('login form renders consistently', async ({ page, takePageSnapshot }) => {
    await renderHtml(page, FORM_HTML)
    await takePageSnapshot('form-login-empty')
  })
})

// ---------------------------------------------------------------------------
// 2. Element-level screenshots
// ---------------------------------------------------------------------------

test.describe('Element-level snapshots', () => {
  test('primary button isolated snapshot', async ({ page, takeElementSnapshot }) => {
    await renderHtml(page, BUTTON_HTML)
    const primaryBtn = page.locator('.btn-primary').first()
    await takeElementSnapshot(primaryBtn, 'button-primary')
  })

  test('card element snapshot', async ({ page, takeElementSnapshot }) => {
    await renderHtml(page, CARD_HTML)
    const card = page.locator('.card')
    await takeElementSnapshot(card, 'card-element')
  })

  test('form element snapshot', async ({ page, takeElementSnapshot }) => {
    await renderHtml(page, FORM_HTML)
    const form = page.locator('form')
    await takeElementSnapshot(form, 'form-login-element')
  })
})

// ---------------------------------------------------------------------------
// 3. Interactive state snapshots
// ---------------------------------------------------------------------------

test.describe('Interactive state snapshots', () => {
  test('form with validation error state', async ({ page, takeElementSnapshot }) => {
    await renderHtml(page, FORM_HTML)

    // Inject an invalid state on the email field
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#email')
      if (input) {
        input.setAttribute('aria-invalid', 'true')
        input.value = 'not-an-email'
        const err = document.createElement('div')
        err.className = 'error'
        err.textContent = 'Please enter a valid email address.'
        input.parentElement?.appendChild(err)
      }
    })

    await takeElementSnapshot(page.locator('.field').first(), 'form-email-error-state')
  })

  test('button hover state captured via :hover pseudo', async ({ page, takeElementSnapshot }) => {
    await renderHtml(page, BUTTON_HTML)

    await page.evaluate(() => {
      const style = document.createElement('style')
      // Force hover appearance permanently so it's captured in the snapshot
      style.textContent = '.btn-primary.force-hover { background: #1d4ed8 !important; border-color: #1d4ed8 !important; }'
      document.head.appendChild(style)
      document.querySelector('.btn-primary')?.classList.add('force-hover')
    })

    await takeElementSnapshot(
      page.locator('.btn-primary').first(),
      'button-primary-hover',
    )
  })
})

// ---------------------------------------------------------------------------
// 4. Dark mode vs light mode
// ---------------------------------------------------------------------------

test.describe('Dark / light mode snapshots', () => {
  test('panel in light mode', async ({ page, takeElementSnapshot }) => {
    await setColorScheme(page, 'light')
    await renderHtml(page, DARK_MODE_HTML)
    await takeElementSnapshot(page.locator('.panel'), 'panel-light')
  })

  test('panel in dark mode', async ({ page, takeElementSnapshot }) => {
    await setColorScheme(page, 'dark')
    await renderHtml(page, DARK_MODE_HTML)
    await takeElementSnapshot(page.locator('.panel'), 'panel-dark')
  })
})

// ---------------------------------------------------------------------------
// 5. Responsive viewport snapshots
// ---------------------------------------------------------------------------

test.describe('Responsive layout snapshots', () => {
  const VIEWPORTS = [
    { label: 'mobile', width: 375, height: 667 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1280, height: 800 },
  ] as const

  for (const vp of VIEWPORTS) {
    test(`layout at ${vp.label} (${vp.width}×${vp.height})`, async ({
      page,
      takePageSnapshot,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await renderHtml(page, RESPONSIVE_HTML)
      await takePageSnapshot(`responsive-${vp.label}`)
    })
  }
})

// ---------------------------------------------------------------------------
// 6. Masking dynamic content
// ---------------------------------------------------------------------------

test.describe('Masking dynamic content', () => {
  const WITH_DYNAMIC_HTML = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: system-ui, sans-serif; padding: 2rem; }
          .widget { border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; max-width: 320px; }
          .id     { font-family: monospace; font-size: 0.75rem; color: #6b7280; }
          time    { font-size: 0.75rem; color: #9ca3af; }
          h3      { font-size: 1rem; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="widget">
          <h3>Order #<span data-testid="order-id">ORD-${Math.random().toString(36).slice(2, 9).toUpperCase()}</span></h3>
          <p class="id">Tracking: TRK-${Date.now()}</p>
          <time datetime="${new Date().toISOString()}" data-testid="timestamp">
            ${new Date().toLocaleString()}
          </time>
        </div>
      </body>
    </html>
  `

  test('masks timestamps and dynamic IDs', async ({ page, takePageSnapshot }) => {
    await renderHtml(page, WITH_DYNAMIC_HTML)

    // Mask the order ID and tracking ID in addition to <time> (masked by default fixture).
    await takePageSnapshot('widget-with-masked-dynamic-content', {
      mask: ['[data-testid="order-id"]', '.id'],
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Snapshot options — threshold and maxDiffPixels
// ---------------------------------------------------------------------------

test.describe('Snapshot configuration', () => {
  test('strict threshold — zero-tolerance for pixel differences', async ({
    page,
    takePageSnapshot,
  }) => {
    await renderHtml(page, BUTTON_HTML)
    await takePageSnapshot('buttons-strict', {
      threshold: 0,
      maxDiffPixels: 0,
    })
  })

  test('relaxed threshold — tolerates minor anti-aliasing differences', async ({
    page,
    takePageSnapshot,
  }) => {
    await renderHtml(page, BUTTON_HTML)
    await takePageSnapshot('buttons-relaxed', {
      threshold: 0.3,
      maxDiffPixels: 200,
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Clipped / partial-page screenshots
// ---------------------------------------------------------------------------

test.describe('Clipped snapshots', () => {
  test('captures only the first button in the toolbar', async ({
    page,
    takePageSnapshot,
  }) => {
    await renderHtml(page, BUTTON_HTML)
    // Clip to the top-left 160×60 px region where the primary button lives
    await takePageSnapshot('button-primary-clipped', {
      clip: { x: 32, y: 32, width: 120, height: 44 },
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Inline toHaveScreenshot — direct API reference
//
//    These tests do NOT go through the fixture helpers. They show
//    the raw Playwright API for readers who just want the call signatures.
// ---------------------------------------------------------------------------

test.describe('Direct toHaveScreenshot API examples', () => {
  test('page.toHaveScreenshot with all options spelled out', async ({ page, freezePage }) => {
    await renderHtml(page, BUTTON_HTML)
    await freezePage()

    await expect(page).toHaveScreenshot('buttons-direct-api.png', {
      // Pixel luminance threshold per channel (0–1). 0 = exact, 1 = ignore all.
      threshold: 0.2,
      // Maximum number of pixels allowed to differ.
      maxDiffPixels: 50,
      // Capture the full scrollable page, not just the visible viewport.
      fullPage: false,
      // Disable CSS animations / transitions for deterministic captures.
      animations: 'disabled',
      // Locators whose bounding boxes are filled with a solid colour before capture.
      mask: [page.locator('[data-dynamic]')],
    })
  })

  test('locator.toHaveScreenshot with all options spelled out', async ({ page, freezePage }) => {
    await renderHtml(page, CARD_HTML)
    await freezePage()

    await expect(page.locator('.card')).toHaveScreenshot('card-direct-api.png', {
      threshold: 0.2,
      maxDiffPixels: 50,
      animations: 'disabled',
    })
  })
})
