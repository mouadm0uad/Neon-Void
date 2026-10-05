/**
 * Builds a single self-contained `neon-void.html` (JS, CSS and fonts inlined)
 * that runs from a double-click — no server, no network.
 *   npm run build:single  →  dist-standalone/neon-void.html
 */
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const outDir = 'dist-standalone';
await build({
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true, sourcemap: false, assetsInlineLimit: () => true, modulePreload: false },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const css = files
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(assets, f), 'utf8'))
  .join('\n')
  // Every modern browser takes woff2; drop the inlined .woff fallbacks to halve the size.
  .replace(/,\s*url\(data:font\/woff;base64,[^)]+\)\s*format\(["']woff["']\)/g, '');
const js = files
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(assets, f), 'utf8'))
  .join('\n')
  .replace(/<\/script/g, '<\\/script');

let html = readFileSync(join(outDir, 'index.html'), 'utf8')
  .replace(/<link rel="stylesheet"[^>]*>/g, '')
  .replace(/<script type="module"[^>]*><\/script>/g, '');
html = html.replace('</head>', () => `<style>${css}</style>\n</head>`);
html = html.replace('</body>', () => `<script type="module">${js}</script>\n</body>`);

rmSync(assets, { recursive: true, force: true });
rmSync(join(outDir, 'index.html'));
writeFileSync(join(outDir, 'neon-void.html'), html);
console.log(`✓ ${outDir}/neon-void.html (${(html.length / 1024).toFixed(0)} kB)`);
