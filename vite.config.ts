import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // three/examples/jsm/* resolves `three` separately from the pre-bundled copy
  // in dev, which loads two instances and breaks instanceof across them.
  resolve: { dedupe: ['three'] },
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
