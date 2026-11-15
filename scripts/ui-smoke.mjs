/**
 * UI-Smoke-Test ohne zusätzliche Abhängigkeiten: Electron lädt die gebaute UI gegen eine
 * temporäre Testbibliothek, klickt/tippt die Kernabläufe durch und legt Screenshots in
 * docs/screenshots/ ab.
 *
 * Zusätzlich: Screenshots aller Farbprofile (docs/screenshots/themes/) und eine Scroll-Messung
 * mit 2 000 Dateien (Ergebnis in der Konsole und in docs/perf-virtualisierung.json).
 *
 * Aufruf: npm run build:web && npm run test:ui
 */
import electron from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { startServer, stopServer } from '../server/index.mjs';
import { createSlicerService } from '../server/lib/slicers.mjs';

const { app, BrowserWindow, nativeTheme } = electron;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(root, 'docs', 'screenshots');
const themeShotsDir = path.join(shotsDir, 'themes');
const PERF_COUNT = 2000;
const results = [];
const consoleErrors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` – ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cubeStl(name, w, d, h) {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  let out = `solid ${name}\n`;
  for (const f of faces) {
    out += ' facet normal 0 0 0\n  outer loop\n';
    for (const i of f) out += `   vertex ${v[i].join(' ')}\n`;
    out += '  endloop\n endfacet\n';
  }
  return `${out}endsolid ${name}\n`;
}

async function createLibrary(dir) {
  const write = async (rel, content) => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  };
  await write('Kalibrierung/Würfel/xyz-cube.stl', cubeStl('xyz', 20, 20, 20));
  await write('Kalibrierung/temp-tower.stl', cubeStl('tower', 20, 20, 80));
  await write('Ersatzteile/Halter v1..2.stl', cubeStl('halter', 60, 15, 8));
  await write('Projekte/Benchy/benchy-ersatz.stl', cubeStl('benchy', 30, 12, 25));
  await write(
    'Projekte/Benchy/Anleitung.pdf',
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 40 100 Td (Anleitung) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );
  await fs.copyFile(path.join(root, 'public', 'printnest.png'), path.join(dir, 'Projekte/Benchy/foto.png'));
  // Video ohne gültigen Inhalt: reicht, um die Seitenleiste (nur Notiz) zu prüfen.
  await write('Projekte/Benchy/zeitraffer.mp4', 'kein echtes Video');
  await write('Projekte/Benchy/benchy_0.2mm_PLA_final (1).stl', cubeStl('b2', 10, 10, 10));
  // Je ein Beispiel pro Typ für die Theme-Screenshots.
  await write('Typen/halter.3mf', 'PK');
  await write('Typen/gehaeuse.f3d', 'PK');
  await write('Typen/clip.mp4', 'x');
  await fs.mkdir(path.join(dir, 'Leer'), { recursive: true });
  await write(
    '.printnest-links.json',
    JSON.stringify({
      links: [
        {
          id: 'l1',
          name: 'Benchy auf Printables',
          url: 'https://www.printables.com/model/3161',
          parentPath: 'Projekte',
          createdAt: '2026-11-01T00:00:00Z',
          updatedAt: '2026-11-01T00:00:00Z',
        },
      ],
    }),
  );
}

/** Testordner mit vielen Dateien (STL + kleine PNGs) für die Scroll-Messung. */
async function createPerfFolder(dir) {
  await fs.mkdir(dir, { recursive: true });
  const canvas = createCanvas(64, 64);
  const g = canvas.getContext('2d');
  const tiny = cubeStl('p', 5, 5, 5);
  for (let i = 0; i < PERF_COUNT; i++) {
    const n = String(i).padStart(4, '0');
    if (i % 2) {
      g.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`;
      g.fillRect(0, 0, 64, 64);
      await fs.writeFile(path.join(dir, `bild-${n}.png`), canvas.toBuffer('image/png'));
    } else {
      await fs.writeFile(path.join(dir, `teil-${n}.stl`), tiny);
    }
  }
}

