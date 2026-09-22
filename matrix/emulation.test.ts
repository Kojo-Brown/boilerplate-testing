/**
 * The browser-free half of the emulation measurement.
 *
 * Playwright's device registry is a plain object, so everything
 * `PROJECT_MATRIX` and `REGISTRY` claim about it can be checked here, in
 * `pnpm test`, on a machine with no browser. What needs one —
 * {@link EMULATION}'s forty-five cells — is checked by `emulation.spec.ts`.
 */

import { devices } from '@playwright/test'
import { describe, expect, it } from 'vitest'

import { CONDITIONS, DESKTOP, PHONE, phoneViewport } from './conditions.ts'
import {
  EMULATION,
  FINDINGS,
  PROJECT_MATRIX,
  REGISTRY,
  movedBetween,
  type Engine,
} from './emulation.ts'
import { PROBE_NAMES, probesOfKind } from './probes.ts'

interface Descriptor {
  readonly defaultBrowserType: Engine
  readonly isMobile: boolean
  readonly hasTouch: boolean
  readonly viewport: { readonly width: number; readonly height: number }
  readonly deviceScaleFactor: number
  readonly userAgent: string
}

const REGISTRY_ENTRIES = Object.entries(devices) as [string, Descriptor][]

describe('the project matrix', () => {
  it.each(PROJECT_MATRIX)('$name spreads a descriptor playwright ships', (project) => {
    expect(Object.keys(devices)).toContain(project.descriptor)
  })

  it.each(PROJECT_MATRIX)('$name rides the engine the table names', (project) => {
    const descriptor = devices[project.descriptor] as Descriptor | undefined

    expect(descriptor?.defaultBrowserType).toBe(project.engine)
    expect(descriptor?.isMobile).toBe(project.formFactor === 'mobile')
  })

  it('covers all three engines on the desktop row', () => {
    const engines = PROJECT_MATRIX.filter((project) => project.formFactor === 'desktop').map(
      (project) => project.engine,
    )

    expect([...engines].sort()).toEqual(['chromium', 'firefox', 'webkit'])
  })

  it('covers two of them on the mobile row', () => {
    const engines = PROJECT_MATRIX.filter((project) => project.formFactor === 'mobile').map(
      (project) => project.engine,
    )

    // Five cells, not six. The config cannot be written otherwise.
    expect([...engines].sort()).toEqual(['chromium', 'webkit'])
  })
})

describe('the device registry', () => {
  it('holds the number of descriptors the census records', () => {
    expect(REGISTRY_ENTRIES).toHaveLength(REGISTRY.descriptors)
  })

  it.each(Object.entries(REGISTRY.byEngine))('counts %s as the census records', (engine, counts) => {
    const mine = REGISTRY_ENTRIES.filter(([, device]) => device.defaultBrowserType === engine)

    expect(mine.filter(([, device]) => device.isMobile)).toHaveLength(counts.mobile)
    expect(mine.filter(([, device]) => !device.isMobile)).toHaveLength(counts.desktop)
  })

  it('ships no mobile firefox descriptor at all', () => {
    const firefox = REGISTRY_ENTRIES.filter(([, device]) => device.defaultBrowserType === 'firefox')

    expect(firefox.map(([name]) => name).sort()).toEqual([
      'Desktop Firefox',
      'Desktop Firefox HiDPI',
    ])
    expect(firefox.filter(([, device]) => device.isMobile)).toHaveLength(0)
  })

  it('never sets isMobile without hasTouch, or the reverse', () => {
    // Which is why `narrow` cannot be half a phone: the registry has no
    // descriptor that is one and not the other, and a hand-written context
    // that sets only `viewport` is neither.
    const disagreeing = REGISTRY_ENTRIES.filter(
      ([, device]) => device.isMobile !== device.hasTouch,
    )

    expect(disagreeing.map(([name]) => name)).toEqual([])
  })
})

describe('the three conditions', () => {
  it('changes exactly one option between desktop and narrow', () => {
    const desktop = CONDITIONS.find((condition) => condition.name === 'desktop')?.use ?? {}
    const narrow = CONDITIONS.find((condition) => condition.name === 'narrow')?.use ?? {}

    const differing = [...new Set([...Object.keys(desktop), ...Object.keys(narrow)])].filter(
      (key) => JSON.stringify(desktop[key]) !== JSON.stringify(narrow[key]),
    )

    expect(differing).toEqual(['viewport'])
  })

  it('gives narrow the emulated viewport exactly', () => {
    const narrow = CONDITIONS.find((condition) => condition.name === 'narrow')?.use ?? {}

    expect(narrow['viewport']).toEqual(phoneViewport())
  })

  it('differs from desktop in six options once emulation is on', () => {
    const desktop = devices[DESKTOP] as Descriptor
    const phone = devices[PHONE] as Descriptor

    const differing = (
      ['userAgent', 'viewport', 'screen', 'deviceScaleFactor', 'isMobile', 'hasTouch'] as const
    ).filter(
      (key) =>
        JSON.stringify((desktop as unknown as Record<string, unknown>)[key]) !==
        JSON.stringify((phone as unknown as Record<string, unknown>)[key]),
    )

    // Six options, thirteen probes. The multiplier between them is the reason
    // a resize-only mobile test feels like it should work.
    expect(differing).toHaveLength(6)
  })
})

describe('the measured table', () => {
  it('answers every probe under every condition', () => {
    for (const condition of CONDITIONS) {
      expect(Object.keys(EMULATION[condition.name].probes).sort()).toEqual(
        [...PROBE_NAMES].sort(),
      )
    }
  })

  it('moves the viewport probes for a resize and every probe for a device', () => {
    expect([...movedBetween('desktop', 'narrow')].sort()).toEqual(
      probesOfKind('viewport').map((probe) => probe.name).sort(),
    )
    expect(movedBetween('desktop', 'emulated')).toHaveLength(PROBE_NAMES.length)
  })

  it('files three probes as viewport-shaped and ten as device-shaped', () => {
    expect(probesOfKind('viewport').map((probe) => probe.name)).toEqual([
      'viewport-width',
      'css-breakpoint',
      'screen-width',
    ])
    expect(probesOfKind('device')).toHaveLength(10)
  })
})

describe('findings', () => {
  it.each(Object.entries(FINDINGS))('%s holds over the tables', (_name, holds) => {
    expect(holds()).toBe(true)
  })
})
