// @vitest-environment node
/**
 * `aaa-structure` under ESLint's own `RuleTester`.
 *
 * The rule's whole value is that it refuses a shape people write by accident,
 * so the invalid cases here are the specification: each one is a body somebody
 * would plausibly commit. The valid cases carry the other half — every place
 * the rule has to keep quiet, including the ones that look like violations
 * (`expect.assertions(1)` up in the arrange phase, a comment that merely
 * starts with the letters of a marker, a case with no callback to read).
 */

import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'

import { aaaStructure } from './aaaStructure.ts'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

ruleTester.run('aaa-structure', aaaStructure, {
  valid: [
    `it('refunds an unopened order', () => {
      // Arrange
      const order = sealed()

      // Act
      const decision = assess(order)

      // Assert
      expect(decision.outcome).toBe('full')
    })`,

    // Arrange is optional: plenty of tests have nothing to set up.
    `it('returns zero for an empty basket', () => {
      // Act
      const total = sum([])

      // Assert
      expect(total).toBe(0)
    })`,

    // Markers may be annotated, and may be lowercase.
    `it('rounds the fee', () => {
      // arrange: 85% of 1010 is exactly 858.5
      const price = 1010

      // Act — the tie has to break somewhere
      const refund = afterFee(price)

      // ASSERT
      expect(refund).toBe(859)
    })`,

    // `expect.assertions(…)` is a declaration about the test, not an assertion
    // about the system, and belongs exactly where it is.
    `it('rejects a bad address', async () => {
      // Arrange
      expect.assertions(1)

      // Act
      const attempt = register('nope')

      // Assert
      await expect(attempt).rejects.toThrow()
    })`,

    // A comment that merely begins with the letters of a marker.
    `it('returns the total', () => {
      // actually a note about the fixture
      const basket = full()

      // Act
      const total = sum(basket)

      // Assert
      expect(total).toBe(3)
    })`,

    // Nothing to read: `it.todo` has no callback, and a describe is not a case.
    "it.todo('handles partial refunds')",
    "describe('assess', () => { it('returns', () => { /* Act */ act(); /* Assert */ expect(1).toBe(1) }) })",
  ],

  invalid: [
    {
      code: `it('returns the total', () => {
        // Arrange
        const basket = full()

        // Assert
        expect(sum(basket)).toBe(3)
      })`,
      errors: [{ messageId: 'missingPhase' }],
    },
    {
      code: `it('returns the total', () => {
        // Act
        const total = sum(full())
      })`,
      errors: [{ messageId: 'missingPhase' }],
    },
    {
      code: `it('returns the total', () => {
        const basket = full()
      })`,
      // Both required markers are missing, and both are worth saying.
      errors: [{ messageId: 'missingPhase' }, { messageId: 'missingPhase' }],
    },
    {
      code: `it('refunds then charges', () => {
        // Act
        const first = refund()

        // Assert
        expect(first).toBe(1)

        // Act
        const second = charge()

        // Assert
        expect(second).toBe(2)
      })`,
      errors: [{ messageId: 'duplicatePhase' }, { messageId: 'duplicatePhase' }],
    },
    {
      code: `it('returns the total', () => {
        // Assert
        const basket = full()

        // Act
        expect(sum(basket)).toBe(3)
      })`,
      errors: [{ messageId: 'phaseOutOfOrder' }],
    },
    {
      code: `it('returns the total', () => {
        // Arrange
        // Act
        const total = sum(full())

        // Assert
        expect(total).toBe(3)
      })`,
      errors: [{ messageId: 'emptyPhase' }],
    },
    {
      code: "it('returns the total', () => expect(sum([])).toBe(0))",
      errors: [{ messageId: 'expressionBody' }],
    },
    {
      // The one the rule exists for: assert, act, assert.
      code: `it('refunds and then denies', () => {
        // Arrange
        const order = sealed()

        // Act
        const first = assess(order, day(1))
        expect(first.outcome).toBe('full')
        const second = assess(order, day(99))

        // Assert
        expect(second.outcome).toBe('denied')
      })`,
      errors: [{ messageId: 'assertionOutOfPhase' }],
    },
    {
      // An assertion smuggled into a helper defined during arrange is still an
      // assertion running before the assert phase.
      code: `it('returns the total', () => {
        // Arrange
        const check = (value) => expect(value).toBe(3)

        // Act
        const total = sum(full())

        // Assert
        check(total)
      })`,
      errors: [{ messageId: 'assertionOutOfPhase' }],
    },
  ],
})

const typescriptRuleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

typescriptRuleTester.run('aaa-structure (TypeScript source)', aaaStructure, {
  valid: [
    `it('returns the total', (): void => {
      // Act
      const total: number = sum([])

      // Assert
      expect(total).toBe(0)
    })`,
  ],
  invalid: [
    {
      code: `it('returns the total', async (): Promise<void> => {
        // Act
        const total: number = await sum([])
      })`,
      errors: [{ messageId: 'missingPhase' }],
    },
  ],
})
