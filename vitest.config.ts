import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: ['**/*.config.*', '**/*.test.*', '**/node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': '.',
    },
  },
})
