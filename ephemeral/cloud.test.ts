// @vitest-environment node
/**
 * The resource ledger, on its own.
 *
 * Two of its behaviours carry cells in the matrix and are therefore worth
 * pinning here rather than only where they are used: the cascade (which is the
 * whole of `namespace-owned`) and the label query (which is the whole of the
 * reconciling sweep). The rest of the file is the ordinary contract — a
 * counter that does not repeat, a delete that is safe to repeat.
 */

import { describe, expect, it } from 'vitest'

import { Clock } from './clock.ts'
import { Cloud } from './cloud.ts'

const cloudAt = (clock: Clock = new Clock()): Cloud => new Cloud(clock.now)

describe('creating resources', () => {
  it('names each resource after its kind and a counter that never repeats', () => {
    const cloud = cloudAt()

    const first = cloud.create({ kind: 'service', labels: {} })
    const second = cloud.create({ kind: 'service', labels: {} })

    expect(first).toBe('service-1')
    expect(second).toBe('service-2')
  })

  it('stamps each resource with the injected clock rather than the wall clock', () => {
    const clock = new Clock()
    const cloud = cloudAt(clock)

    const early = cloud.create({ kind: 'database', labels: {} })
    clock.advance(90)
    const late = cloud.create({ kind: 'database', labels: {} })

    expect(cloud.get(early)?.createdAt).toBe(0)
    expect(cloud.get(late)?.createdAt).toBe(90)
  })

  it('copies the labels it is given, so a caller cannot mutate them afterwards', () => {
    const cloud = cloudAt()
    const labels: Record<string, string> = { pr: '1' }

    const id = cloud.create({ kind: 'service', labels })
    labels['pr'] = '2'

    expect(cloud.get(id)?.labels['pr']).toBe('1')
  })

  it('refuses to nest a resource inside one that does not exist', () => {
    const cloud = cloudAt()

    expect(() => cloud.create({ kind: 'service', parent: 'namespace-9', labels: {} })).toThrow(
      'no such resource',
    )
  })
})

describe('deleting resources', () => {
  it('removes everything nested inside the resource, to any depth', () => {
    const cloud = cloudAt()
    const namespace = cloud.create({ kind: 'namespace', labels: {} })
    const service = cloud.create({ kind: 'service', parent: namespace, labels: {} })
    const record = cloud.create({ kind: 'dns-record', parent: service, labels: {} })

    const removed = cloud.delete(namespace)

    expect([...removed].sort()).toEqual([namespace, record, service].sort())
    expect(cloud.alive()).toEqual([])
  })

  /**
   * The cell this is here for: a resource nobody recorded still goes, provided
   * it is nested inside one somebody did. That is the entire difference
   * between `namespace-owned` and `on-close-seeded` in the matrix.
   */
  it('removes a nested resource the caller never knew about', () => {
    const cloud = cloudAt()
    const namespace = cloud.create({ kind: 'namespace', labels: { pr: '1' } })
    cloud.create({ kind: 'log-group', parent: namespace, labels: { pr: '1' } })

    cloud.delete(namespace)

    expect(cloud.query({ pr: '1' })).toEqual([])
  })

  it('leaves siblings alone', () => {
    const cloud = cloudAt()
    const one = cloud.create({ kind: 'namespace', labels: { pr: '1' } })
    const two = cloud.create({ kind: 'namespace', labels: { pr: '2' } })
    cloud.create({ kind: 'service', parent: two, labels: { pr: '2' } })

    cloud.delete(one)

    expect(cloud.alive().map((resource) => resource.labels['pr'])).toEqual(['2', '2'])
  })

  it('treats deleting something already gone as a no-op', () => {
    const cloud = cloudAt()
    const id = cloud.create({ kind: 'service', labels: {} })

    cloud.delete(id)

    expect(cloud.delete(id)).toEqual([])
  })
})

describe('querying by label', () => {
  it('returns only resources carrying every label asked for', () => {
    const cloud = cloudAt()
    cloud.create({ kind: 'service', labels: { pr: '1', sha: 'aaa' } })
    cloud.create({ kind: 'service', labels: { pr: '1', sha: 'bbb' } })
    cloud.create({ kind: 'service', labels: { pr: '2', sha: 'aaa' } })

    const found = cloud.query({ pr: '1', sha: 'aaa' })

    expect(found.map((resource) => resource.id)).toEqual(['service-1'])
  })

  it('finds nothing once the matching resources are deleted', () => {
    const cloud = cloudAt()
    const id = cloud.create({ kind: 'database', labels: { pr: '7' } })

    cloud.delete(id)

    expect(cloud.query({ pr: '7' })).toEqual([])
  })

  it('lists the distinct values of a label across everything alive', () => {
    const cloud = cloudAt()
    cloud.create({ kind: 'service', labels: { pr: '1' } })
    cloud.create({ kind: 'database', labels: { pr: '1' } })
    cloud.create({ kind: 'service', labels: { pr: '4' } })
    cloud.create({ kind: 'service', labels: {} })

    expect(cloud.labelValues('pr')).toEqual(['1', '4'])
  })
})
