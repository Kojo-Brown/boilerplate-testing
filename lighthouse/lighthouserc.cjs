// @ts-check
// .cjs extension required when package.json has "type": "module"
const budgets = require('./budgets.json');

/** @type {import('@lhci/cli').LighthouseRcJson} */
module.exports = {
  ci: {
    collect: {
      // Run Lighthouse 3 times per URL and use the median result
      numberOfRuns: 3,
      // Override these URLs for your project
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/login',
      ],
      // Adjust startServerCommand for your framework:
      //   Vite:    'pnpm preview'
      //   Next.js: 'pnpm start'
      //   CRA:     'pnpm serve'
      startServerCommand: 'pnpm preview',
      startServerReadyPattern: 'Local',
      startServerReadyTimeout: 30_000,
      settings: {
        // W3C Performance Budgets — loaded from budgets.json
        budgets,
        // Required for headless Chrome in CI
        chromeFlags: '--no-sandbox --disable-dev-shm-usage',
        // Simulate mobile (Moto G4 + Fast 4G) by default.
        // Switch to 'desktop' for desktop-only apps.
        // preset: 'desktop',
        // Throttle network to Fast 4G (matching Lighthouse's default)
        // throttlingMethod: 'simulate',
      },
    },

    assert: {
      // Assertions layer on top of budgets.json — set severity per audit.
      // 'error' fails the CI step; 'warn' prints a warning but passes.
      assertions: {
        // ── Lighthouse category scores ──────────────────────────────────
        'categories:performance':    ['error', { minScore: 0.9 }],
        'categories:accessibility':  ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo':            ['warn',  { minScore: 0.8 }],

        // ── Core Web Vitals (2024 "Good" thresholds) ────────────────────
        'first-contentful-paint':    ['error', { maxNumericValue: 2000 }],
        'largest-contentful-paint':  ['error', { maxNumericValue: 2500 }],
        'total-blocking-time':       ['error', { maxNumericValue: 300  }],
        'cumulative-layout-shift':   ['error', { maxNumericValue: 0.1  }],
        'speed-index':               ['warn',  { maxNumericValue: 3000 }],
        'interactive':               ['warn',  { maxNumericValue: 3500 }],

        // ── Accessibility: hard failures ────────────────────────────────
        'color-contrast':   ['error', {}],
        'image-alt':        ['error', {}],
        'document-title':   ['error', {}],
        'html-has-lang':    ['error', {}],
        'meta-description': ['warn',  {}],

        // ── Performance opportunities (warn only) ───────────────────────
        'render-blocking-resources': ['warn', {}],
        'unused-javascript':         ['warn', {}],
        'unused-css-rules':          ['warn', {}],
        'uses-text-compression':     ['warn', {}],
      },
    },

    upload: {
      // Free 7-day public storage — fine for open-source projects.
      // For private projects use a self-hosted LHCI server:
      //   target: 'lhci',
      //   serverBaseUrl: process.env.LHCI_SERVER_URL,
      //   token: process.env.LHCI_TOKEN,
      target: 'temporary-public-storage',
    },
  },
};
