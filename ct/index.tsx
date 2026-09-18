/**
 * Mount hooks — the component-test counterpart of `react/renderWithProviders`.
 *
 * `beforeMount` runs in the browser around every `mount()` call, and is where
 * the providers an application wraps its tree in belong: a query client, a
 * store, a router, a theme. The hook below adds none, because these components
 * need none, and it is written out rather than omitted because it is the hook
 * a consumer copying this directory has to edit — the `<App />` it returns is
 * the seam.
 *
 * One rule it has to keep: whatever this returns, the component has to be its
 * root element. Wrapping `<App />` in a layout `<div>` here silently changes
 * what `mount()` resolves to — the locator every spec then holds is the
 * wrapper, and assertions about the component's own attributes and size
 * quietly become assertions about a div nobody wrote. Page-level styling
 * belongs in `index.html`, which is where the typography these specs measure
 * against is set.
 */

import { beforeMount } from '@playwright/experimental-ct-react/hooks'

beforeMount(async ({ App }) => <App />)
