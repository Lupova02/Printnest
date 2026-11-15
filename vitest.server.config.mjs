import { defineConfig } from 'vitest/config';

/** Server- und Skript-Tests (Node, inkl. Theme-Kontraste), getrennt von `ng test`. */
export default defineConfig({
  test: {
    include: ['server/**/*.test.mjs', 'scripts/test/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 15000,
  },
});
