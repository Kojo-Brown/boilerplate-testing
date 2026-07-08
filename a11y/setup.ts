/**
 * Development-mode @axe-core/react integration.
 *
 * Patches ReactDOM so axe-core runs WCAG checks automatically after every
 * render and logs violations to the browser console as errors. This file
 * should only be loaded in development — never in production or tests.
 *
 * Usage in your app entry point (e.g. main.tsx):
 *
 *   if (import.meta.env.DEV) {
 *     const { initA11yDev } = await import('./a11y/setup')
 *     await initA11yDev()
 *   }
 *
 * Violations appear in the browser DevTools console grouped by rule and
 * impact level. Fix all critical / serious violations before shipping.
 */

import React from 'react'
import ReactDOM from 'react-dom'
import axe from '@axe-core/react'

const DEBOUNCE_MS = 1000

export async function initA11yDev(): Promise<void> {
  await axe(React, ReactDOM, DEBOUNCE_MS, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
    },
  })
}
