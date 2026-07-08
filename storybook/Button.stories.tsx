/**
 * Button.stories.tsx — Storybook 9 interaction test patterns.
 *
 * Demonstrates:
 *   - `play` functions with `@storybook/test` (userEvent, expect, within)
 *   - Spy functions via `fn()` to assert callbacks were called
 *   - Variant / args composition across stories
 *   - Disabled / loading state guards (no interactions fired)
 */

import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { Button } from './components/Button'

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  args: {
    onClick: fn(),
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'danger'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

// ---------------------------------------------------------------------------
// Visual baseline stories
// ---------------------------------------------------------------------------

export const Primary: Story = {
  args: { label: 'Submit', variant: 'primary' },
}

export const Secondary: Story = {
  args: { label: 'Cancel', variant: 'secondary' },
}

export const Danger: Story = {
  args: { label: 'Delete', variant: 'danger' },
}

export const Small: Story = {
  args: { label: 'Small', size: 'sm' },
}

export const Large: Story = {
  args: { label: 'Large', size: 'lg' },
}

export const Disabled: Story = {
  args: { label: 'Disabled', disabled: true },
}

export const Loading: Story = {
  args: { label: 'Save', loading: true },
}

// ---------------------------------------------------------------------------
// Interaction tests — these run in the Storybook test runner (Playwright)
// and are also visible in the Interactions panel during development.
// ---------------------------------------------------------------------------

/**
 * Verifies that a single click fires the `onClick` spy exactly once.
 */
export const ClickFiresCallback: Story = {
  name: 'Click fires onClick callback',
  args: { label: 'Click me', variant: 'primary' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /click me/i })

    await userEvent.click(button)

    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

/**
 * Verifies that a disabled button does not fire onClick.
 */
export const DisabledBlocksClick: Story = {
  name: 'Disabled button does not fire onClick',
  args: { label: 'Disabled', disabled: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /disabled/i })

    await expect(button).toBeDisabled()
    await userEvent.click(button, { skipHover: true })

    // onClick must NOT have been called
    await expect(args.onClick).not.toHaveBeenCalled()
  },
}

/**
 * Verifies that a loading button renders the loading label and is aria-busy.
 */
export const LoadingState: Story = {
  name: 'Loading state renders correct label and aria-busy',
  args: { label: 'Save', loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button')

    await expect(button).toHaveTextContent('Loading…')
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
  },
}

/**
 * Verifies that keyboard activation (Space / Enter) fires onClick.
 * This catches cases where onClick only handles mouse events.
 */
export const KeyboardActivation: Story = {
  name: 'Keyboard activation fires onClick',
  args: { label: 'Press me' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /press me/i })

    button.focus()
    await userEvent.keyboard(' ')

    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

/**
 * Verifies rapid double-click fires onClick twice (no accidental deduplication).
 */
export const RapidDoubleClick: Story = {
  name: 'Rapid double-click fires onClick twice',
  args: { label: 'Double click' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /double click/i })

    await userEvent.dblClick(button)

    await expect(args.onClick).toHaveBeenCalledTimes(2)
  },
}
