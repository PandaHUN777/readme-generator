import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests must never reach the network; every test injects a mocked fetch.
    restoreMocks: true,
  },
});
