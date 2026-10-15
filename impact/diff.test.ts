// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { changedPaths, parseNameStatus, parseNameStatusZ, vanishedPaths } from './diff.ts'

describe('the NUL-separated form', () => {
  it('reads a modification as two fields', () => {
    expect(parseNameStatusZ('M\0src/a.ts\0')).toEqual([{ path: 'src/a.ts', status: 'modified' }])
  })

  it('reads a rename as three fields, keeping both paths', () => {
    expect(parseNameStatusZ('R100\0src/old.ts\0src/new.ts\0')).toEqual([
      { path: 'src/new.ts', status: 'renamed', from: 'src/old.ts' },
    ])
  })

  // The reason the parser reads fields as a stream rather than in pairs: one
  // record is three fields and the rest are two, so chunking by two puts every
  // record after a rename one field out of step.
  it('stays in step when a rename is followed by other changes', () => {
    expect(parseNameStatusZ('R090\0a.ts\0b.ts\0M\0c.ts\0D\0d.ts\0')).toEqual([
      { path: 'b.ts', status: 'renamed', from: 'a.ts' },
      { path: 'c.ts', status: 'modified' },
      { path: 'd.ts', status: 'deleted' },
    ])
  })

  it('reads a path containing a space, which is why the form is NUL-separated', () => {
    expect(parseNameStatusZ('A\0docs/release notes.md\0')).toEqual([
      { path: 'docs/release notes.md', status: 'added' },
    ])
  })

  it('reads an empty diff as no changes', () => {
    expect(parseNameStatusZ('')).toEqual([])
  })

  it('stops rather than inventing a path when the stream is truncated', () => {
    expect(parseNameStatusZ('M\0a.ts\0R100\0b.ts\0')).toEqual([{ path: 'a.ts', status: 'modified' }])
  })

  it('maps a type change to a modification, which is what it is to a selector', () => {
    expect(parseNameStatusZ('T\0link.ts\0')[0]?.status).toBe('modified')
  })

  it('maps a status it does not know to `other`, rather than guessing', () => {
    expect(parseNameStatusZ('X\0weird.ts\0')[0]?.status).toBe('other')
  })
})

describe('the tab-separated form', () => {
  it('reads one line per change', () => {
    expect(parseNameStatus('M\tsrc/a.ts\nA\tsrc/b.ts\n')).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'added' },
    ])
  })

  it('reads a rename, keeping the path it came from', () => {
    expect(parseNameStatus('R100\tsrc/old.ts\tsrc/new.ts')).toEqual([
      { path: 'src/new.ts', status: 'renamed', from: 'src/old.ts' },
    ])
  })

  it('ignores blank lines', () => {
    expect(parseNameStatus('\nM\ta.ts\n\n')).toHaveLength(1)
  })
})

describe('the paths a selector seeds its walk with', () => {
  it('are the ones that exist after the change', () => {
    expect(
      changedPaths([
        { path: 'a.ts', status: 'modified' },
        { path: 'b.ts', status: 'added' },
        { path: 'gone.ts', status: 'deleted' },
      ]),
    ).toEqual(['a.ts', 'b.ts'])
  })

  it('drop the deleted side of a rename and keep the new one', () => {
    expect(changedPaths([{ path: 'new.ts', status: 'renamed', from: 'old.ts' }])).toEqual(['new.ts'])
  })

  it('are deduplicated and sorted, so a selection is stable', () => {
    expect(
      changedPaths([
        { path: 'b.ts', status: 'modified' },
        { path: 'a.ts', status: 'modified' },
        { path: 'b.ts', status: 'modified' },
      ]),
    ).toEqual(['a.ts', 'b.ts'])
  })
})

describe('the paths that no longer exist', () => {
  it('include a deletion', () => {
    expect(vanishedPaths([{ path: 'gone.ts', status: 'deleted' }])).toEqual(['gone.ts'])
  })

  // The source side of a rename is the interesting one: the importers that
  // still name it are findable only in a tree that is no longer checked out.
  it('include the source side of a rename', () => {
    expect(vanishedPaths([{ path: 'new.ts', status: 'renamed', from: 'old.ts' }])).toEqual(['old.ts'])
  })

  it('are empty for a diff that only adds and modifies', () => {
    expect(
      vanishedPaths([
        { path: 'a.ts', status: 'modified' },
        { path: 'b.ts', status: 'added' },
      ]),
    ).toEqual([])
  })
})
