/**
 * The Gilded Rose.
 *
 * Each kind of item ages by its own rule, so the rules are looked up by name
 * rather than rediscovered by a chain of negations. Anything not in the table
 * ages like a normal item, which is what the legacy code's final `else` meant
 * all along.
 */

export type Item = {
  name: string
  sellIn: number
  quality: number
}

export const AGED_BRIE = 'Aged Brie'
export const BACKSTAGE_PASS = 'Backstage passes to a TAFKAL80ETC concert'
export const SULFURAS = 'Sulfuras, Hand of Ragnaros'
export const CONJURED = 'Conjured Mana Cake'

const MIN_QUALITY = 0
const MAX_QUALITY = 50

type Updater = (item: Item) => void

/** Move quality by `delta`, keeping it inside the legal range. */
function adjustQuality(item: Item, delta: number): void {
  item.quality = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, item.quality + delta))
}

const updateNormal: Updater = (item) => {
  item.sellIn -= 1
  adjustQuality(item, item.sellIn < 0 ? -2 : -1)
}

const updateAgedBrie: Updater = (item) => {
  item.sellIn -= 1
  adjustQuality(item, item.sellIn < 0 ? 2 : 1)
}

const updateBackstagePass: Updater = (item) => {
  const gain = item.sellIn < 6 ? 3 : item.sellIn < 11 ? 2 : 1

  item.sellIn -= 1

  if (item.sellIn < 0) {
    item.quality = MIN_QUALITY
  } else {
    adjustQuality(item, gain)
  }
}

const updateConjured: Updater = (item) => {
  item.sellIn -= 1
  adjustQuality(item, item.sellIn < 0 ? -4 : -2)
}

/** Legendary: never ages, never degrades, and sits above the quality cap. */
const updateSulfuras: Updater = () => undefined

const UPDATERS: ReadonlyMap<string, Updater> = new Map([
  [AGED_BRIE, updateAgedBrie],
  [BACKSTAGE_PASS, updateBackstagePass],
  [SULFURAS, updateSulfuras],
  [CONJURED, updateConjured],
])

export function updateQuality(items: Item[]): Item[] {
  for (const item of items) {
    const update = UPDATERS.get(item.name) ?? updateNormal
    update(item)
  }

  return items
}
