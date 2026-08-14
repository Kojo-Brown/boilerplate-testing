/**
 * The Gilded Rose, as inherited.
 *
 * This is the kata's starting position and is deliberately left exactly as
 * awful as it arrives: nested negations, repeated string literals, quality
 * clamped in four separate places. Do not clean it up before the
 * characterisation tests in gildedRose.test.ts are green — they are the only
 * evidence of what it currently does, and the legacy behaviour is the
 * specification.
 */

export type Item = {
  name: string
  sellIn: number
  quality: number
}

export function updateQuality(items: Item[]): Item[] {
  for (const item of items) {
    if (item.name === 'Conjured Mana Cake') {
      item.quality = Math.max(0, item.quality - 2)
      item.sellIn = item.sellIn - 1
      continue
    }

    if (
      item.name !== 'Aged Brie' &&
      item.name !== 'Backstage passes to a TAFKAL80ETC concert'
    ) {
      if (item.quality > 0) {
        if (item.name !== 'Sulfuras, Hand of Ragnaros') {
          item.quality = item.quality - 1
        }
      }
    } else {
      if (item.quality < 50) {
        item.quality = item.quality + 1
        if (item.name === 'Backstage passes to a TAFKAL80ETC concert') {
          if (item.sellIn < 11) {
            if (item.quality < 50) {
              item.quality = item.quality + 1
            }
          }
          if (item.sellIn < 6) {
            if (item.quality < 50) {
              item.quality = item.quality + 1
            }
          }
        }
      }
    }

    if (item.name !== 'Sulfuras, Hand of Ragnaros') {
      item.sellIn = item.sellIn - 1
    }

    if (item.sellIn < 0) {
      if (item.name !== 'Aged Brie') {
        if (item.name !== 'Backstage passes to a TAFKAL80ETC concert') {
          if (item.quality > 0) {
            if (item.name !== 'Sulfuras, Hand of Ragnaros') {
              item.quality = item.quality - 1
            }
          }
        } else {
          item.quality = 0
        }
      } else {
        if (item.quality < 50) {
          item.quality = item.quality + 1
        }
      }
    }
  }

  return items
}
