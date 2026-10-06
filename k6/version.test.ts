// @vitest-environment node
//
// One pinned binary version, stated in three places, audited here.
//
// `MEASURED_AGAINST` is what every number in README.md was measured against,
// the README's install line is what a reader will run, and the CI workflow is
// what the gate actually runs. If those drift apart the failure is quiet and
// misleading: the gate goes on passing against a different k6 than the one the
// findings describe, and the first sign of trouble is a finding that reads true
// and is not. Same argument as `workflow-templates/patchedDeps.ts` makes for
// the Storybook patch pin, and the same remedy — fail `pnpm test` in a second
// rather than a CI leg three minutes later.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { MEASURED_AGAINST } from './findings.ts'

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const WORKFLOW = read('../.github/workflows/ci.yml')
const README = read('./README.md')

/** `v1.3.0`, as the release tag and the tarball name spell it. */
const PINNED = MEASURED_AGAINST.replace(/^k6\s+/, '')

describe('the pinned k6 version', () => {
  it('is a release tag, not a range', () => {
    expect(PINNED).toMatch(/^v\d+\.\d+\.\d+$/)
  })

  it('is what the CI workflow installs', () => {
    const pins = [...WORKFLOW.matchAll(/^\s*K6_VERSION:\s*(\S+)\s*$/gm)].map((match) => match[1])

    expect(pins, 'no K6_VERSION pin in .github/workflows/ci.yml').not.toHaveLength(0)
    expect([...new Set(pins)]).toEqual([PINNED])
  })

  it('is what the README tells a reader to install', () => {
    const pins = [...README.matchAll(/k6-(v\d+\.\d+\.\d+)-linux-amd64/g)].map((match) => match[1])

    expect(pins, 'no install line in k6/README.md').not.toHaveLength(0)
    expect([...new Set(pins)]).toEqual([PINNED])
  })
})

describe('the load job', () => {
  const job = (() => {
    const start = WORKFLOW.indexOf('\n  load:\n')
    return start === -1 ? null : WORKFLOW.slice(start)
  })()

  it('exists', () => {
    expect(job, 'no `load:` job in .github/workflows/ci.yml').not.toBeNull()
  })

  it('runs the gate rather than only installing the binary', () => {
    // Installing k6 and not running `k6:check` would be a green job that
    // measures nothing — the failure mode a load gate is most likely to have.
    expect(job).toContain('pnpm k6:check')
  })

  it('runs the gate under --throw-deprecation, as every other gate does', () => {
    expect(job).toContain('NODE_OPTIONS: --throw-deprecation')
  })

  it('runs the binary it just installed, so a bad download fails here', () => {
    expect(job).toContain('k6 version')
  })

  it('downloads over https from the pinned release tag', () => {
    expect(job).toContain('https://github.com/grafana/k6/releases/download/${K6_VERSION}/')
  })

  it('pins the version once and interpolates it, so the tag cannot half-change', () => {
    // Bounded by `lastIndexOf`, because the job's own `name: Load thresholds`
    // line comes *before* the install step and would slice an empty string —
    // which would pass both assertions below while checking nothing.
    const installStep = job!.slice(
      job!.indexOf('Install k6'),
      job!.lastIndexOf('Load thresholds'),
    )

    expect(installStep, 'the install step slice is empty').toContain('curl')

    // The URL and the tarball's inner directory must both come from the
    // variable; a literal in either is how a half-updated pin downloads one
    // version and unpacks the path of another.
    expect(installStep).not.toMatch(/k6-v\d+\.\d+\.\d+-linux-amd64/)
    expect(installStep.match(/\$\{K6_VERSION\}/g) ?? []).toHaveLength(3)
  })
})
