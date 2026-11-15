import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderThemesScss } from './themes.mjs';

/** Erzeugt src/app/shared/styles/_themes.scss aus scripts/themes.mjs. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const THEMES_SCSS = path.join(root, 'src', 'app', 'shared', 'styles', '_themes.scss');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(THEMES_SCSS, renderThemesScss());
  console.log('Themes erzeugt:', THEMES_SCSS);
}
