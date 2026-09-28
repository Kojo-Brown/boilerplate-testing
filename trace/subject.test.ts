// @vitest-environment node
//
// The fixture, audited without a browser.
//
// Every row of the evidence table is an argument about one of these variants,
// and an argument about a page that no longer has the defect is worse than no
// argument. `check.ts` catches that too — a fault that stops reproducing makes
// its test pass, and a passing test there fails the gate — but it needs a
// browser and ninety seconds to say so, and these say it in milliseconds.

import { describe, expect, it } from 'vitest'

import {
  BROKEN_PATH,
  FAULT_NAMES,
  LATE_CONTENT_DELAY_MS,
  PLACEHOLDER,
  RENAMED_TOTAL_ID,
  SAVE_LABEL,
  SLOW_PATH,
  SUMMARY,
  SUMMARY_PATH,
  TOTAL_ID,
  isFaultName,
  render,
} from './subject.ts'

/** Occurrences of a substring, because "contains" is the wrong question twice below. */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

describe('every variant is a document', () => {
  for (const fault of FAULT_NAMES) {
    it(`renders ${fault}`, () => {
      const html = render(fault)

      expect(html.startsWith('<!doctype html>')).toBe(true)
      expect(html).toContain('</html>')
      // The empty data: icon. Without it Chromium requests /favicon.ico, gets a
      // 404 and logs it, and the console column of the evidence table — where
      // six of eight cells claim `empty` — becomes six cells of noise.
      expect(html).toContain('<link rel="icon" href="data:,">')
    })
  }
})

describe('the healthy page', () => {
  const html = render('none')

  it('gives the total the id the tests look for', () => {
    expect(html).toContain(`id="${TOTAL_ID}"`)
    expect(html).not.toContain(`id="${RENAMED_TOTAL_ID}"`)
  })

  it('fetches the endpoint that answers', () => {
    expect(html).toContain(JSON.stringify(SUMMARY_PATH))
    expect(html).not.toContain(BROKEN_PATH)
    expect(html).not.toContain(SLOW_PATH)
  })

  it('has one button and no overlay', () => {
    expect(count(html, SAVE_LABEL)).toBe(1)
    expect(html).not.toContain('id="veil"')
  })

  it('renders no placeholder, so nothing arrives late', () => {
    expect(html).not.toContain(`>${PLACEHOLDER}<`)
    expect(html).not.toContain('setTimeout')
  })
})

describe('each fault is the defect it claims', () => {
  it('renamed-element moves the id', () => {
    const html = render('renamed-element')

    expect(html).toContain(`id="${RENAMED_TOTAL_ID}"`)
    expect(html).not.toContain(`id="${TOTAL_ID}"`)
  })

  it('duplicate-label gives two buttons the same name', () => {
    expect(count(render('duplicate-label'), SAVE_LABEL)).toBe(2)
  })

  it('covered-button lays a transparent overlay over the button', () => {
    const html = render('covered-button')

    expect(html).toContain('id="veil"')
    // Transparent, not merely on top: an opaque overlay would show up in a
    // screenshot, and the row's claim is that the screenshot looks fine.
    expect(html).toContain('rgba(0, 0, 0, 0)')
  })

  it('late-content shows the placeholder and waits longer than the assertion does', () => {
    const html = render('late-content')

    expect(html).toContain(`>${PLACEHOLDER}<`)
    expect(html).toContain(String(LATE_CONTENT_DELAY_MS))
    // `evidence.spec.ts` asserts with a 2s timeout. If the delay were shorter
    // the fault would be a race and the row would be a coin toss.
    expect(LATE_CONTENT_DELAY_MS).toBeGreaterThan(2_000)
  })

  it('failing-api asks the endpoint that answers 500', () => {
    const html = render('failing-api')

    expect(html).toContain(JSON.stringify(BROKEN_PATH))
    expect(html).not.toContain(SUMMARY_PATH)
  })

  it('hanging-api asks the endpoint that never answers', () => {
    const html = render('hanging-api')

    expect(html).toContain(JSON.stringify(SLOW_PATH))
    expect(html).not.toContain(SUMMARY_PATH)
  })

  it('throwing-script throws before it fetches', () => {
    const html = render('throwing-script')
    const thrown = html.indexOf('formatter.format')
    const fetched = html.indexOf('await fetch')

    expect(thrown).toBeGreaterThan(-1)
    // The order is the finding: the network channel's contribution for this
    // fault is the *absence* of the API request, which needs the throw first.
    expect(thrown).toBeLessThan(fetched)
  })

  it('leaves the page silent about a bad answer', () => {
    // The `failing-api` row credits Chromium, not the page, for the console
    // entry. A page that logged the status itself would make that finding
    // about this fixture instead of about the browser.
    expect(render('failing-api')).not.toContain('console.')
  })
})

describe('the fault names', () => {
  it('accepts every name it renders', () => {
    for (const fault of FAULT_NAMES) {
      expect(isFaultName(fault)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isFaultName('renamed_element')).toBe(false)
    expect(isFaultName('')).toBe(false)
  })
})

describe('the summary the page renders', () => {
  it('has the three rows the assertions count', () => {
    expect(SUMMARY.rows).toHaveLength(3)
  })

  it('has a total that is distinguishable from the placeholder', () => {
    expect(String(SUMMARY.total)).not.toBe(PLACEHOLDER)
  })
})
