export function fizzBuzz(n: number): string {
  if (n % 3 === 0) {
    return 'Fizz'
  }

  return String(n)
}
