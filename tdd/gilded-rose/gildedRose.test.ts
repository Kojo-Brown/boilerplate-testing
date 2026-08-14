// @vitest-environment node
//
// Gilded Rose kata. Read tdd/README.md for the step-by-step log; every commit
// on the PR branch is one pin, red, green or refactor move.

import { describe, it, expect } from 'vitest'
import { updateQuality, type Item } from './gildedRose'

const NORMAL = '+5 Dexterity Vest'
const BRIE = 'Aged Brie'
const SULFURAS = 'Sulfuras, Hand of Ragnaros'
const BACKSTAGE = 'Backstage passes to a TAFKAL80ETC concert'
const CONJURED = 'Conjured Mana Cake'

function item(name: string, sellIn: number, quality: number): Item {
  return { name, sellIn, quality }
}

/** Run one day against a copy, and return the single updated item. */
function afterOneDay(input: Item): Item {
  const [updated] = updateQuality([{ ...input }])

  if (updated === undefined) {
    throw new Error('updateQuality returned no items')
  }

  return updated
}

describe('the legacy rules (characterised, not designed)', () => {
  it('a normal item loses one quality and one day', () => {
    expect(afterOneDay(item(NORMAL, 10, 20))).toEqual(item(NORMAL, 9, 19))
  })

  it('a normal item loses two quality once the sell-by date has passed', () => {
    expect(afterOneDay(item(NORMAL, 0, 20))).toEqual(item(NORMAL, -1, 18))
  })

  it('quality never goes negative', () => {
    expect(afterOneDay(item(NORMAL, 0, 0))).toEqual(item(NORMAL, -1, 0))
  })

  it('Aged Brie gains quality as it ages', () => {
    expect(afterOneDay(item(BRIE, 5, 10))).toEqual(item(BRIE, 4, 11))
    expect(afterOneDay(item(BRIE, 0, 10))).toEqual(item(BRIE, -1, 12))
  })

  it('Aged Brie stops at fifty quality', () => {
    expect(afterOneDay(item(BRIE, 5, 50))).toEqual(item(BRIE, 4, 50))
    expect(afterOneDay(item(BRIE, 0, 49))).toEqual(item(BRIE, -1, 50))
  })

  it('Sulfuras never moves', () => {
    expect(afterOneDay(item(SULFURAS, 0, 80))).toEqual(item(SULFURAS, 0, 80))
  })

  it('a backstage pass gains two within ten days and three within five', () => {
    expect(afterOneDay(item(BACKSTAGE, 11, 20))).toEqual(item(BACKSTAGE, 10, 21))
    expect(afterOneDay(item(BACKSTAGE, 10, 20))).toEqual(item(BACKSTAGE, 9, 22))
    expect(afterOneDay(item(BACKSTAGE, 5, 20))).toEqual(item(BACKSTAGE, 4, 23))
    expect(afterOneDay(item(BACKSTAGE, 10, 49))).toEqual(item(BACKSTAGE, 9, 50))
  })

  it('a backstage pass is worthless once the concert has passed', () => {
    expect(afterOneDay(item(BACKSTAGE, 0, 20))).toEqual(item(BACKSTAGE, -1, 0))
  })
})
