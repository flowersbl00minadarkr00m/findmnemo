import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'browser',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}', 'desktop/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'desktop/**/*.test.ts'],
        },
      },
    ],
  },
})
