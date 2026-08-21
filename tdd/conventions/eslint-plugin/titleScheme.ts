/**
 * `test-conventions/title-scheme` — the naming half of the convention.
 *
 * Two schemes, one rule, because a file has exactly one of them and a project
 * that mixes them per-directory wants to say so in one place:
 *
 *   - **`behaviour`** (the default, and what this repository runs everywhere):
 *     a case title states what the system does. The rule does not try to
 *     recognise a good sentence — it cannot — it rejects the openers that are
 *     reliably a worse one. See `vocabulary.ts` for which, and why.
 *   - **`given-when-then`**: the structure lives in the titles, so the rule
 *     can check the structure. `Given` describes at the top, `When` describes
 *     inside them, `then` cases inside those. This is much the stronger of the
 *     two checks, precisely because the convention says much more.
 *
 * Titles the source does not spell out are never reported. A dynamic title is
 * text this rule cannot see, and inventing a verdict about it would turn the
 * rule into a reason to stop parameterising tests.
 */

import type { Rule } from 'eslint'

import { firstWord, isCallExpression, staticTitle, testCallKind } from './ast.ts'
import type { CallExpression } from './ast.ts'
import { BANNED_OPENERS, GWT_PREFIXES, isBannedOpener } from './vocabulary.ts'

export const SCHEMES = ['behaviour', 'given-when-then'] as const

export type Scheme = (typeof SCHEMES)[number]

export const DEFAULT_SCHEME: Scheme = 'behaviour'

export function readScheme(options: readonly unknown[]): Scheme {
  const [first] = options

  if (typeof first !== 'object' || first === null || !('scheme' in first)) {
    return DEFAULT_SCHEME
  }

  const { scheme } = first as { scheme?: unknown }

  return SCHEMES.find((candidate) => candidate === scheme) ?? DEFAULT_SCHEME
}

/**
 * What an enclosing `describe` established.
 *
 * `unknown` is the load-bearing one: it marks a suite whose title the rule
 * could not read, or one it has already reported on. Either way its children
 * are left alone, so one mis-titled describe produces one error instead of one
 * error per case underneath it.
 */
type Level = 'given' | 'when' | 'unknown'

export const titleScheme: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'enforce a test-title naming scheme: behaviour sentences, or Given/When/Then structure',
      url: 'https://github.com/Kojo-Brown/boilerplate-testing/blob/main/tdd/conventions/README.md',
    },
    schema: [
      {
        type: 'object',
        properties: {
          scheme: { enum: [...SCHEMES] },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      bannedOpener:
        "Test titles say what the system does. '{{title}}' opens with '{{opener}}' — drop it and lead with the verb ('returns …', not 'should return …').",
      emptyTitle: 'A test title cannot be blank: this case reports as an empty line.',
      expectedGiven:
        "A Given/When/Then suite opens its outermost describe with 'Given ' — found '{{title}}'.",
      expectedWhen: "Inside a 'Given' describe, the next level is 'When ' — found '{{title}}'.",
      describeTooDeep:
        "Given/When/Then is two levels of describe; '{{title}}' would be a third. Split the suite rather than nesting further.",
      expectedThen: "A Given/When/Then case opens with 'then ' — found '{{title}}'.",
      thenOutsideWhen:
        "'{{title}}' is not inside a 'When ' describe, so its sentence has no when-clause. Wrap it in one.",
    },
  },

  create(context) {
    const scheme = readScheme(context.options as readonly unknown[])
    /** One frame per enclosing `describe`, innermost last. */
    const suites: Level[] = []

    /**
     * ESLint's `CallExpression` visitor key and `typescript-eslint`'s node of
     * the same name agree on everything `ast.ts` reads, but they are not the
     * same declared type. Narrowing structurally is what lets one rule serve
     * both, and `conventions.test.ts` run the same helpers over its own parse.
     */
    function asTestCall(node: Rule.Node): CallExpression | null {
      return isCallExpression(node) ? node : null
    }

    function enterSuite(node: Rule.Node, call: CallExpression): void {
      if (scheme !== 'given-when-then') {
        suites.push('unknown')

        return
      }

      const title = staticTitle(call)
      const parent = suites.at(-1)

      if (title === null || parent === 'unknown') {
        suites.push('unknown')

        return
      }

      const reject = (messageId: 'expectedGiven' | 'expectedWhen' | 'describeTooDeep'): void => {
        context.report({ node, messageId, data: { title } })
        suites.push('unknown')
      }

      if (parent === undefined) {
        if (title.startsWith(GWT_PREFIXES.given)) {
          suites.push('given')
        } else {
          reject('expectedGiven')
        }

        return
      }

      if (parent === 'given') {
        if (title.startsWith(GWT_PREFIXES.when)) {
          suites.push('when')
        } else {
          reject('expectedWhen')
        }

        return
      }

      reject('describeTooDeep')
    }

    function checkBehaviourCase(node: Rule.Node, title: string): void {
      if (title.trim() === '') {
        context.report({ node, messageId: 'emptyTitle' })

        return
      }

      const opener = firstWord(title)

      if (isBannedOpener(opener)) {
        context.report({ node, messageId: 'bannedOpener', data: { title, opener } })
      }
    }

    function checkGwtCase(node: Rule.Node, title: string): void {
      const parent = suites.at(-1)

      if (parent === 'unknown') {
        return
      }

      if (parent !== 'when') {
        context.report({ node, messageId: 'thenOutsideWhen', data: { title } })

        return
      }

      if (!title.startsWith(GWT_PREFIXES.then)) {
        context.report({ node, messageId: 'expectedThen', data: { title } })
      }
    }

    return {
      CallExpression(node): void {
        const call = asTestCall(node)

        if (call === null) {
          return
        }

        const kind = testCallKind(call)

        if (kind === 'suite') {
          enterSuite(node, call)

          return
        }

        if (kind !== 'case') {
          return
        }

        const title = staticTitle(call)

        if (title === null) {
          return
        }

        if (scheme === 'behaviour') {
          checkBehaviourCase(node, title)
        } else {
          checkGwtCase(node, title)
        }
      },

      'CallExpression:exit'(node): void {
        const call = asTestCall(node)

        if (call !== null && testCallKind(call) === 'suite') {
          suites.pop()
        }
      },
    }
  },
}

/** Re-exported so the README audit can list exactly what the rule bans. */
export { BANNED_OPENERS }
