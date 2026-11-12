/**
 * Copie dans `public/` les ressources servies telles quelles au navigateur :
 *  - le worker de MapLibre GL JS (BSD-3-Clause) ;
 *  - le fond de carte Natural Earth 1:50 M (domaine public), distribué par `world-atlas` (ISC).
 * Aucune ressource n'est téléchargée : tout vient de node_modules.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const assets = [
  [join(dirname(require.resolve('maplibre-gl/package.json')), 'dist', 'maplibre-gl-worker.mjs'), join(root, 'vendor', 'maplibre-gl-worker.mjs')],
  [require.resolve('world-atlas/land-50m.json'), join(root, 'data', 'land-50m.json')],
];

for (const [from, to] of assets) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
console.log(`Ressources copiées dans public/ (${assets.length} fichiers).`);
