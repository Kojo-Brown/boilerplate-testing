/**
 * The syntax both rules share, and the one place that decides what counts as
 * a test.
 *
 * The rules in this folder are *syntactic*: they never consult the type
 * checker, because `pnpm lint` runs without type information (see
 * `eslint.config.js`) and because a convention you cannot check from the text
 * alone is a convention nobody can apply while typing. Everything here is
 * therefore a question about shape — is this call `it(...)`, does its first
 * argument spell out a title — and every question has an honest "cannot tell"
 * answer, which the rules treat as "not my business" rather than as a
 * violation.
 *
 * The node types are declared structurally rather than imported. ESLint hands
 * rules ESTree nodes while `typescript-eslint` parses the files into TSESTree
 * ones; the two disagree about plenty, but not about the handful of fields
 * used here. Declaring the intersection keeps `conventions.test.ts` able to
 * run these same helpers over an AST it parsed itself, so the README's claims
 * about the rules are derived from the code the rules actually run.
 */

/** The least a node has to have for anything here to look at it. */
export interface EsNode {
  readonly type: string
}

interface Identifier extends EsNode {
  readonly type: 'Identifier'
  readonly name: string
}

interface SimpleLiteral extends EsNode {
  readonly type: 'Literal'
  readonly value: unknown
}

interface TemplateElement extends EsNode {
  readonly value: { readonly cooked?: string | null; readonly raw: string }
}

interface TemplateLiteral extends EsNode {
  readonly type: 'TemplateLiteral'
  readonly quasis: readonly TemplateElement[]
  readonly expressions: readonly EsNode[]
}

interface MemberExpression extends EsNode {
  readonly type: 'MemberExpression'
  readonly object: EsNode
}

interface TaggedTemplateExpression extends EsNode {
  readonly type: 'TaggedTemplateExpression'
  readonly tag: EsNode
}

export interface CallExpression extends EsNode {
  readonly type: 'CallExpression'
  readonly callee: EsNode
  readonly arguments: readonly EsNode[]
}

export function isCallExpression(node: EsNode): node is CallExpression {
  return node.type === 'CallExpression'
}

/**
 * What a test call is: a suite (`describe`) or a case (`it`, `test`).
 *
 * `bench` and `describe.todo` are deliberately absent — a benchmark is not a
 * test and has no assertion to place, and there is nothing inside a `todo` to
 * check.
 */
export type TestCallKind = 'suite' | 'case'

const SUITE_NAMES = new Set(['describe', 'suite'])
const CASE_NAMES = new Set(['it', 'test'])

/**
 * Strip everything Vitest and Jest let you put between the runner's name and
 * the call: modifiers (`it.only`), the parameterised forms (`it.each([...])`,
 * `it.each\`table\``), and any combination of them (`describe.skip.each([])`).
 *
 * The answer is the root identifier, or `null` when the callee is an
 * expression whose name is not knowable from the text — `runner(...)`,
 * `suites[i](...)`. Those are the "cannot tell" cases.
 */
function rootIdentifier(callee: EsNode): string | null {
  let current = callee

  for (;;) {
    switch (current.type) {
      case 'Identifier':
        return (current as Identifier).name
      case 'MemberExpression':
        current = (current as MemberExpression).object
        break
      case 'CallExpression':
        current = (current as CallExpression).callee
        break
      case 'TaggedTemplateExpression':
        current = (current as TaggedTemplateExpression).tag
        break
      default:
        return null
    }
  }
}

/**
 * Classify a call, or return `null` if it is not a test call at all.
 *
 * A locally shadowed `it` would be misread as a test case. That is accepted:
 * the alternative is scope analysis for a name nobody shadows on purpose, and
 * the failure mode is a lint error on a line that is already confusing.
 */
export function testCallKind(node: CallExpression): TestCallKind | null {
  const name = rootIdentifier(node.callee)

  if (name === null) {
    return null
  }

  if (SUITE_NAMES.has(name)) {
    return 'suite'
  }

  return CASE_NAMES.has(name) ? 'case' : null
}

/**
 * The title of a test call, when the source spells it out.
 *
 * `null` covers three different situations that all deserve the same
 * treatment — no arguments at all, a title built at run time
 * (`` it(`${label}: rejects`) ``, `it(names[i])`), and a first argument that
 * is not a string. A rule that guessed at any of them would be reporting on
 * text it cannot see.
 */
export function staticTitle(node: CallExpression): string | null {
  const [first] = node.arguments

  if (first === undefined) {
    return null
  }

  if (first.type === 'Literal') {
    const { value } = first as SimpleLiteral

    return typeof value === 'string' ? value : null
  }

  if (first.type === 'TemplateLiteral') {
    const template = first as TemplateLiteral

    if (template.expressions.length > 0) {
      return null
    }

    const [only] = template.quasis

    return only?.value.cooked ?? null
  }

  return null
}

/**
 * The first word of a title, lowercased and stripped of leading punctuation,
 * or `''` when the title has no words in it.
 *
 * Leading punctuation is dropped so `"(slow) returns …"` is judged on
 * `returns`. Trailing punctuation is dropped so `should:` is judged on
 * `should` — the point of the rule is the word, not how it was typed.
 */
export function firstWord(title: string): string {
  const [word] = title.trim().split(/\s+/)

  return (word ?? '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '').toLowerCase()
}
