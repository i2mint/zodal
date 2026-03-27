import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

export default defineConfig({
  test: {
    root,
    globals: false,
    include: [
      'tests/integration/**/*.test.ts',
      'tests/stories/**/*.test.ts',
    ],
    exclude: [
      'tests/heavy/**',
    ],
  },
  resolve: {
    alias: {
      '@zodal/core': path.resolve(root, 'packages/core/src/index.ts'),
      '@zodal/store': path.resolve(root, 'packages/store/src/index.ts'),
      '@zodal/ui': path.resolve(root, 'packages/ui/src/index.ts'),
    },
  },
});
