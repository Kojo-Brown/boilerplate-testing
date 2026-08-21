// @vitest-environment node
/**
 * `title-scheme` under ESLint's own `RuleTester`.
 *
 * A lint rule is a piece of production code whose failure mode is silence: a
 * rule that reports nothing looks exactly like a codebase with nothing wrong
 * in it. So the valid cases here matter as much as the invalid ones — several
 * of them exist only to pin down what the rule must *not* claim, which is the
 * half that decides whether anybody leaves it switched on.
 *
 * `RuleTester` discovers Vitest's global `describe`/`it`, so these run in the
 * ordinary `pnpm test` suite with no adapter.
 */

import { Linter, RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'

import plugin from './index.ts'
import { titleScheme } from './titleScheme.ts'
import { BANNED_OPENERS } from './vocabulary.ts'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

ruleTester.run('title-scheme (behaviour)', titleScheme, {
  valid: [
    "it('returns 404 for an unknown id', () => {})",
    "test('rejects a malformed address', () => {})",
    // Proper nouns and API names open plenty of honest titles in this repo.
    "it('POST /v1/orders creates an order', () => {})",
    "it('TypedTest.json() parses the body', () => {})",
    // The banned words are banned only as the *opening* word.
    "it('reports the check that failed', () => {})",
    "it('completes checkout when the card is saved', () => {})",
    // `describe` names a subject, not a behaviour, so it is left alone.
    "describe('should', () => { it('returns', () => {}) })",
    // Titles the rule cannot read are titles it says nothing about.
    'it(`${label}: returns 404`, () => {})',
    'it(titles[index], () => {})',
    // Parameterised forms still reach the title.
    "it.each([1, 2])('returns %i unchanged', () => {})",
    "it.skip('returns 404 for an unknown id', () => {})",
    // Not a test call at all.
    "submit('should be ignored', () => {})",
  ],
  invalid: [
    {
      code: "it('should return 404 for an unknown id', () => {})",
      errors: [{ messageId: 'bannedOpener' }],
    },
    {
      // Case and trailing punctuation are typing, not meaning.
      code: "test('Should: return 404', () => {})",
      errors: [{ messageId: 'bannedOpener' }],
    },
    {
      code: "it('it returns 404', () => {})",
      errors: [{ messageId: 'bannedOpener' }],
    },
    {
      code: "it('verifies the token is rejected', () => {})",
      errors: [{ messageId: 'bannedOpener' }],
    },
    {
      code: "it.each([1])('should handle %i', () => {})",
      errors: [{ messageId: 'bannedOpener' }],
    },
    {
      code: "it('   ', () => {})",
      errors: [{ messageId: 'emptyTitle' }],
    },
  ],
})

ruleTester.run('title-scheme (given-when-then)', titleScheme, {
  valid: [
    {
      code: `describe('Given a delivered order', () => {
        describe('When a refund is requested inside the window', () => {
          it('then the full price comes back', () => {})
        })
      })`,
      options: [{ scheme: 'given-when-then' }],
    },
    {
      // One Given, two Whens — the nesting this scheme is for.
      code: `describe('Given a delivered order', () => {
        describe('When it is unopened', () => { it('then it is refunded', () => {}) })
        describe('When it is opened', () => { it('then a fee is withheld', () => {}) })
      })`,
      options: [{ scheme: 'given-when-then' }],
    },
    {
      // A describe title built at run time silences the whole subtree rather
      // than producing an error the author cannot act on.
      code: `describe(context, () => {
        describe('anything', () => { it('at all', () => {}) })
      })`,
      options: [{ scheme: 'given-when-then' }],
    },
  ],
  invalid: [
    {
      code: `describe('a delivered order', () => {
        describe('When a refund is requested', () => { it('then it is denied', () => {}) })
      })`,
      options: [{ scheme: 'given-when-then' }],
      // One error, not three: a rejected describe stops the rule descending.
      errors: [{ messageId: 'expectedGiven' }],
    },
    {
      code: `describe('Given a delivered order', () => {
        describe('a refund is requested', () => { it('then it is denied', () => {}) })
      })`,
      options: [{ scheme: 'given-when-then' }],
      errors: [{ messageId: 'expectedWhen' }],
    },
    {
      code: `describe('Given a delivered order', () => {
        describe('When a refund is requested', () => {
          describe('When it is late', () => { it('then it is denied', () => {}) })
        })
      })`,
      options: [{ scheme: 'given-when-then' }],
      errors: [{ messageId: 'describeTooDeep' }],
    },
    {
      code: `describe('Given a delivered order', () => {
        describe('When a refund is requested', () => { it('it is denied', () => {}) })
      })`,
      options: [{ scheme: 'given-when-then' }],
      errors: [{ messageId: 'expectedThen' }],
    },
    {
      code: `describe('Given a delivered order', () => {
        it('then it is denied', () => {})
      })`,
      options: [{ scheme: 'given-when-then' }],
      errors: [{ messageId: 'thenOutsideWhen' }],
    },
    {
      // A bare case with no suite around it at all.
      code: "it('then it is denied', () => {})",
      options: [{ scheme: 'given-when-then' }],
      errors: [{ messageId: 'thenOutsideWhen' }],
    },
  ],
})

/**
 * The rules run over `.ts` files in real life, where `typescript-eslint`
 * produces the AST instead of espree. `ast.ts` is written structurally for
 * exactly that reason, and this is where the claim is checked rather than
 * asserted.
 */
const typescriptRuleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

typescriptRuleTester.run('title-scheme (TypeScript source)', titleScheme, {
  valid: ["it('returns 404 for an unknown id', (): void => { const id: string = 'x' })"],
  invalid: [
    {
      code: "it('should return 404', async (): Promise<void> => { await Promise.resolve() })",
      errors: [{ messageId: 'bannedOpener' }],
    },
  ],
})

/**
 * `RuleTester` documents cases one at a time, which is the right shape for a
 * reader and the wrong shape for a list. `Linter` is the same rule, driven
 * directly, so every published opener is exercised rather than the five that
 * happened to get their own case above — a word added to `BANNED_OPENERS` and
 * mistyped fails here instead of quietly banning nothing.
 */
function lintTitle(title: string): readonly string[] {
  const messages = new Linter().verify(`it('${title}', () => {})`, {
    plugins: { 'test-conventions': plugin },
    rules: { 'test-conventions/title-scheme': 'error' },
  })

  return messages.map((message) => message.messageId ?? message.message)
}

describe('the banned-opener list', () => {
  it('reports every opener it publishes', () => {
    const unreported = BANNED_OPENERS.filter(
      (opener) => !lintTitle(`${opener} something happens`).includes('bannedOpener'),
    )

    expect(unreported).toEqual([])
  })

  it('leaves the same words alone anywhere but the front', () => {
    const reported = BANNED_OPENERS.filter(
      (opener) => lintTitle(`refuses the ${opener} it was given`).length > 0,
    )

    expect(reported).toEqual([])
  })
})
