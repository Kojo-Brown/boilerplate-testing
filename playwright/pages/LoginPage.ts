import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

export class LoginPage {
  readonly page: Page

  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator
  readonly forgotPasswordLink: Locator
  readonly registerLink: Locator

  constructor(page: Page) {
    this.page = page

    this.emailInput = page
      .getByTestId('login-email')
      .or(page.getByRole('textbox', { name: /email/i }))
    this.passwordInput = page
      .getByTestId('login-password')
      .or(page.getByRole('textbox', { name: /password/i }))
    this.submitButton = page
      .getByTestId('login-submit')
      .or(page.getByRole('button', { name: /sign in|log in|login/i }))
    this.errorMessage = page
      .getByTestId('login-error')
      .or(page.getByRole('alert'))
    this.forgotPasswordLink = page
      .getByTestId('login-forgot-password')
      .or(page.getByRole('link', { name: /forgot.*password/i }))
    this.registerLink = page
      .getByTestId('login-register')
      .or(page.getByRole('link', { name: /register|sign up|create account/i }))
  }

  async goto(): Promise<void> {
    await this.page.goto('/login')
    await this.page.waitForURL(/\/login/)
  }

  async fillEmail(email: string): Promise<void> {
    await this.emailInput.click()
    await this.emailInput.fill(email)
  }

  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.click()
    await this.passwordInput.fill(password)
  }

  async submit(): Promise<void> {
    await this.submitButton.click()
  }

  /** Fill credentials and submit in one call. */
  async login(email: string, password: string): Promise<void> {
    await this.fillEmail(email)
    await this.fillPassword(password)
    await this.submit()
  }

  /** Assert the error alert is visible and optionally matches text. */
  async expectError(text?: string | RegExp): Promise<void> {
    await expect(this.errorMessage).toBeVisible()
    if (text !== undefined) {
      await expect(this.errorMessage).toContainText(text)
    }
  }

  /** Assert email field validation error is shown. */
  async expectEmailValidationError(): Promise<void> {
    const emailField = this.emailInput
    await expect(emailField).toHaveAttribute('aria-invalid', 'true')
  }

  /** Assert the page redirects away from /login after successful login. */
  async expectLoginSuccess(redirectPath = '/dashboard'): Promise<void> {
    await this.page.waitForURL(new RegExp(redirectPath))
  }

  /** Assert the form is idle (submit button enabled, no spinner). */
  async expectFormReady(): Promise<void> {
    await expect(this.submitButton).toBeEnabled()
    await expect(this.submitButton).not.toContainText(/loading|submitting/i)
  }

  async expectSubmitDisabled(): Promise<void> {
    await expect(this.submitButton).toBeDisabled()
  }

  async expectEmailValue(email: string): Promise<void> {
    await expect(this.emailInput).toHaveValue(email)
  }
}
