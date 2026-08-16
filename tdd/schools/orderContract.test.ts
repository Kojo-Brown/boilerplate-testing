// @vitest-environment node
/**
 * The same contract, run against both designs.
 *
 * This is what makes the rest of the folder a comparison rather than two
 * unrelated examples: whatever the schools disagree about, they agree here, to
 * the cent and to the unit of stock. If a change to either implementation
 * breaks one of these, the two are no longer the same feature and nothing they
 * are said to demonstrate about method holds.
 */

import { describeOrderContract } from './orderContract'
import { createClassicistWorld } from './classicist/world'
import { createLondonWorld } from './london/world'

describeOrderContract('London (outside-in)', createLondonWorld)
describeOrderContract('Classicist (inside-out)', createClassicistWorld)
