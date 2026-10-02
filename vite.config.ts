import { defineConfig } from 'vitest/config';

// `base: './'` makes the build work on GitHub Pages under any repo name.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
