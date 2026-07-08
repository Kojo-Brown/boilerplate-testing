import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { checkA11y, axe, a11yMatchers, configureA11y } from './check'

// Register custom matcher for this suite
expect.extend(a11yMatchers)

afterAll(cleanup)

// ---------------------------------------------------------------------------
// Accessible components
// ---------------------------------------------------------------------------

function AccessibleForm(): React.JSX.Element {
  return (
    <form aria-label="Contact form">
      <div>
        <label htmlFor="name">Full name</label>
        <input id="name" type="text" autoComplete="name" />
      </div>
      <div>
        <label htmlFor="email">Email address</label>
        <input id="email" type="email" autoComplete="email" />
      </div>
      <button type="submit">Send message</button>
    </form>
  )
}

function AccessibleImage(): React.JSX.Element {
  return (
    <figure>
      <img src="/logo.svg" alt="Company logo" width={120} height={40} />
      <figcaption>Our company logo</figcaption>
    </figure>
  )
}

function AccessibleNav(): React.JSX.Element {
  return (
    <nav aria-label="Main navigation">
      <ul>
        <li><a href="/home">Home</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Inaccessible components (used to test violation detection)
// ---------------------------------------------------------------------------

function MissingAltImage(): React.JSX.Element {
  // eslint-disable-next-line jsx-a11y/alt-text
  return <img src="/logo.svg" />
}

function UnlabelledInput(): React.JSX.Element {
  return (
    <div>
      <input type="text" placeholder="Enter your name" />
    </div>
  )
}

function EmptyButton(): React.JSX.Element {
  return <button type="button" aria-label="" />
}

// ---------------------------------------------------------------------------
// checkA11y — throw-on-violation API
// ---------------------------------------------------------------------------

describe('checkA11y', () => {
  it('resolves without error for an accessible form', async () => {
    const { container } = render(<AccessibleForm />)
    await expect(checkA11y(container)).resolves.toMatchObject({ violations: [] })
  })

  it('resolves without error for an accessible image', async () => {
    const { container } = render(<AccessibleImage />)
    await expect(checkA11y(container)).resolves.toMatchObject({ violations: [] })
  })

  it('resolves without error for an accessible nav', async () => {
    const { container } = render(<AccessibleNav />)
    await expect(checkA11y(container)).resolves.toMatchObject({ violations: [] })
  })

  it('throws for an <img> missing alt attribute', async () => {
    const { container } = render(<MissingAltImage />)
    await expect(checkA11y(container)).rejects.toThrow(/image-alt|accessibility violation/i)
  })

  it('throws for an <input> missing an associated label', async () => {
    const { container } = render(<UnlabelledInput />)
    await expect(checkA11y(container)).rejects.toThrow(/label|accessibility violation/i)
  })

  it('throws for a button with an empty aria-label', async () => {
    const { container } = render(<EmptyButton />)
    await expect(checkA11y(container)).rejects.toThrow(/button-name|accessibility violation/i)
  })

  it('accepts RunOptions to disable specific rules', async () => {
    const { container } = render(<MissingAltImage />)
    await expect(
      checkA11y(container, {
        runOptions: { rules: { 'image-alt': { enabled: false } } },
      }),
    ).resolves.toBeDefined()
  })

  it('returns full AxeResults on success', async () => {
    const { container } = render(<AccessibleForm />)
    const results = await checkA11y(container)
    expect(results).toHaveProperty('violations')
    expect(results).toHaveProperty('passes')
    expect(results).toHaveProperty('incomplete')
    expect(results).toHaveProperty('inapplicable')
  })
})

// ---------------------------------------------------------------------------
// axe() — results-object API
// ---------------------------------------------------------------------------

describe('axe', () => {
  it('returns results with no violations for an accessible component', async () => {
    const { container } = render(<AccessibleForm />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it('returns violations for an inaccessible component', async () => {
    const { container } = render(<MissingAltImage />)
    const results = await axe(container)
    expect(results.violations.length).toBeGreaterThan(0)
    const ids = results.violations.map((v) => v.id)
    expect(ids).toContain('image-alt')
  })

  it('respects RunOptions passed directly', async () => {
    const { container } = render(<MissingAltImage />)
    const results = await axe(container, {
      rules: { 'image-alt': { enabled: false } },
    })
    const ids = results.violations.map((v) => v.id)
    expect(ids).not.toContain('image-alt')
  })
})

// ---------------------------------------------------------------------------
// toHaveNoViolations — custom matcher
// ---------------------------------------------------------------------------

describe('toHaveNoViolations', () => {
  it('passes for an accessible component', async () => {
    const { container } = render(<AccessibleNav />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('fails for an inaccessible component', async () => {
    const { container } = render(<MissingAltImage />)
    const results = await axe(container)
    expect(() => expect(results).toHaveNoViolations()).toThrow(
      /accessibility violation/i,
    )
  })

  it('works with .resolves chaining', async () => {
    const { container } = render(<AccessibleForm />)
    await expect(axe(container)).resolves.toHaveNoViolations()
  })
})

// ---------------------------------------------------------------------------
// configureA11y — global options
// ---------------------------------------------------------------------------

describe('configureA11y', () => {
  beforeAll(() => {
    configureA11y({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    })
  })

  afterAll(() => {
    // Reset to empty so other suites are not affected
    configureA11y({})
  })

  it('applies the global tag filter — accessible form still passes', async () => {
    const { container } = render(<AccessibleForm />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it('applies the global tag filter — image-alt violation still caught', async () => {
    const { container } = render(<MissingAltImage />)
    const results = await axe(container)
    const ids = results.violations.map((v) => v.id)
    expect(ids).toContain('image-alt')
  })
})
