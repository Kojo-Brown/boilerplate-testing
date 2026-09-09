/**
 * Pins the two environment behaviours that made the pipeline matrix wrong.
 *
 * Both are the same shape of bug: configuration reaching the verifier from the
 * ambient environment rather than from the call, so a run does something other
 * than what its arguments say. Neither is visible in a passing build, which is
 * why they are pinned here rather than trusted to a comment.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONSUMER_PACT_FILE } from '../pact.config'
import { CORRECT } from './app'
import { verifierOptions, verifyProvider, withEnvUnset } from './verify'

const ENV_KEYS = ['PACT_BROKER_BASE_URL', 'PACT_BROKER_TOKEN', 'HTTPS_PROXY'] as const

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('withEnvUnset', () => {
  it('hides the named variables for the duration of the call', async () => {
    process.env['PACT_BROKER_BASE_URL'] = 'http://broker.invalid'
    const seen = await withEnvUnset([...ENV_KEYS], async () =>
      process.env['PACT_BROKER_BASE_URL'],
    )
    expect(seen).toBeUndefined()
  })

  it('restores what was there, including absence', async () => {
    process.env['PACT_BROKER_BASE_URL'] = 'http://broker.invalid'
    await withEnvUnset([...ENV_KEYS], async () => undefined)

    expect(process.env['PACT_BROKER_BASE_URL']).toBe('http://broker.invalid')
    expect('PACT_BROKER_TOKEN' in process.env).toBe(false)
  })

  it('restores after a throw', async () => {
    process.env['PACT_BROKER_BASE_URL'] = 'http://broker.invalid'
    await expect(
      withEnvUnset([...ENV_KEYS], async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(process.env['PACT_BROKER_BASE_URL']).toBe('http://broker.invalid')
  })
})

describe('Verifier options', () => {
  it('sends file paths and no broker configuration for a file source', () => {
    const options = verifierOptions(
      { source: { kind: 'files', paths: ['/tmp/a.json'] } },
      'http://127.0.0.1:1',
      {},
    ) as Record<string, unknown>

    expect(options['pactUrls']).toEqual(['/tmp/a.json'])
    expect(options['pactBrokerUrl']).toBeUndefined()
  })

  it('sends credentials in the options rather than leaving them to the environment', () => {
    const options = verifierOptions(
      {
        source: {
          kind: 'broker',
          brokerUrl: 'http://broker.invalid',
          auth: { kind: 'basic', username: 'mock-user', password: 'mock-password' },
          selectors: [{ mainBranch: true }],
          enablePending: true,
          publishResults: true,
        },
        providerVersion: 'p-1',
        providerBranch: 'main',
      },
      'http://127.0.0.1:1',
      {},
    ) as Record<string, unknown>

    expect(options['pactBrokerUsername']).toBe('mock-user')
    expect(options['pactBrokerPassword']).toBe('mock-password')
    expect(options['consumerVersionSelectors']).toEqual([{ mainBranch: true }])
    expect(options['enablePending']).toBe(true)
    expect(options['publishVerificationResult']).toBe(true)
  })

  it('omits selectors entirely when none are given', () => {
    const options = verifierOptions(
      {
        source: {
          kind: 'broker',
          brokerUrl: 'http://broker.invalid',
          auth: { kind: 'none' },
          selectors: [],
          enablePending: false,
          publishResults: false,
        },
      },
      'http://127.0.0.1:1',
      {},
    ) as Record<string, unknown>

    expect('consumerVersionSelectors' in options).toBe(false)
  })
})

describe('File verification under a configured broker', () => {
  // The regression itself. `pact-core`'s argument mapper adds a broker source
  // from `PACT_BROKER_BASE_URL` whether or not the caller asked for one, so
  // without the scrub this run would try to reach an unreachable broker and
  // fail. Passing means the file source was the only source.
  it('reads only the file when PACT_BROKER_BASE_URL points somewhere unreachable', async () => {
    expect(existsSync(CONSUMER_PACT_FILE)).toBe(true)
    process.env['PACT_BROKER_BASE_URL'] = 'http://127.0.0.1:9'

    const outcome = await verifyProvider({
      source: { kind: 'files', paths: [CONSUMER_PACT_FILE] },
      flags: CORRECT,
    })

    expect(outcome).toEqual({ kind: 'passed' })
  }, 60_000)

  it('reports a contract failure as a value rather than a throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pact-verify-'))
    const path = join(dir, 'pact.json')
    writeFileSync(path, readFileSync(CONSUMER_PACT_FILE, 'utf8'))

    const outcome = await verifyProvider({
      source: { kind: 'files', paths: [path] },
      flags: { ...CORRECT, omitUserRole: true },
    })

    expect(outcome.kind).toBe('failed')
  }, 60_000)
})
