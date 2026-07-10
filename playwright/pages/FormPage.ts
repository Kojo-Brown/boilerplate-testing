import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

export interface FormFieldValues {
  [fieldName: string]: string | boolean | string[]
}

export class FormPage {
  readonly page: Page

  readonly form: Locator
  readonly submitButton: Locator
  readonly resetButton: Locator
  readonly successMessage: Locator
  readonly globalError: Locator

  constructor(page: Page, formSelector?: string) {
    this.page = page

    this.form = formSelector
      ? page.locator(formSelector)
      : page.getByTestId('main-form').or(page.locator('form').first())

    this.submitButton = this.form
      .getByTestId('form-submit')
      .or(this.form.getByRole('button', { name: /submit|save|send|confirm/i }))
    this.resetButton = this.form
      .getByTestId('form-reset')
      .or(this.form.getByRole('button', { name: /reset|clear|cancel/i }))
    this.successMessage = page
      .getByTestId('form-success')
      .or(page.getByRole('status').filter({ hasText: /success|saved|submitted/i }))
    this.globalError = page
      .getByTestId('form-error')
      .or(page.getByRole('alert').first())
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path)
    await this.page.waitForURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await expect(this.form).toBeVisible()
  }

  // ---------------------------------------------------------------------------
  // Field interactions
  // ---------------------------------------------------------------------------

  /** Get a text / email / number / textarea field by its label text. */
  fieldByLabel(label: string | RegExp): Locator {
    return this.form.getByLabel(label)
  }

  /** Get a field by its data-testid. */
  fieldByTestId(testId: string): Locator {
    return this.form.getByTestId(testId)
  }

  /** Fill a text / email / number / textarea field. */
  async fill(label: string | RegExp, value: string): Promise<void> {
    const field = this.fieldByLabel(label)
    await field.click()
    await field.fill(value)
  }

  /** Select an option from a `<select>` element. */
  async select(label: string | RegExp, value: string): Promise<void> {
    await this.form.getByLabel(label).selectOption(value)
  }

  /** Check or uncheck a checkbox by label. */
  async setCheckbox(label: string | RegExp, checked: boolean): Promise<void> {
    const box = this.form.getByLabel(label)
    if (checked) {
      await box.check()
    } else {
      await box.uncheck()
    }
  }

  /** Select a radio button by its visible label. */
  async selectRadio(groupLabel: string | RegExp, optionLabel: string | RegExp): Promise<void> {
    const group = this.form.getByRole('group', { name: groupLabel })
    await group.getByRole('radio', { name: optionLabel }).check()
  }

  /**
   * Fill multiple fields at once using a map of label → value.
   *
   * @example
   * await formPage.fillAll({ 'First name': 'Alice', 'Email': 'alice@example.com' })
   */
  async fillAll(fields: Record<string, string>): Promise<void> {
    for (const [label, value] of Object.entries(fields)) {
      await this.fill(label, value)
    }
  }

  async submit(): Promise<void> {
    await this.submitButton.click()
  }

  async reset(): Promise<void> {
    await this.resetButton.click()
  }

  // ---------------------------------------------------------------------------
  // Assertions
  // ---------------------------------------------------------------------------

  /** Assert a field-level validation error is shown (by label). */
  async expectFieldError(label: string | RegExp, text?: string | RegExp): Promise<void> {
    const field = this.fieldByLabel(label)
    await expect(field).toHaveAttribute('aria-invalid', 'true')

    const describedById = await field.getAttribute('aria-describedby')
    if (describedById) {
      const errorEl = this.page.locator(`#${describedById}`)
      await expect(errorEl).toBeVisible()
      if (text !== undefined) {
        await expect(errorEl).toContainText(text)
      }
    }
  }

  /** Assert the form-level success message is visible. */
  async expectSuccess(text?: string | RegExp): Promise<void> {
    await expect(this.successMessage).toBeVisible()
    if (text !== undefined) {
      await expect(this.successMessage).toContainText(text)
    }
  }

  /** Assert a global form error alert is visible. */
  async expectGlobalError(text?: string | RegExp): Promise<void> {
    await expect(this.globalError).toBeVisible()
    if (text !== undefined) {
      await expect(this.globalError).toContainText(text)
    }
  }

  /** Assert the form is in a clean, valid state (no errors). */
  async expectNoErrors(): Promise<void> {
    const invalidFields = this.form.locator('[aria-invalid="true"]')
    await expect(invalidFields).toHaveCount(0)

    const alertCount = await this.globalError.count()
    if (alertCount > 0) {
      await expect(this.globalError).not.toBeVisible()
    }
  }

  /** Assert the submit button is disabled. */
  async expectSubmitDisabled(): Promise<void> {
    await expect(this.submitButton).toBeDisabled()
  }

  /** Assert the submit button is enabled. */
  async expectSubmitEnabled(): Promise<void> {
    await expect(this.submitButton).toBeEnabled()
  }

  /** Assert a field has the given value. */
  async expectFieldValue(label: string | RegExp, value: string): Promise<void> {
    await expect(this.fieldByLabel(label)).toHaveValue(value)
  }

  /** Assert a field is marked required via aria-required. */
  async expectRequired(label: string | RegExp): Promise<void> {
    const field = this.fieldByLabel(label)
    const required = await field.getAttribute('required')
    const ariaRequired = await field.getAttribute('aria-required')
    const isRequired = required !== null || ariaRequired === 'true'
    expect(isRequired, `Expected field "${label}" to be required`).toBe(true)
  }

  /** Assert the form is visible and the submit button is present. */
  async expectFormVisible(): Promise<void> {
    await expect(this.form).toBeVisible()
    await expect(this.submitButton).toBeVisible()
  }
}
