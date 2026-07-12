import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest/setup.ts'],
    exclude: ['pact/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: ['**/*.config.*', '**/*.test.*', '**/node_modules/**', 'pact/**'],
    },
  },
  resolve: {
    alias: {
      '@': '.',
    },
  },
})
