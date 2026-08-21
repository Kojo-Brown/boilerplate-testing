// ESLint 10 flat config.
//
// Scope: this repo is a library of testing *patterns*, not an application, so
// the config stays deliberately close to the recommended presets. It lints the
// TypeScript sources syntactically (no type-aware rules) — type correctness is
// already enforced separately and more strictly by `pnpm typecheck`, and
// running both keeps `pnpm lint` fast enough to sit in a pre-commit hook.

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// A local plugin, not a package: the test-naming convention below is this
// repository's house style, and the point of the pattern is that the style is
// enforced rather than merely written down. See tdd/conventions/README.md.
//
// The `.ts` extension is required — Node resolves this import itself and
// strips the types on the way in, which is why `engines.node` starts at
// ^22.18.0.
import testConventions from './tdd/conventions/eslint-plugin/index.ts'

export default tseslint.config(
  {
    // Build output and vendored directories. Must be a top-level `ignores`-only
    // object to act as a global ignore in flat config.
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'storybook-static/**',
      'playwright-report/**',
      'playwright-results/**',
      'pact/pacts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Unused function parameters are load-bearing documentation in example
      // code (handler signatures, fixture callbacks). Allow them when prefixed
      // with `_`, and allow unused caught errors.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    // k6 scripts run in the k6 JS runtime, not Node or the browser, and are
    // excluded from tsconfig for the same reason.
    files: ['k6/**/*.ts'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' },
    },
  },

  {
    // ---------------------------------------------------------------------
    // Test-title convention, enforced everywhere
    // ---------------------------------------------------------------------
    // Every test file in the repository, unit and Playwright alike. The rule
    // bans a short list of openers (`should`, `verify`, `it`, …) rather than
    // prescribing a grammar, which is why turning it on cost zero renames: all
    // 580 titles here already state what the system does. That is the argument
    // for adding it now — a convention nothing checks is one commit away from
    // no longer being true, and this one was already true.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    plugins: { 'test-conventions': testConventions },
    rules: {
      'test-conventions/title-scheme': ['error', { scheme: 'behaviour' }],
    },
  },

  {
    // The Given/When/Then demonstration opts into the other scheme. Later
    // config objects win, so this replaces the options above for this file
    // rather than adding to them.
    files: ['tdd/conventions/gwt.test.ts'],
    rules: {
      'test-conventions/title-scheme': ['error', { scheme: 'given-when-then' }],
    },
  },

  {
    // Arrange-Act-Assert marker comments are checked where they are the
    // documented convention, which is this folder and not the other 40 test
    // files. Retrofitting them repo-wide would rewrite every test body in the
    // repository to prove a point about comments; the rule is here, working,
    // with the snippet to switch it on in README.md.
    files: ['tdd/conventions/aaa.test.ts'],
    rules: {
      'test-conventions/aaa-structure': 'error',
    },
  },

  {
    // Config files and CommonJS tooling shims.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // `require()` is the only way to import in CommonJS — the rule exists to
      // stop it leaking into ES modules, which the `files` filter already does.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
