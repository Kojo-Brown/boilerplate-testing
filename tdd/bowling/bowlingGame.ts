export class BowlingGame {
  readonly #rolls: number[] = []

  roll(pins: number): void {
    this.#rolls.push(pins)
  }

  score(): number {
    return this.#rolls.reduce((total, pins) => total + pins, 0)
  }
}
