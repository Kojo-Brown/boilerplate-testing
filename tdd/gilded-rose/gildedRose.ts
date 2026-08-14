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

/**
 * Most of the shop follows one rule: age a day, then move quality by `rate`,
 * at double rate once the sell-by date has passed. Normal stock, Aged Brie and
 * conjured items differ only in that number — including its sign, which is
 * why Brie ripening and a vest rotting are the same function.
 */
function perishable(rate: number): Updater {
  return (item) => {
    item.sellIn -= 1
    adjustQuality(item, item.sellIn < 0 ? rate * 2 : rate)
  }
}

const updateNormal = perishable(-1)
const updateAgedBrie = perishable(1)
const updateConjured = perishable(-2)

/**
 * Backstage passes are the exception: quality accelerates as the concert
 * approaches and collapses to nothing the moment it is over. The thresholds
 * read the sell-by date *before* it is decremented, which is why they are 11
 * and 6 rather than the 10 and 5 the requirements describe.
 */
const updateBackstagePass: Updater = (item) => {
  const gain = item.sellIn < 6 ? 3 : item.sellIn < 11 ? 2 : 1

  item.sellIn -= 1

  if (item.sellIn < 0) {
    item.quality = MIN_QUALITY
  } else {
    adjustQuality(item, gain)
  }
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
