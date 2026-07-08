import axeCore, { type AxeResults, type RunOptions } from 'axe-core'

// ---------------------------------------------------------------------------
// Global configuration
// ---------------------------------------------------------------------------

let globalAxeOptions: RunOptions = {}

/**
 * Override global axe options for all checkA11y / axe calls in this process.
 * Call once in vitest/setup.ts to configure rules project-wide.
 *
 * @example
 *   configureA11y({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
 */
export function configureA11y(options: RunOptions): void {
  globalAxeOptions = { ...options }
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

export interface A11yCheckOptions {
  /** axe RunOptions merged with (and overriding) the global config. */
  runOptions?: RunOptions
}

/**
 * Run axe-core on a DOM element and throw a human-readable error if any
 * violations are found. Designed to be awaited directly in Vitest tests.
 *
 * @example
 *   const { container } = render(<MyForm />)
 *   await checkA11y(container)
 */
export async function checkA11y(
  element: Element | Document,
  options: A11yCheckOptions = {},
): Promise<AxeResults> {
  const results = await axeCore.run(element, {
    ...globalAxeOptions,
    ...options.runOptions,
  })

  if (results.violations.length > 0) {
    const details = results.violations
      .map((v) => {
        const nodes = v.nodes
          .map((n) => `    • ${n.failureSummary ?? '(no summary)'}\n      html: ${n.html}`)
          .join('\n')
        return `[${v.impact?.toUpperCase() ?? 'UNKNOWN'}] ${v.id}: ${v.description}\n${nodes}`
      })
      .join('\n\n')

    throw new Error(
      `Found ${results.violations.length} accessibility violation(s):\n\n${details}`,
    )
  }

  return results
}

/**
 * Run axe-core on a DOM element and return the full AxeResults.
 * Pair with `expect(results).toHaveNoViolations()` for assertion-style usage.
 *
 * @example
 *   const { container } = render(<MyForm />)
 *   const results = await axe(container)
 *   expect(results).toHaveNoViolations()
 */
export async function axe(
  element: Element | Document,
  options: RunOptions = {},
): Promise<AxeResults> {
  return axeCore.run(element, { ...globalAxeOptions, ...options })
}

// ---------------------------------------------------------------------------
// Custom Vitest matcher
// ---------------------------------------------------------------------------

/**
 * Custom matcher for Vitest. Register once in a setup file:
 *
 *   import { a11yMatchers } from '@/a11y/check'
 *   expect.extend(a11yMatchers)
 *
 * Then in tests:
 *   const results = await axe(container)
 *   expect(results).toHaveNoViolations()
 */
export const a11yMatchers = {
  toHaveNoViolations(received: AxeResults) {
    const { violations } = received

    if (violations.length === 0) {
      return {
        pass: true,
        message: () => 'Expected accessibility violations but found none',
      }
    }

    const details = violations
      .map((v) => {
        const nodes = v.nodes
          .map((n) => `    • ${n.failureSummary ?? '(no summary)'}\n      html: ${n.html}`)
          .join('\n')
        return `[${v.impact?.toUpperCase() ?? 'UNKNOWN'}] ${v.id}: ${v.description}\n${nodes}`
      })
      .join('\n\n')

    return {
      pass: false,
      message: () =>
        `Found ${violations.length} accessibility violation(s):\n\n${details}`,
    }
  },
}

// ---------------------------------------------------------------------------
// Type augmentation for Vitest
// ---------------------------------------------------------------------------

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R = void> {
    toHaveNoViolations(): R
  }
}
