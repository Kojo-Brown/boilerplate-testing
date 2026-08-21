/**
 * `test-conventions/aaa-structure` — the shaping half of the convention.
 *
 * Arrange-Act-Assert says a test body has three parts in one order. Written
 * down as marker comments, that claim becomes checkable, and this rule checks
 * the four things about it that are decidable from the text:
 *
 *   1. the required markers are present (`Act` and `Assert`; `Arrange` is
 *      optional, because plenty of honest tests set nothing up);
 *   2. they appear at most once each, in order;
 *   3. every marker has at least one statement under it — a heading over
 *      nothing is worse than no heading;
 *   4. **no `expect(…)` runs before the `Assert` marker.**
 *
 * The fourth is the one worth having. The other three keep a comment block
 * tidy; this one catches act-assert-act-assert bodies — the shape where a
 * failure tells you the test broke but not which step of it — and it catches
 * them by position, so moving one assertion up above the act is enough to fail
 * the build.
 *
 * What the rule cannot decide is the actual discipline: whether the statements
 * under `// Act` are *one* action. `context.report` has no opinion about
 * whether two calls are one step of a story or two, and neither does any
 * heuristic worth shipping. The rule enforces the shape; a reviewer still owns
 * the substance. `../README.md` says so in the same words, and
 * `../conventions.test.ts` checks that it still does.
 */

import type { Rule, SourceCode } from 'eslint'

import { isCallExpression, testCallKind } from './ast.ts'
import type { CallExpression, EsNode } from './ast.ts'
import { AAA_PHASES, REQUIRED_AAA_PHASES, markerPhase } from './vocabulary.ts'
import type { AaaPhase } from './vocabulary.ts'

interface BlockStatement extends EsNode {
  readonly type: 'BlockStatement'
  readonly body: readonly EsNode[]
}

interface FunctionNode extends EsNode {
  readonly body: EsNode
}

/**
 * Derived from ESLint's own API rather than imported from `@types/estree`,
 * which is only in this tree as somebody else's transitive dependency.
 */
type Comment = ReturnType<SourceCode['getCommentsInside']>[number]

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression'])

function rangeOf(node: unknown): readonly [number, number] | null {
  if (typeof node !== 'object' || node === null || !('range' in node)) {
    return null
  }

  const { range } = node as { range?: unknown }

  if (!Array.isArray(range) || typeof range[0] !== 'number' || typeof range[1] !== 'number') {
    return null
  }

  return [range[0], range[1]]
}

/**
 * The callback a runner will execute, or `null` when there is not one to look
 * at — `it.todo('…')`, or a case whose body is passed as a named function
 * declared elsewhere. Vitest allows options and a timeout around the callback,
 * so the search is for the first function-valued argument rather than the
 * second argument.
 */
function callbackBody(call: CallExpression): EsNode | null {
  const callback = call.arguments.find((argument) => FUNCTION_TYPES.has(argument.type))

  return callback === undefined ? null : (callback as FunctionNode).body
}

/** Where each phase's marker comment starts, and where it was written. */
interface Marker {
  readonly phase: AaaPhase
  readonly start: number
  readonly comment: Comment
}

/** One enclosing test case, so nested `expect(…)` calls can be placed. */
interface Frame {
  /** Offset of the `Assert` marker, or `null` when there is not one. */
  readonly assertStart: number | null
}

