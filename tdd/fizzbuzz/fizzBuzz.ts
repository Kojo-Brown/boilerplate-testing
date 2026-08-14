/**
 * FizzBuzz.
 *
 * The rules are data, not control flow: each rule contributes its word when it
 * divides the number, and the answer is the concatenation of the words that
 * apply. "FizzBuzz" is then not a special case at all, it is what falls out
 * when both rules match — which is why adding a third rule costs one line here
 * and would have cost four more branches in the version this replaced.
 */

type Rule = {
  readonly divisor: number
  readonly word: string
}

const RULES: readonly Rule[] = [
  { divisor: 3, word: 'Fizz' },
  { divisor: 5, word: 'Buzz' },
]

export function fizzBuzz(n: number): string {
  const word = RULES.filter((rule) => n % rule.divisor === 0)
    .map((rule) => rule.word)
    .join('')

  return word === '' ? String(n) : word
}
