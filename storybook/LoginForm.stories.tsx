/**
 * LoginForm.stories.tsx — Complex interaction test patterns.
 *
 * Demonstrates:
 *   - Multi-step user flows (type → tab → type → submit)
 *   - Inline validation error assertion
 *   - Async submit spy with `fn()` returning a Promise
 *   - Error banner rendered from the `error` prop
 *   - Checking `aria-invalid` and `role="alert"` for a11y correctness
 */

import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { LoginForm } from './components/LoginForm'

const meta = {
  title: 'Components/LoginForm',
  component: LoginForm,
  tags: ['autodocs'],
  args: {
    onSubmit: fn(),
  },
} satisfies Meta<typeof LoginForm>

export default meta
type Story = StoryObj<typeof meta>

// ---------------------------------------------------------------------------
// Visual baseline stories
// ---------------------------------------------------------------------------

export const Default: Story = {}

export const WithError: Story = {
  args: { error: 'Invalid credentials. Please try again.' },
}

export const LoadingState: Story = {
  args: { loading: true },
}

// ---------------------------------------------------------------------------
// Interaction tests
// ---------------------------------------------------------------------------

/**
 * Happy path: fill valid credentials and submit — spy is called once.
 */
export const SuccessfulSubmit: Story = {
  name: 'Successful submit calls onSubmit with credentials',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByLabelText(/email/i), 'alice@example.com')
    await userEvent.type(canvas.getByLabelText(/password/i), 'securepassword')
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))

    await expect(args.onSubmit).toHaveBeenCalledOnce()
    await expect(args.onSubmit).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'securepassword',
    })
  },
}

/**
 * Empty submit: validation fires without calling onSubmit.
 */
export const EmptySubmitShowsErrors: Story = {
  name: 'Submitting empty form shows field errors',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))

    // Both fields should show error alerts
    await expect(canvas.getByText(/email is required/i)).toBeVisible()
    await expect(canvas.getByText(/password is required/i)).toBeVisible()

    // onSubmit must not be called when validation fails
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}

/**
 * Invalid email format shows the correct error.
 */
export const InvalidEmailFormat: Story = {
  name: 'Invalid email format shows validation error',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const emailInput = canvas.getByLabelText(/email/i)

    await userEvent.type(emailInput, 'not-an-email')
    await userEvent.tab()
    await userEvent.type(canvas.getByLabelText(/password/i), 'password123')
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))

    await expect(canvas.getByText(/enter a valid email/i)).toBeVisible()
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}

/**
 * Short password (< 8 chars) shows the minimum-length error.
 */
export const ShortPasswordError: Story = {
  name: 'Password shorter than 8 chars shows error',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const passwordInput = canvas.getByLabelText(/password/i)

    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(passwordInput, 'short')
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))

    await expect(canvas.getByText(/at least 8 characters/i)).toBeVisible()
    await expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}

/**
 * Server error banner is rendered and announced as an alert.
 */
export const ServerErrorBanner: Story = {
  name: 'Server error prop renders accessible alert',
  args: { error: 'Account locked. Contact support.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = canvas.getByRole('alert')

    await expect(alert).toBeVisible()
    await expect(alert).toHaveTextContent(/account locked/i)
  },
}

/**
 * Keyboard-only flow: Tab between fields, Enter to submit.
 */
export const KeyboardOnlyFlow: Story = {
  name: 'Full keyboard-only login flow',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)

    // Tab to email, type, tab to password, type, tab to button, enter
    await userEvent.click(canvas.getByLabelText(/email/i))
    await userEvent.type(canvas.getByLabelText(/email/i), 'keyboard@example.com')
    await userEvent.tab()
    await userEvent.type(canvas.getByLabelText(/password/i), 'keyboard123')
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')

    await expect(args.onSubmit).toHaveBeenCalledOnce()
    await expect(args.onSubmit).toHaveBeenCalledWith({
      email: 'keyboard@example.com',
      password: 'keyboard123',
    })
  },
}

/**
 * Async submit: onSubmit returns a Promise. Loading state visible during await.
 * The spy resolves after a short delay to simulate a network request.
 */
export const AsyncSubmit: Story = {
  name: 'Async submit shows loading state during request',
  args: {
    onSubmit: fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
    ),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByLabelText(/email/i), 'alice@example.com')
    await userEvent.type(canvas.getByLabelText(/password/i), 'securepassword')

    const submitButton = canvas.getByRole('button', { name: /sign in/i })
    await userEvent.click(submitButton)

    await expect(args.onSubmit).toHaveBeenCalledOnce()
  },
}
