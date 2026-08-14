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

  it('a game of all ones scores 20', () => {
    const game = new BowlingGame()
    rollMany(game, 20, 1)

    expect(game.score()).toBe(20)
  })

  it('a spare adds the next roll as a bonus', () => {
    const game = new BowlingGame()
    game.roll(5)
    game.roll(5) // spare: frame one scores 10 + the next roll
    game.roll(3)
    rollMany(game, 17, 0)

    expect(game.score()).toBe(16)
  })

  it('a strike adds the next two rolls as a bonus', () => {
    const game = new BowlingGame()
    game.roll(10) // strike: frame one scores 10 + the next two rolls
    game.roll(3)
    game.roll(4)
    rollMany(game, 16, 0)

    expect(game.score()).toBe(24)
  })

  it('a perfect game scores 300', () => {
    const game = new BowlingGame()
    rollMany(game, 12, 10)

    expect(game.score()).toBe(300)
  })
})
