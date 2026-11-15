/**
 * Farbprofile je Dateityp: aus der Typfarbe (Farbton in OKLCH) wird ein vollständiger Token-Satz
 * für Hell und Dunkel abgeleitet – gleiche Helligkeitsstufen für alle Themes, Sättigung in den
 * Hintergründen stark reduziert. Texte/Akzente werden bei Bedarf so lange in der Helligkeit
 * verschoben, bis WCAG AA erfüllt ist. Ordner/Home behält das bisherige Eisblau/Navy (fest).
 *
 * Erzeugen: `node scripts/build-themes.mjs` → src/app/shared/styles/_themes.scss
 */

// --- Farbraum-Umrechnung ---

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
}

export function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

function oklchToLinear([L, C, H]) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB; außerhalb des Gamuts wird die Sättigung reduziert (Farbton/Helligkeit bleiben). */
export function oklchToRgb([L, C, H]) {
  const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
  let lin = oklchToLinear([L, C, H]);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear([L, mid, H]))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear([L, lo, H]);
  }
  return lin.map((c) => linearToSrgb(Math.min(1, Math.max(0, c))));
}

export function oklch(L, C, H) {
  return rgbToHex(oklchToRgb([L, C, H]));
}

// --- Kontrast (WCAG 2.x) ---

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Halbtransparente Farbe (rgba) über einen deckenden Hintergrund legen → Hex. */
export function composite(rgba, backgroundHex) {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba);
  if (!m) return rgba;
  const alpha = Number(m[4]);
  const bg = hexToRgb(backgroundHex);
  return rgbToHex([1, 2, 3].map((i, k) => (Number(m[i]) / 255) * alpha + bg[k] * (1 - alpha)));
}

function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Helligkeit von `L` in Richtung `dir` verschieben, bis der Kontrast gegen alle `backgrounds` reicht. */
function ensureContrast(L, C, H, backgrounds, ratio, dir) {
  let l = L;
  for (let i = 0; i < 80; i++) {
    const hex = oklch(l, C, H);
    if (backgrounds.every((bg) => contrast(hex, bg) >= ratio)) return hex;
    l = Math.min(1, Math.max(0, l + dir * 0.005));
  }
  return oklch(l, C, H);
}

// --- Themes ---

/** Typfarben aus styles.scss (Dunkel-Variante: kräftigster Farbton) → Farbton je Theme. */
export const THEME_SOURCES = {
  stl: '#7ec8e3',
  '3mf': '#3fcf7f',
  f3d: '#f08a45',
  pdf: '#ff6a5f',
  mp4: '#b293ff',
  img: '#f472b6',
  link: '#fbbf24',
  // Bewertung: Sternfarbe des hellen Modus (--star), wärmer als der Link-Ton.
  rated: '#b87400',
};

export const THEME_LABELS = {
  home: 'Ordner (Eisblau)',
  stl: 'STL',
  '3mf': '3MF',
  f3d: 'F3D',
  pdf: 'PDF',
  mp4: 'Video',
  img: 'Bilder',
  link: 'Links',
  rated: 'Bewertung',
};

