/**
 * What each generator actually provokes.
 *
 * ---------------------------------------------------------------------------
 * Why coverage, and why this coverage
 * ---------------------------------------------------------------------------
 * "The campaign found no bugs" is the output of a fuzzer that is working and
 * also the output of one whose generator never got past the first byte, and
 * nothing in the report distinguishes them. That is the failure mode
 * `property/README.md` measures on the arbitrary side — a generator whose
 * intervals collide 2.6% of the time runs two hundred passing cases through
 * code that is barely executed — and it is worse here, because a byte-level
 * fuzzer's inputs are hostile by default and *look* like they are trying.
 *
 * So the campaign is measured by what it reached, not only by what it found.
 * The unit is the subject's own declared outcomes: thirteen ways the parser
 * can refuse an input, nine ways the validator can, and acceptance. Those
 * lists are exported from `config.ts` as closed arrays, so this is a
 * denominator the subject maintains rather than one this file invents — add a
 * refusal to the parser and the coverage figure drops until some generator
 * reaches it.
 *
 * It is a real coverage metric and a coarse one. Reaching
 * `UNEXPECTED_CHARACTER` says nothing about *which* of the dozen places raises
 * it, and a generator that reaches every code could still be exercising one
 * path per code. Statement coverage would be finer and would need the subject
 * instrumented; this needs nothing, costs one pass, and is enough to separate
 * the three generators by an order of magnitude. `README.md` states the limit
 * rather than leaving the number to be read as more than it is.
 */

import {
  loadConfig,
  PARSE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  type ParseErrorCode,
  type ValidationErrorCode,
} from './config.ts'
import { inputStream, type GeneratorId } from './generators.ts'

export interface Reach {
  readonly generator: GeneratorId
  readonly inputs: number
  /** Parse refusals this generator managed to provoke, in declaration order. */
  readonly parseCodes: readonly ParseErrorCode[]
  /** Validation refusals it provoked. Reaching any of these means it got past the parser. */
  readonly validationCodes: readonly ValidationErrorCode[]
  /** Inputs that parsed, whether or not they validated. */
  readonly parsed: number
  /** Inputs that came out the far end as a valid config. */
  readonly accepted: number
}

/**
 * Run a generator's stream through the real subject and record what it hit.
 *
 * The *real* subject, not a variant: this measures the generator, and a
 * generator's reach is a property of the code it is pointed at rather than of
 * whichever fault happens to be injected.
 */
export function measureReach(generator: GeneratorId, seed: number, count: number): Reach {
  const parseCodes = new Set<ParseErrorCode>()
  const validationCodes = new Set<ValidationErrorCode>()

  let parsed = 0
  let accepted = 0

  for (const input of inputStream(generator, seed, count)) {
    const result = loadConfig(input)

    if (result.ok) {
      parsed += 1
      accepted += 1

      continue
    }

    if (result.stage === 'parse') {
      parseCodes.add(result.code)

      continue
    }

    parsed += 1

    for (const error of result.errors) {
      validationCodes.add(error.code)
    }
  }

  return {
    generator,
    inputs: count,
    parseCodes: PARSE_ERROR_CODES.filter((code) => parseCodes.has(code)),
    validationCodes: VALIDATION_ERROR_CODES.filter((code) => validationCodes.has(code)),
    parsed,
    accepted,
  }
}

/** How much of the subject's declared outcome surface a reach covers. */
export function coverage(reach: Reach): {
  parse: string
  validation: string
} {
  return {
    parse: `${reach.parseCodes.length}/${PARSE_ERROR_CODES.length}`,
    validation: `${reach.validationCodes.length}/${VALIDATION_ERROR_CODES.length}`,
  }
}
