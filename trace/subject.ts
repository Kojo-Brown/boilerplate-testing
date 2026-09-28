/**
 * The application under test: one page, eight ways to break it.
 *
 * A guide to debugging CI failures needs failures, and inventing them at the
 * assertion — `expect(1).toBe(2)` — would measure nothing, because what a
 * trace contains depends entirely on *where* the failure came from. A locator
 * that matches nothing, a click the layout swallows, and an endpoint answering
 * 500 all present as "the test timed out"; they differ only in which channel of
 * the trace holds the reason. So each fault below is a real defect of a real
 * page, provoked by a query parameter, and `faults.ts` pairs it with the test
 * that trips over it.
 *
 * Like `visual/subject.ts` and `a11y/subject.ts`, this is a pure function of
 * its options: no server, no port, no clock. `server.ts` binds it, and
 * `subject.test.ts` audits the markup of every variant without either.
 *
 * ---------------------------------------------------------------------------
 * The page is deliberately dull
 * ---------------------------------------------------------------------------
 * A dashboard that fetches a summary and lists three rows. It has to be dull,
 * because every interesting thing in this directory is a property of the trace
 * rather than of the page, and a subject with its own animations, fonts and
 * timers would put noise into the network and console channels that the
 * evidence table would then have to explain away.
 */

/** The faults the page can be asked to exhibit. */
export const FAULT_NAMES = [
  'none',
  'renamed-element',
  'duplicate-label',
  'covered-button',
  'late-content',
  'failing-api',
  'hanging-api',
  'throwing-script',
] as const

export type FaultName = (typeof FAULT_NAMES)[number]

export function isFaultName(value: string): value is FaultName {
  return (FAULT_NAMES as readonly string[]).includes(value)
}

/** The id the healthy page gives its total, and the one `renamed-element` uses. */
export const TOTAL_ID = 'total'
export const RENAMED_TOTAL_ID = 'sum'

/** The accessible name the test clicks on, duplicated by `duplicate-label`. */
export const SAVE_LABEL = 'Save report'

/** The healthy endpoint, and the two the faulty variants ask instead. */
export const SUMMARY_PATH = '/api/summary'
export const BROKEN_PATH = '/api/broken'
export const SLOW_PATH = '/api/slow'

/**
 * Which endpoint each fault's page fetches.
 *
 * The fault picks the path rather than the server inferring it from a header,
 * so that `server.ts` stays a router over static answers and nothing in the
 * measurement depends on request order.
 */
const ENDPOINTS: Partial<Record<FaultName, string>> = {
  'failing-api': BROKEN_PATH,
  'hanging-api': SLOW_PATH,
}

/** What `/api/summary` answers with, and what the page renders from it. */
export const SUMMARY = { total: 1240, rows: ['Alpha', 'Beta', 'Gamma'] } as const

/** How long `late-content` waits before it renders the total, in milliseconds. */
export const LATE_CONTENT_DELAY_MS = 5_000

/** The message `throwing-script` throws, and the one the console channel keeps. */
export const THROWN_MESSAGE = 'Cannot read properties of null (reading "format")'

/** The placeholder `late-content` shows while it is waiting. */
export const PLACEHOLDER = '—'

/**
 * The document for one fault.
 *
 * The fetch is written out rather than bundled because the network channel of
 * the trace has to see a real request: an inlined constant would render the
 * same page and record nothing, and `failing-api` and `hanging-api` would then
 * be indistinguishable from `renamed-element`.
 */
export function render(fault: FaultName): string {
  const totalId = fault === 'renamed-element' ? RENAMED_TOTAL_ID : TOTAL_ID
  const endpoint = ENDPOINTS[fault] ?? SUMMARY_PATH

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Reports</title>
<!-- An empty data: icon, so the browser does not request /favicon.ico. That
     request would 404 and Chromium logs a 404 to the console, which would put
     one entry in the console channel of every single trace and turn the most
     load-bearing column of README.md's evidence table into noise. -->
<link rel="icon" href="data:,">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; }
  .actions { position: relative; }
  button { font: inherit; padding: 0.4rem 0.8rem; }
  #veil {
    position: absolute; inset: -8px;
    background: rgba(0, 0, 0, 0);
  }
</style>
</head>
<body>
<h1>Reports</h1>
<p>Total: <span id="${totalId}">${fault === 'late-content' ? PLACEHOLDER : ''}</span></p>
<ul id="rows"></ul>
<div class="actions">
  <button id="save">${SAVE_LABEL}</button>
  ${fault === 'duplicate-label' ? `<button id="save-draft">${SAVE_LABEL}</button>` : ''}
  ${fault === 'covered-button' ? '<div id="veil"></div>' : ''}
</div>
<p id="status"></p>
<script type="module">
${fault === 'throwing-script' ? `  const formatter = null\n  document.getElementById('status').textContent = formatter.format(0)\n` : ''}
  const response = await fetch(${JSON.stringify(endpoint)})

  if (!response.ok) {
    // The page's own handling of a bad answer: it stops. No banner, no retry,
    // and nothing logged — the page is silent about it, which is what makes
    // \`failing-api\` worth measuring.
    //
    // Its console channel is nevertheless not empty, and that was the surprise
    // of the first measurement: Chromium logs \`Failed to load resource: … 500\`
    // itself for any subresource that fails, whatever the page does or does not
    // do about it. So the cause reaches two channels here, and the page's own
    // silence is what keeps that finding about the browser rather than about
    // this fixture.
    document.getElementById('rows').dataset['state'] = 'error'
  } else {
    const summary = await response.json()

    for (const row of summary.rows) {
      const item = document.createElement('li')
      item.textContent = row
      document.getElementById('rows').append(item)
    }

${
  fault === 'late-content'
    ? `    await new Promise((resolve) => setTimeout(resolve, ${String(LATE_CONTENT_DELAY_MS)}))\n`
    : ''
}    document.getElementById(${JSON.stringify(totalId)}).textContent = String(summary.total)
  }

  document.getElementById('save').addEventListener('click', () => {
    document.getElementById('status').textContent = 'Saved'
  })
</script>
</body>
</html>
`
}
