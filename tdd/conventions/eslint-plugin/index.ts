/**
 * `eslint-plugin-test-conventions` — a local flat-config plugin.
 *
 * It lives in the repository rather than on npm on purpose. A test-naming
 * convention is a house rule; publishing one invites projects to adopt a
 * stranger's taste, and the interesting part of this pattern is not the two
 * rules but that a convention which is merely written down decays, while one
 * that fails `pnpm lint` cannot. Copy the folder, edit `vocabulary.ts`,
 * disagree with everything in it — the shape is the deliverable.
 *
 * Wiring, from `eslint.config.js`:
 *
 * ```js
 * import testConventions from './tdd/conventions/eslint-plugin/index.ts'
 *
 * export default [
 *   {
 *     files: ['**\/*.test.{ts,tsx}'],
 *     plugins: { 'test-conventions': testConventions },
 *     rules: { 'test-conventions/title-scheme': 'error' },
 *   },
 * ]
 * ```
 *
 * The `.ts` extension in that import is not a typo: Node strips the types on
 * the way in, so the rules can be written and type-checked as TypeScript
 * without a build step in front of the linter. It is also why `engines.node`
 * declares `^22.18.0` — the release where type stripping stopped needing a
 * flag — rather than the `^22.13.0` it declared before.
 */

import { aaaStructure } from './aaaStructure.ts'
import { titleScheme } from './titleScheme.ts'

export const rules = {
  'title-scheme': titleScheme,
  'aaa-structure': aaaStructure,
}

export const meta = {
  name: 'eslint-plugin-test-conventions',
  version: '1.0.0',
}

const plugin = { meta, rules }

export default plugin
