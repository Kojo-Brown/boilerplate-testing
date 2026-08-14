const FRAMES_PER_GAME = 10
const PINS_PER_FRAME = 10

export class BowlingGame {
  readonly #rolls: number[] = []

  roll(pins: number): void {
    this.#rolls.push(pins)
  }

  score(): number {
    let total = 0
    let roll = 0

    for (let frame = 0; frame < FRAMES_PER_GAME; frame += 1) {
      if (this.#at(roll) + this.#at(roll + 1) === PINS_PER_FRAME) {
        total += PINS_PER_FRAME + this.#at(roll + 2)
      } else {
        total += this.#at(roll) + this.#at(roll + 1)
      }
      roll += 2
    }

    return total
  }

  /** Rolls that were never made count as zero, so short games still score. */
  #at(index: number): number {
    return this.#rolls[index] ?? 0
  }
}
