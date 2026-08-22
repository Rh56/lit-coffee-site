/* Inlines index.html + network.css + app.js into a single page body for
   publishing as an Artifact. One source of truth stays in this directory. */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const css = readFileSync(join(here, 'network.css'), 'utf8');
const js = readFileSync(join(here, 'app.js'), 'utf8');

const markup = html.split('<!--APP-->')[1].split('<!--/APP-->')[0];
const out = [
  '<title>Rootwork</title>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap">',
  '<style>\n' + css + '\n</style>',
  markup.trim(),
  '<script>\n' + js + '\n<\/script>'
].join('\n');

const dest = process.argv[2] || join(here, 'rootwork.artifact.html');
writeFileSync(dest, out);
console.log('wrote', dest, (out.length / 1024).toFixed(1) + 'kb');
