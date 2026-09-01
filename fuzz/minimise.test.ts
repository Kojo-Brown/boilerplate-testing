import { describe, expect, it } from 'vitest'

import { probeOnce } from './campaign.ts'
import { loadConfig, parseJson, validateConfig } from './config.ts'
import { minimise } from './minimise.ts'
import type { Subject } from './load.ts'

/**
 * The minimiser, and the two things about it worth knowing before trusting a
 * fuzzer's report.
 *
 * The first is that it works, on the inputs a byte-level fuzzer produces: a
 * witness that arrives as a hundred and thirty characters of line noise
 * reduces to a handful, and the reduction is what turns a fuzzing find into
 * something a person can read.
 *
 * The second is that it barely works on structured input, and the reason is
 * not a defect in the algorithm. ddmin deletes contiguous chunks and single
 * characters; every such deletion from a well-formed JSON document makes it
 * malformed, the predicate stops holding, and the search stalls with the
 * document almost intact. `README.md` reports both numbers, because a reader
 * who has seen only the first will file the second as a bug in the tool.
 */

const honest: Subject = { parseJson, validateConfig, loadConfig }

describe('reducing towards a predicate', () => {
  it('finds the one character that matters in a long input', () => {
    const noise = 'abcdefghij'.repeat(20)
    const input = `${noise}!${noise}`

    expect(minimise(input, (candidate) => candidate.includes('!')).input).toBe('!')
  })

  it('keeps characters that must appear together', () => {
    const input = 'xxxAxxxxxxBxxxx'
    const reduced = minimise(input, (candidate) => candidate.includes('A') && candidate.includes('B'))

    expect(reduced.input).toBe('AB')
  })

  it('deletes scattered characters that a chunk-wise search cannot', () => {
    // The reason the single-character sweep exists. ddmin's chunks are
    // contiguous, so on its own it cannot remove the second and fourth
    // character while keeping the first and third.
    const input = 'a1b2c3d4e5'
    const reduced = minimise(input, (candidate) => /a.*b.*c.*d.*e/.test(candidate))

    expect(reduced.input).toBe('abcde')
  })

  it('leaves an already-minimal input alone', () => {
    expect(minimise('!', (candidate) => candidate.includes('!')).input).toBe('!')
  })

  it('returns the input unchanged when nothing smaller reproduces', () => {
    const input = 'abcdef'
    const reduced = minimise(input, (candidate) => candidate === input)

    expect(reduced.input).toBe(input)
  })

  it('counts what the search cost', () => {
    const reduced = minimise('abcdefghij'.repeat(10), (candidate) => candidate.includes('j'))

    expect(reduced.evaluations).toBeGreaterThan(0)
    expect(reduced.input).toBe('j')
  })
})

describe('the predicate decides what "minimal" means', () => {
  const witness = '{"name":"a","retries":1,"timeoutMs":1,"tags":[],"limits":{"enabled":true,"ratio":9}}'

  it('reduces to a document that still fails for the same reason', () => {
    const reduced = minimise(
      witness,
      (candidate) => probeOnce(honest, 'invariant', candidate) === null && !loadConfig(candidate).ok,
    )

    expect(loadConfig(reduced.input).ok).toBe(false)
  })

  it('reduces to the empty string when the predicate is merely "it fails"', () => {
    // The trap. "Still fails" is the predicate everybody writes first, and it
    // reduces every witness in a corpus to the same worthless input, because
    // the empty document fails too — for the most boring reason available.
    const reduced = minimise(witness, (candidate) => !loadConfig(candidate).ok)

    expect(reduced.input).toBe('')
  })
})

describe('what reduction is worth, measured on both kinds of input', () => {
  // Two witnesses of almost the same length, reduced under the same algorithm
  // and the same kind of predicate. The numbers are asserted as bands rather
  // than exact values: what is being pinned is the shape of the result, which
  // is the thing `README.md` quotes.
  const garbage = `{"":"\\s","":0,"":["",""],"":{"":true,"":1}}${'x'.repeat(80)}`
  const structured =
    '{"name":"payments","retries":1,"timeoutMs":250,"tags":["eu","prod"],"limits":{"enabled":true,"ratio":0.5}}'

  it('takes unstructured noise down by more than half', () => {
    const reduced = minimise(garbage, (candidate) => candidate.includes('\\s'))

    expect(reduced.input.length / garbage.length).toBeLessThan(0.5)
  })

  it('barely moves a well-formed document', () => {
    // Every deletion breaks the JSON, so the predicate stops holding and the
    // search has nowhere to go. 106 characters in, and what comes out is a
    // document of very nearly the same size — at the cost of a four-figure
    // number of predicate evaluations.
    const reduced = minimise(structured, (candidate) => {
      const result = loadConfig(candidate)

      return result.ok && result.value.name.startsWith('p')
    })

    expect(reduced.input.length / structured.length).toBeGreaterThan(0.6)
    expect(loadConfig(reduced.input).ok).toBe(true)
  })
})
