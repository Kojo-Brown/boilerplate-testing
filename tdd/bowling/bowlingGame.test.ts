// @vitest-environment node
//
// Bowling Game kata. Read tdd/README.md for the step-by-step log; every commit
// on the PR branch is one red, green or refactor move.

import { describe, it, expect } from 'vitest'
import { BowlingGame } from './bowlingGame'

/** Roll the same number of pins `times` times. */
function rollMany(game: BowlingGame, times: number, pins: number): void {
  for (let i = 0; i < times; i += 1) {
    game.roll(pins)
  }
}

describe('BowlingGame', () => {
  it('a gutter game scores 0', () => {
    const game = new BowlingGame()
    rollMany(game, 20, 0)

    expect(game.score()).toBe(0)
  })
})