/** Scrollt den Inhalt per rAF hin und zurück und zählt Frames, lange Frames und DOM-Knoten. */
const MEASURE_SCROLL = `(durationMs) => new Promise((resolve) => {
  const el = document.querySelector('main.content');
  const total = el.scrollHeight - el.clientHeight;
  const start = performance.now();
  let last = start, frames = 0, long = 0, maxGap = 0, maxOptions = 0;
  const tick = (t) => {
    frames++;
    const gap = t - last;
    if (frames > 1) { if (gap > 25) long++; maxGap = Math.max(maxGap, gap); }
    last = t;
    const p = Math.min(1, (t - start) / durationMs);
    el.scrollTop = total * (p < 0.5 ? p * 2 : 2 - p * 2);
    maxOptions = Math.max(maxOptions, document.querySelectorAll('[role=option]').length);
    if (t - start < durationMs) requestAnimationFrame(tick);
    else resolve({ frames, fps: Math.round((frames / ((t - start) / 1000)) * 10) / 10, longFrames: long, maxFrameMs: Math.round(maxGap), maxOptions, domNodes: document.getElementsByTagName('*').length, scrollHeight: el.scrollHeight });
  };
  requestAnimationFrame(tick);
})`;

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'printnest-ui-'));
  const lib = path.join(tmp, 'Bibliothek');
  const trashDir = path.join(tmp, 'Papierkorb');
  await fs.mkdir(trashDir, { recursive: true });
  await createLibrary(lib);
  await fs.mkdir(path.join(tmp, 'data'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'data', 'config.json'), JSON.stringify({ libraryRoot: lib }));
  await fs.mkdir(shotsDir, { recursive: true });
  await fs.mkdir(themeShotsDir, { recursive: true });
  await createPerfFolder(path.join(lib, 'Viele Dateien'));
  // Fake-Slicer: Bambu Studio „installiert“, Öffnen wird nur protokolliert.
  const appsDir = path.join(tmp, 'Applications');
  await fs.mkdir(path.join(appsDir, 'BambuStudio.app'), { recursive: true });
  const slicerCalls = [];

  const { port } = await startServer({
    port: 0,
    dev: true,
    dataDir: path.join(tmp, 'data'),
    staticDir: path.join(root, 'dist', 'printnest', 'browser'),
    seedLinksPath: null,
    trash: (p) => fs.rename(p, path.join(trashDir, path.basename(p))),
    slicers: createSlicerService({
      platform: 'darwin',
      appDirs: [appsDir],
      useSpotlight: false,
      exec: async (cmd, args) => {
        slicerCalls.push([cmd, ...args]);
        return { stdout: '' };
      },
    }),
  });

  const win = new BrowserWindow({ width: 1320, height: 840, show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  const attr = (selector, name) => js(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`);
  const title = () => js(`document.querySelector('#preview-title')?.textContent?.trim() ?? null`);
  const selectedName = () => js(`document.querySelector('[role=option][aria-selected=true] .name')?.textContent.trim() ?? null`);
  const sidebar = (label) => js(`[...document.querySelectorAll('app-sidebar button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))?.click()`);
  const wc = win.webContents;
  wc.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });

  const js = (code) => wc.executeJavaScript(code, true);
  const waitFor = async (selector, timeout = 6000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await js(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
      await sleep(100);
    }
    return false;
  };
  const key = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    const plain = !modifiers.some((m) => m === 'meta' || m === 'control');
    if (plain && (keyCode.length === 1 || keyCode === 'Return')) {
      wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Return' ? '\r' : keyCode, modifiers });
    }
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(150);
  };
  const typeText = async (text) => {
    for (const ch of text) wc.sendInputEvent({ type: 'char', keyCode: ch });
    await sleep(150);
  };
  const shot = async (name) => {
    await sleep(350);
    const image = await wc.capturePage();
    await fs.writeFile(path.join(shotsDir, `${name}.png`), image.toPNG());
  };
  const clickEntry = (name, type = 'click') =>
    js(`(() => {
      const el = [...document.querySelectorAll('[role=option]')].find((o) => o.querySelector('.name')?.textContent.trim() === ${JSON.stringify(name)});
      if (!el) return false;
      el.focus();
      el.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true }));
      return true;
    })()`);
  const names = () => js(`[...document.querySelectorAll('[role=option] .name')].map((n) => n.textContent.trim())`);
  const exists = (rel) => fs.access(path.join(lib, rel)).then(() => true, () => false);

  nativeTheme.themeSource = 'light';
  await win.loadURL(`http://127.0.0.1:${port}/`);
  check('Bibliothek lädt', await waitFor('[role=option]'));
  check('Ordner + Link sichtbar', (await names()).join(',') === 'Ersatzteile,Kalibrierung,Leer,Projekte,Typen,Viele Dateien', (await names()).join(','));
  check('Ordneransicht: Theme „home“ (Blau)', (await attr('html', 'data-theme')) === 'home');
  await shot('01-bibliothek-hell');

  nativeTheme.themeSource = 'dark';
  await shot('02-bibliothek-dunkel');

  // Navigation per Doppelklick, ⌘↑ zurück
  await clickEntry('Projekte', 'dblclick');
  await waitFor('h1');
  await sleep(400);
  check('Ordner öffnen per Doppelklick', (await names()).includes('Benchy auf Printables'));
  await key('Up', ['meta']);
  await sleep(400);
  check('⌘↑ eine Ebene höher', (await names()).includes('Kalibrierung'));

  // Rasteransicht mit Thumbnails
  await clickEntry('Projekte', 'dblclick');
  await sleep(300);
  await clickEntry('Benchy', 'dblclick');
  await sleep(300);
  await key('2', ['meta']);
  await sleep(2500);
  check('Rasteransicht', await js(`!!document.querySelector('.entries.is-grid')`));
  await shot('03-raster-vorschaubilder');

  // Bewertung per Tastatur
  await clickEntry('benchy-ersatz.stl');
  await key('4');
  await sleep(500);
  const meta = JSON.parse(await fs.readFile(path.join(lib, '.printnest-meta.json'), 'utf8'));
  check('Bewertung mit Taste 4', meta.entries['Projekte/Benchy/benchy-ersatz.stl']?.rating === 4);

  // Quick Look (Leertaste) mit 3D-Viewer
  await key('Space');
  check('Vorschau öffnet (Leertaste)', await waitFor('app-preview-dialog .preview-dialog'));
  await waitFor('app-file-preview canvas', 8000);
  await sleep(800);
  const dims = await js(`document.querySelector('.model-tools')?.textContent ?? ''`);
  check('3D-Maße und Dreiecke (Worker-Parser)', dims.includes('30,0 × 12,0 × 25,0 mm') && dims.includes('12 Dreiecke'), dims.replace(/\s+/g, ' ').trim());
  check('Ein WebGL-Canvas in der Vorschau', (await js(`document.querySelectorAll('app-file-preview canvas').length`)) === 1);
  check('Slicer-Knopf nur für gewählten Slicer', (await js(`document.querySelector('app-preview-dialog .actions')?.textContent ?? ''`)).includes('In Bambu Studio öffnen'));
  await shot('04-vorschau-3d');
  await key('Space');
  await sleep(300);
  check('Erneute Leertaste schließt (Toggle)', !(await js(`!!document.querySelector('app-preview-dialog')`)));

  // Raster: ←/→ einzeln, ↓/↑ zeilenweise; Auswahl wandert mit
  const gridNames = await names();
  const cols = await js(`getComputedStyle(document.querySelector('.entries.is-grid .window')).gridTemplateColumns.split(' ').length`);
  await clickEntry(gridNames[0]);
  await key('Space');
  await waitFor('app-preview-dialog');
  await sleep(400);
  const firstTitle = await title();
  await key('Right');
  await sleep(500);
  check('Raster: → nächste Datei', (await title()) === gridNames[1], `${firstTitle} → ${await title()}`);
  check('Auswahl wandert mit', (await selectedName()) === gridNames[1]);
  await key('Left');
  await sleep(400);
  if (gridNames.length > cols) {
    await key('Down');
    await sleep(500);
    check(`Raster: ↓ springt eine Zeile (${cols} Spalten)`, (await title()) === gridNames[cols], `${await title()}`);
    await key('Up');
    await sleep(400);
    check('Raster: ↑ zurück', (await title()) === gridNames[0]);
  }
  check('Vorschau ersetzt statt stapelt', (await js(`document.querySelectorAll('app-preview-dialog').length`)) === 1);
  await key('Escape');
  await sleep(300);
  check('Esc schließt Vorschau', !(await js(`!!document.querySelector('app-preview-dialog')`)));

  // Liste: ↓ blättert, PDF-Vorschau, Video ohne Sterne
  await key('1', ['meta']);
  await sleep(400);
  const listNames = await names();
  await clickEntry(listNames[0]);
  await key('Space');
  await waitFor('app-preview-dialog');
  await key('Down');
  await sleep(700);
  check('Liste: ↓ nächste Datei', (await title()) === listNames[1], `${await title()}`);
  for (let i = 0; i < listNames.length && !(await title())?.endsWith('.pdf'); i++) {
    await key('Down');
    await sleep(500);
  }
  await waitFor('app-file-preview .pdf canvas', 4000);
  await sleep(600);
  await shot('05-vorschau-pdf');
  for (let i = 0; i < listNames.length && !(await title())?.endsWith('.mp4'); i++) {
    await key('Down');
    await sleep(400);
  }
  check('Video: keine Sterne, kein Druckdatum, Notiz vorhanden',
    (await title())?.endsWith('.mp4') &&
      !(await js(`!!document.querySelector('app-preview-dialog app-star-rating')`)) &&
      !(await js(`!!document.querySelector('app-preview-dialog input[type=date]')`)) &&
      (await js(`!!document.querySelector('app-preview-dialog textarea')`)));
  check('Video: eigene Steuerleiste', await js(`!!document.querySelector('app-video-player .bar')`));
  await key('Space');
  await sleep(300);
  check('Leertaste schließt auch bei Video', !(await js(`!!document.querySelector('app-preview-dialog')`)));

  // Liste, Kontextmenü (nur der gewählte Slicer)
  await js(`(() => {
    const el = [...document.querySelectorAll('[role=option]')].find((o) => o.textContent.includes('benchy-ersatz.stl'));
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 200, clientY: r.top + 20 }));
  })()`);
  check('Kontextmenü', await waitFor('[role=menu]'));
  const menuText = await js(`document.querySelector('[role=menu]')?.textContent ?? ''`);
  check('Kontextmenü: nur „In Bambu Studio öffnen“', menuText.includes('In Bambu Studio öffnen') && !menuText.includes('OrcaSlicer'));
  await shot('06-kontextmenue');
  await key('Escape');

  // ⇧⌘O öffnet im Standard-Slicer
  await clickEntry('benchy-ersatz.stl');
  await key('O', ['meta', 'shift']);
  await sleep(500);
  check('⇧⌘O öffnet in Bambu Studio', slicerCalls.some((c) => c[0] === 'open' && c[2].endsWith('BambuStudio.app') && c[3].endsWith('benchy-ersatz.stl')));

  // Umbenennen (⇧↩)
  await clickEntry('benchy-ersatz.stl');
  await key('Return', ['shift']);
  check('Umbenennen-Dialog', await waitFor('#rename-title'));
  await js(`(() => { const i = document.querySelector('app-rename-dialog input'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
  await typeText('benchy v2.stl');
  await shot('07-umbenennen');
  await key('Return');
  await sleep(700);
  check('Datei umbenannt', await exists('Projekte/Benchy/benchy v2.stl'));
  const meta2 = JSON.parse(await fs.readFile(path.join(lib, '.printnest-meta.json'), 'utf8'));
  check('Bewertung zieht beim Umbenennen mit', meta2.entries['Projekte/Benchy/benchy v2.stl']?.rating === 4);

  // Verschieben über den Dialog in „Ersatzteile“
  await clickEntry('benchy v2.stl');
  await js(`(() => {
    const el = document.querySelector('[role=option][aria-selected=true]');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 200, clientY: r.top + 20 }));
  })()`);
  await waitFor('[role=menu]');
  await js(`[...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('Verschieben'))?.click()`);
  await waitFor('.move-dialog');
  await sleep(600);
  await js(`[...document.querySelectorAll('.move-crumbs button')].find((b) => b.textContent.includes('Bibliothek'))?.click()`);
  await sleep(500);
  await js(`[...document.querySelectorAll('.move-folder-row')].find((b) => b.textContent.includes('Ersatzteile'))?.click()`);
  await sleep(500);
  await shot('08-verschieben');
  await js(`[...document.querySelectorAll('.move-dialog .btn-primary')][0]?.click()`);
  await sleep(700);
  check('Datei verschoben', await exists('Ersatzteile/benchy v2.stl'));

  // Löschen (⌘⌫ → Papierkorb)
  await clickEntry('foto.png');
  await key('Backspace', ['meta']);
  check('Papierkorb-Dialog', await waitFor('#delete-title'));
  await shot('09-papierkorb');
  await js(`document.querySelector('app-delete-dialog .btn-danger').click()`);
  await sleep(700);
  check('In Papierkorb verschoben', !(await exists('Projekte/Benchy/foto.png')) && (await fs.readdir(trashDir)).includes('foto.png'));

  // Link anlegen (⌘L)
  await key('L', ['meta']);
  check('Link-Dialog', await waitFor('#link-title'));
  await typeText('https://www.printables.com/model/3161?utm_source=test#comments');
  await sleep(200);
  check('Link-Assistent erkennt Portal', await waitFor('app-link-dialog .portal', 7000));
  await js(`(() => { const i = document.querySelector('app-link-dialog input[name=name]'); i.value = 'Benchy auf Printables 2'; i.dispatchEvent(new Event('input')); })()`);
  await sleep(200);
  check('Duplikat erkannt (gleiche URL, normalisiert)', await waitFor('app-link-dialog .notice', 3000));
  await shot('13-link-assistent');
  await js(`document.querySelector('app-link-dialog .notice input[type=checkbox]').click()`);
  await sleep(100);
  await js(`document.querySelector('app-link-dialog button[type=submit]').click()`);
  await sleep(800);
  check('Link angelegt', (await names()).includes('Benchy auf Printables 2'));

  // Suche
  await key('F', ['meta']);
  await typeText('tower');
  await sleep(900);
  check('Suche findet Datei', (await names()).includes('temp-tower.stl'));
  await shot('10-suche');
  await key('Escape');
  await sleep(500);

  // Typfilter + Bewertungsfilter
  await js(`[...document.querySelectorAll('app-sidebar button')].find((b) => b.textContent.includes('STL'))?.click()`);
  await sleep(800);
  const stlCount = await js(`document.querySelector('app-toolbar .count')?.textContent.trim() ?? ''`);
  check('Typfilter STL (inkl. 1 000 Testdateien)', stlCount === '1005 Einträge', stlCount);
  await js(`[...document.querySelectorAll('app-sidebar button')].find((b) => b.textContent.includes('Gut bewertet'))?.click()`);
  await sleep(800);
  check('Gut bewertet', (await names()).join(',') === 'benchy v2.stl', (await names()).join(','));
  await shot('11-gut-bewertet');

  // Farbprofile: Typfilter → Theme, Screenshots Hell/Dunkel
  const themeFilters = [['stl', 'STL'], ['3mf', '3MF'], ['f3d', 'F3D'], ['pdf', 'PDF'], ['mp4', 'Videos'], ['img', 'Bilder'], ['link', 'Links'], ['rated', 'Gut bewertet']];
  for (const [id, label] of themeFilters) {
    await sidebar(label);
    await sleep(900);
    check(`Theme ${id}`, (await attr('html', 'data-theme')) === id);
    for (const mode of ['light', 'dark']) {
      nativeTheme.themeSource = mode;
      await sleep(450);
      await shot(`themes/${id}-${mode === 'light' ? 'hell' : 'dunkel'}`);
    }
  }
  await sidebar('Bibliothek');
  await sleep(700);
  check('Zurück in der Ordneransicht: Blau', (await attr('html', 'data-theme')) === 'home');
  for (const mode of ['light', 'dark']) {
    nativeTheme.themeSource = mode;
    await sleep(450);
    await shot(`themes/home-${mode === 'light' ? 'hell' : 'dunkel'}`);
  }

  // Stapelumbenennung + ⌘Z
  await js(`[...document.querySelectorAll('app-sidebar button')].find((b) => b.textContent.trim() === 'Projekte')?.click()`);
  await sleep(500);
  await clickEntry('Benchy', 'dblclick');
  await sleep(600);
  await key('R', ['meta', 'shift']);
  check('Stapelumbenennung-Dialog', await waitFor('#batch-title'));
  await sleep(300);
  const batchAfter = await js(`[...document.querySelectorAll('app-batch-rename-dialog .after input')].map((i) => i.value)`);
  check('Bereinigung: benchy_0.2mm_PLA_final (1).stl → Benchy.stl', batchAfter.includes('Benchy.stl'), batchAfter.join(' | '));
  await shot('14-stapelumbenennung');
  await js(`document.querySelector('app-batch-rename-dialog button[type=submit]').click()`);
  await sleep(900);
  check('Stapel angewendet', await exists('Projekte/Benchy/Benchy.stl'));
  await key('Z', ['meta']);
  await sleep(900);
  check('⌘Z macht den ganzen Stapel rückgängig', await exists('Projekte/Benchy/benchy_0.2mm_PLA_final (1).stl'));

  // Performance: 2 000 Dateien, virtualisiert (Liste und Raster)
  nativeTheme.themeSource = 'dark';
  await sidebar('Viele Dateien');
  await waitFor('[role=option]', 10000);
  await sleep(1200);
  const perf = {};
  for (const layout of ['list', 'grid']) {
    await key(layout === 'list' ? '1' : '2', ['meta']);
    await sleep(1500);
    perf[layout] = await js(`(${MEASURE_SCROLL})(4000)`);
    console.log(`  Scroll ${layout}:`, JSON.stringify(perf[layout]));
    check(`2 000 Dateien (${layout}): DOM bleibt begrenzt`, perf[layout].maxOptions < 150, `max. ${perf[layout].maxOptions} Einträge im DOM`);
  }
  await shot('15-viele-dateien-raster');
  await fs.writeFile(path.join(root, 'docs', 'perf-virtualisierung.json'), `${JSON.stringify({ files: PERF_COUNT, measuredAt: new Date().toISOString(), ...perf }, null, 2)}\n`);
  await key('1', ['meta']);

  // Leerer Ordner
  await js(`[...document.querySelectorAll('app-sidebar button')].find((b) => b.textContent.trim() === 'Leer')?.click()`);
  await sleep(600);
  check('Leerer Zustand', await waitFor('app-empty-state'));
  await shot('12-leerer-ordner');

  // Live-Aktualisierung (Datei von außen anlegen)
  await fs.writeFile(path.join(lib, 'Leer', 'neu-von-aussen.stl'), cubeStl('n', 5, 5, 5));
  await sleep(1500);
  check('Live-Aktualisierung per fs.watch/SSE', (await names()).includes('neu-von-aussen.stl'));

  const relevantErrors = consoleErrors.filter((m) => !m.includes('favicon'));
  check('Keine Konsolenfehler', relevantErrors.length === 0, relevantErrors.slice(0, 3).join(' | '));

  win.destroy();
  await stopServer();
  await fs.rm(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden.`);
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error(error);
    app.exit(1);
  }),
);
