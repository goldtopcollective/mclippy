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

// Copy public files and inject build hash for cache busting
const fs = require('fs');
const path = require('path');
const buildHash = Date.now().toString(36);

fs.cpSync('src/public', 'dist/public', { recursive: true });

// Replace __BUILD__ placeholder in index.html
const htmlPath = path.join('dist', 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/__BUILD__/g, buildHash);
fs.writeFileSync(htmlPath, html);

console.log(`Build complete (hash: ${buildHash})`);