export const aaaStructure: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'require Arrange/Act/Assert marker comments in test bodies, in order, with no assertion before the Assert phase',
      url: 'https://github.com/Kojo-Brown/boilerplate-testing/blob/main/tdd/conventions/README.md',
    },
    schema: [],
    messages: {
      missingPhase:
        "This test body has no '// {{phase}}' marker. Arrange-Act-Assert bodies label at least Act and Assert.",
      duplicatePhase:
        "'// {{phase}}' appears twice in one test body. Two acts and two asserts are two tests.",
      phaseOutOfOrder:
        "'// {{phase}}' comes after a later phase. The order is Arrange, then Act, then Assert.",
      emptyPhase: "'// {{phase}}' has no statements under it. Drop the marker or move code under it.",
      expressionBody:
        'An Arrange-Act-Assert body needs statements to divide into phases; this case is a single expression. Give it a block body.',
      assertionOutOfPhase:
        "This `expect(…)` runs before the '// Assert' marker. Move it down, or split the test — an assertion in the middle of the act is a second test hiding in the first.",
    },
  },

  create(context) {
    const { sourceCode } = context
    const frames: Frame[] = []

    function markersIn(block: BlockStatement): Marker[] {
      const markers: Marker[] = []

      for (const comment of sourceCode.getCommentsInside(block as unknown as Rule.Node)) {
        const phase = markerPhase(comment.value)
        const range = rangeOf(comment)

        if (phase !== null && range !== null) {
          markers.push({ phase, start: range[0], comment })
        }
      }

      return markers
    }

    function reportAt(comment: Comment, messageId: string, phase: AaaPhase): void {
      if (comment.loc === undefined || comment.loc === null) {
        return
      }

      context.report({ loc: comment.loc, messageId, data: { phase } })
    }

    /** Duplicates and out-of-order markers, reported on the offending comment. */
    function checkSequence(markers: readonly Marker[]): void {
      const seen = new Set<AaaPhase>()
      let highestSoFar = -1

      for (const marker of markers) {
        if (seen.has(marker.phase)) {
          reportAt(marker.comment, 'duplicatePhase', marker.phase)

          continue
        }

        seen.add(marker.phase)

        const rank = AAA_PHASES.indexOf(marker.phase)

        if (rank < highestSoFar) {
          reportAt(marker.comment, 'phaseOutOfOrder', marker.phase)
        } else {
          highestSoFar = rank
        }
      }
    }

    /**
     * A phase is empty when no statement of the body begins between its marker
     * and the next one. Statements are the body's own, so a marker sitting
     * inside an object literal cannot make a phase look occupied.
     */
    function checkOccupancy(block: BlockStatement, markers: readonly Marker[]): void {
      const firstOf = new Map<AaaPhase, Marker>()

      for (const marker of markers) {
        if (!firstOf.has(marker.phase)) {
          firstOf.set(marker.phase, marker)
        }
      }

      const ordered = [...firstOf.values()].sort((left, right) => left.start - right.start)
      const statementStarts = block.body
        .map((statement) => rangeOf(statement))
        .filter((range): range is readonly [number, number] => range !== null)
        .map(([start]) => start)

      ordered.forEach((marker, index) => {
        const next = ordered[index + 1]
        const limit = next === undefined ? Number.POSITIVE_INFINITY : next.start
        const occupied = statementStarts.some((start) => start > marker.start && start < limit)

        if (!occupied) {
          reportAt(marker.comment, 'emptyPhase', marker.phase)
        }
      })
    }

    function enterCase(node: Rule.Node, call: CallExpression): void {
      const body = callbackBody(call)

      if (body === null) {
        frames.push({ assertStart: null })

        return
      }

      if (body.type !== 'BlockStatement') {
        context.report({ node, messageId: 'expressionBody' })
        frames.push({ assertStart: null })

        return
      }

      const block = body as BlockStatement
      const markers = markersIn(block)

      checkSequence(markers)
      checkOccupancy(block, markers)

      for (const phase of REQUIRED_AAA_PHASES) {
        if (!markers.some((marker) => marker.phase === phase)) {
          context.report({ node, messageId: 'missingPhase', data: { phase } })
        }
      }

      const assertMarker = markers.find((marker) => marker.phase === 'Assert')

      frames.push({ assertStart: assertMarker?.start ?? null })
    }

    /**
     * `expect(…)`, and only that. `expect.assertions(2)` and `expect.hasAssertions()`
     * are declarations about the test rather than assertions about the system,
     * and belong in the arrange phase, so the check looks for a bare
     * identifier callee rather than anything rooted at `expect`.
     */
    function isBareExpectCall(call: CallExpression): boolean {
      const { callee } = call

      return callee.type === 'Identifier' && (callee as { name?: unknown }).name === 'expect'
    }

    return {
      CallExpression(node): void {
        if (!isCallExpression(node)) {
          return
        }

        if (testCallKind(node) === 'case') {
          enterCase(node, node)

          return
        }

        const frame = frames.at(-1)

        if (frame === undefined || frame.assertStart === null || !isBareExpectCall(node)) {
          return
        }

        const range = rangeOf(node)

        if (range !== null && range[0] < frame.assertStart) {
          context.report({ node, messageId: 'assertionOutOfPhase' })
        }
      },

      'CallExpression:exit'(node): void {
        if (isCallExpression(node) && testCallKind(node) === 'case') {
          frames.pop()
        }
      },
    }
  },
}