/** Bisheriges Eisblau/Navy (Ordneransicht) – bleibt unverändert. */
export const HOME_THEME = {
  light: {
    'bg-window': '#f4f6f8',
    'bg-sidebar': '#e9eef2',
    'bg-elevated': '#ffffff',
    'bg-sunken': '#edf1f4',
    'bg-toolbar': '#f4f6f8',
    'bg-hover': 'rgba(16, 23, 29, 0.05)',
    'bg-selected': 'rgba(23, 114, 143, 0.14)',
    ink: '#10171d',
    'ink-soft': '#46555f',
    'ink-faint': '#5f6d77',
    line: 'rgba(16, 23, 29, 0.1)',
    'line-strong': 'rgba(16, 23, 29, 0.2)',
    accent: '#17728f',
    'accent-strong': '#0f5d75',
    'accent-soft': 'rgba(23, 114, 143, 0.12)',
    'accent-ink': '#ffffff',
    'accent-text': '#105f78',
    glow: 'rgba(23, 114, 143, 0.28)',
    'focus-ring': '0 0 0 3px rgba(23, 114, 143, 0.45)',
  },
  dark: {
    'bg-window': '#0d141b',
    'bg-sidebar': '#111b24',
    'bg-elevated': '#16212b',
    'bg-sunken': '#0a1016',
    'bg-toolbar': '#0d141b',
    'bg-hover': 'rgba(220, 238, 246, 0.06)',
    'bg-selected': 'rgba(143, 212, 232, 0.16)',
    ink: '#eef4f8',
    'ink-soft': '#a8b9c5',
    'ink-faint': '#8a9cab',
    line: 'rgba(200, 230, 240, 0.1)',
    'line-strong': 'rgba(200, 230, 240, 0.2)',
    accent: '#8fd4e8',
    'accent-strong': '#b5e5f2',
    'accent-soft': 'rgba(143, 212, 232, 0.14)',
    'accent-ink': '#061018',
    'accent-text': '#9bd9eb',
    glow: 'rgba(143, 212, 232, 0.35)',
    'focus-ring': '0 0 0 3px rgba(143, 212, 232, 0.5)',
  },
};

/** Token-Satz für einen Farbton ableiten. */
export function buildTheme(sourceHex) {
  const [, sourceC, H] = rgbToOklch(hexToRgb(sourceHex));
  const accentC = Math.min(0.15, sourceC);

  // Dunkel: Navy-artige, leicht getönte Flächen.
  const d = {};
  d['bg-sunken'] = oklch(0.165, 0.012, H);
  d['bg-window'] = oklch(0.19, 0.016, H);
  d['bg-sidebar'] = oklch(0.215, 0.02, H);
  d['bg-elevated'] = oklch(0.245, 0.022, H);
  d['bg-toolbar'] = d['bg-window'];
  const darkBgs = [d['bg-sunken'], d['bg-window'], d['bg-sidebar'], d['bg-elevated']];
  d.ink = ensureContrast(0.96, 0.008, H, darkBgs, 7, 1);
  d['ink-soft'] = ensureContrast(0.8, 0.022, H, darkBgs, 4.5, 1);
  d['ink-faint'] = ensureContrast(0.72, 0.022, H, darkBgs, 4.5, 1);
  d.accent = ensureContrast(0.82, accentC, H, darkBgs, 3, 1);
  d['accent-strong'] = oklch(0.88, accentC * 0.8, H);
  d['accent-text'] = ensureContrast(0.84, accentC * 0.85, H, darkBgs, 4.5, 1);
  d['accent-ink'] = ensureContrast(0.17, 0.03, H, [d.accent, d['accent-strong']], 4.5, -1);
  d['bg-hover'] = rgba(oklch(0.92, 0.02, H), 0.06);
  d['bg-selected'] = rgba(d.accent, 0.16);
  d['accent-soft'] = rgba(d.accent, 0.14);
  d.line = rgba(oklch(0.88, 0.03, H), 0.1);
  d['line-strong'] = rgba(oklch(0.88, 0.03, H), 0.2);
  d.glow = rgba(d.accent, 0.35);
  d['focus-ring'] = `0 0 0 3px ${rgba(d.accent, 0.5)}`;

  // Hell: fast weiße Flächen mit Hauch der Typfarbe, dunkle Akzente.
  const l = {};
  l['bg-elevated'] = oklch(0.995, 0.003, H);
  l['bg-window'] = oklch(0.972, 0.007, H);
  l['bg-sidebar'] = oklch(0.945, 0.014, H);
  l['bg-sunken'] = oklch(0.955, 0.01, H);
  l['bg-toolbar'] = l['bg-window'];
  const lightBgs = [l['bg-elevated'], l['bg-window'], l['bg-sidebar'], l['bg-sunken']];
  l.ink = ensureContrast(0.2, 0.015, H, lightBgs, 7, -1);
  l['ink-soft'] = ensureContrast(0.44, 0.025, H, lightBgs, 4.5, -1);
  l['ink-faint'] = ensureContrast(0.5, 0.02, H, lightBgs, 4.5, -1);
  l['accent-ink'] = '#ffffff';
  l.accent = ensureContrast(0.52, accentC, H, [...lightBgs, '#ffffff'], 4.5, -1);
  l['accent-strong'] = oklch(rgbToOklch(hexToRgb(l.accent))[0] - 0.06, accentC, H);
  l['accent-text'] = ensureContrast(0.46, accentC * 0.9, H, lightBgs, 4.5, -1);
  l['bg-hover'] = rgba(oklch(0.2, 0.02, H), 0.05);
  l['bg-selected'] = rgba(l.accent, 0.14);
  l['accent-soft'] = rgba(l.accent, 0.12);
  l.line = rgba(oklch(0.2, 0.02, H), 0.1);
  l['line-strong'] = rgba(oklch(0.2, 0.02, H), 0.2);
  l.glow = rgba(l.accent, 0.28);
  l['focus-ring'] = `0 0 0 3px ${rgba(l.accent, 0.45)}`;

  return { light: l, dark: d };
}

