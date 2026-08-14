/**
 * Ten-pin bowling scorer.
 *
 * Rolls arrive one at a time and are scored only when asked for, so the class
 * never has to decide what a partial frame is worth. score() walks exactly ten
 * frames over the roll list; the tenth frame's bonus deliveries are read as
 * bonuses of the tenth frame rather than being modelled as a frame of their
 * own, which is why there is no special case for it.
 */

const FRAMES_PER_GAME = 10
const PINS_PER_FRAME = 10

export class BowlingGame {
  readonly #rolls: number[] = []

  /** Record a delivery. Pins are not validated: the kata scores, it does not referee. */
  roll(pins: number): void {
    this.#rolls.push(pins)
  }

  score(): number {
    let total = 0
    let roll = 0

    for (let frame = 0; frame < FRAMES_PER_GAME; frame += 1) {
      if (this.#isStrike(roll)) {
        total += PINS_PER_FRAME + this.#strikeBonus(roll)
        roll += 1
      } else if (this.#isSpare(roll)) {
        total += PINS_PER_FRAME + this.#spareBonus(roll)
        roll += 2
      } else {
        total += this.#openFrame(roll)
        roll += 2
      }
    }

    return total
  }

  #isStrike(roll: number): boolean {
    return this.#at(roll) === PINS_PER_FRAME
  }

  #isSpare(roll: number): boolean {
    return this.#openFrame(roll) === PINS_PER_FRAME
  }

  #strikeBonus(roll: number): number {
    return this.#at(roll + 1) + this.#at(roll + 2)
  }

  #spareBonus(roll: number): number {
    return this.#at(roll + 2)
  }

  #openFrame(roll: number): number {
    return this.#at(roll) + this.#at(roll + 1)
  }

  /** Rolls that were never made count as zero, so short games still score. */
  #at(index: number): number {
    return this.#rolls[index] ?? 0
  }
}
