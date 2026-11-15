import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'server', 'config.json');
const target = path.join(root, 'electron', 'bootstrap-config.json');

try {
  const raw = await fs.readFile(source, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.libraryRoot) throw new Error('libraryRoot fehlt');
  await fs.writeFile(target, `${JSON.stringify({ libraryRoot: parsed.libraryRoot }, null, 2)}\n`);
  console.log('Electron-Bootstrap-Config geschrieben:', parsed.libraryRoot);
} catch (error) {
  // Ohne Dev-Config bleibt die App wählbar über den Ordnerdialog.
  await fs.writeFile(target, `${JSON.stringify({ libraryRoot: null }, null, 2)}\n`);
  console.warn('Keine server/config.json – Bootstrap ohne Bibliothekspfad.', error.message || error);
}