export function allThemes() {
  const themes = { home: HOME_THEME };
  for (const [id, hex] of Object.entries(THEME_SOURCES)) themes[id] = buildTheme(hex);
  return themes;
}

/**
 * Zu prüfende Text/Hintergrund-Paare (inkl. Text auf Auswahl/Hover-Flächen).
 * Text ≥ 4,5:1, Akzent als UI-Grafik ≥ 3:1.
 */
export function contrastPairs(tokens) {
  const opaque = ['bg-window', 'bg-sidebar', 'bg-elevated', 'bg-sunken'];
  const pairs = [];
  for (const bg of opaque) {
    for (const fg of ['ink', 'ink-soft', 'ink-faint', 'accent-text']) pairs.push({ fg, bg, min: 4.5 });
    pairs.push({ fg: 'accent', bg, min: 3 });
  }
  pairs.push({ fg: 'accent-ink', bg: 'accent', min: 4.5 });
  pairs.push({ fg: 'accent-ink', bg: 'accent-strong', min: 4.5 });
  for (const overlay of ['bg-selected', 'bg-hover']) {
    for (const base of ['bg-window', 'bg-sidebar']) {
      for (const fg of ['ink', 'ink-soft']) pairs.push({ fg, bg: `${overlay}@${base}`, min: 4.5 });
    }
  }
  return pairs.map((p) => {
    const [overlay, base] = p.bg.split('@');
    const bgHex = base ? composite(tokens[overlay], tokens[base]) : tokens[p.bg];
    return { ...p, ratio: contrast(tokens[p.fg], bgHex) };
  });
}

/** SCSS mit allen Themes (Home = :root). */
export function renderThemesScss() {
  const themes = allThemes();
  const block = (selector, tokens, indent = '') =>
    `${indent}${selector} {\n${Object.entries(tokens)
      .map(([k, v]) => `${indent}  --${k}: ${v};`)
      .join('\n')}\n${indent}}\n`;
  let out = '/*\n * AUTOMATISCH ERZEUGT von scripts/build-themes.mjs – nicht von Hand ändern.\n';
  out += ' * Farbprofile je Dateityp (OKLCH-abgeleitet), Hell + Dunkel, WCAG AA geprüft (scripts/test/themes.test.mjs).\n */\n\n';
  const selectorFor = (id) => (id === 'home' ? ":root,\n:root[data-theme='home']" : `:root[data-theme='${id}']`);
  for (const [id, theme] of Object.entries(themes)) out += block(selectorFor(id), theme.light);
  out += '\n@media (prefers-color-scheme: dark) {\n';
  for (const [id, theme] of Object.entries(themes)) out += block(selectorFor(id).replace(/\n/g, '\n  '), theme.dark, '  ');
  out += '}\n';
  return out;
}
