import { describe, expect, it } from 'vitest'

import { HEAVY_PATH, LEAN_PATH } from './fixture.ts'
import { loadBudgets } from './load.ts'
import { startOrigin, type Origin } from './server.ts'

const budgets = loadBudgets()

/** Run one test against a freshly bound origin on an OS-assigned port. */
async function withOrigin(body: (origin: Origin) => Promise<void>): Promise<void> {
  const origin = await startOrigin(0, budgets)
  try {
    await body(origin)
  } finally {
    await origin.close()
  }
}

describe('startOrigin', () => {
  it('binds before it resolves, so a caller can connect to the port it got', async () => {
    await withOrigin(async (origin) => {
      const response = await fetch(`${origin.baseUrl}${LEAN_PATH}`)

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<h1>Budget fixture</h1>')
    })
  })

  it('reports the port it actually bound, not the one it was asked for', async () => {
    await withOrigin(async (origin) => {
      expect(origin.port).toBeGreaterThan(0)
      expect(origin.baseUrl).toBe(`http://localhost:${origin.port}`)
    })
  })

  // Cache-Control is load-bearing: a cached asset would make the second of
  // three runs measure a different page from the first.
  it('forbids caching on every response', async () => {
    await withOrigin(async (origin) => {
      for (const path of [LEAN_PATH, '/lean.js', '/lean.css']) {
        const response = await fetch(`${origin.baseUrl}${path}`)

        expect(response.headers.get('cache-control')).toBe('no-store')
      }
    })
  })

  it('serves the heavy script over its budget', async () => {
    await withOrigin(async (origin) => {
      const response = await fetch(`${origin.baseUrl}/heavy.js`)
      const body = await response.text()

      expect(response.headers.get('content-type')).toBe('text/javascript')
      expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(300 * 1024)
    })
  })

  it('ignores a query string when routing', async () => {
    await withOrigin(async (origin) => {
      const response = await fetch(`${origin.baseUrl}${HEAVY_PATH}?cachebust=1`)

      expect(response.status).toBe(200)
    })
  })

  it('404s an unknown path', async () => {
    await withOrigin(async (origin) => {
      expect((await fetch(`${origin.baseUrl}/nope`)).status).toBe(404)
    })
  })

  it('releases the port on close, so two runs in a row do not collide', async () => {
    const origin = await startOrigin(0, budgets)
    const { port } = origin
    await origin.close()

    const second = await startOrigin(port, budgets)
    try {
      expect(second.port).toBe(port)
    } finally {
      await second.close()
    }
  })
})
