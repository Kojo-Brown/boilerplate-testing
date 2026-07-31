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
