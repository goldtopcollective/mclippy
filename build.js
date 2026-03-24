const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js',
  external: [
    'pg-native',
    'bufferutil',
    'utf-8-validate',
  ],
  format: 'cjs',
  sourcemap: false,
});

console.log('Build complete');
