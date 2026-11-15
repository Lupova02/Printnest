/**
 * Dateinamen zerlegen, bereinigen und nach Schema neu zusammensetzen – rein lokal, ohne KI.
 * Beispiel: `benchy_0.2mm_PLA_2h13m.3mf` → Modell „Benchy“, Tags „PLA“, „0,2 mm“, „2 h 13 min“.
 */

export type NameField = 'model' | 'variant' | 'material' | 'layerHeight' | 'nozzle' | 'printer' | 'version' | 'printTime';

export const FIELD_LABELS: Record<NameField, string> = {
  model: 'Modell',
  variant: 'Variante',
  material: 'Material',
  layerHeight: 'Schichthöhe',
  nozzle: 'Düse',
  printer: 'Drucker',
  version: 'Version',
  printTime: 'Druckzeit',
};

export interface ParsedName {
  original: string;
  extension: string | null;
  model: string;
  variant: string | null;
  material: string | null;
  layerHeight: string | null;
  nozzle: string | null;
  printer: string | null;
  version: string | null;
  printTime: string | null;
  /** Erkannte Druckparameter als Tags (Material, Schichthöhe, Düse, Drucker, Druckzeit). */
  tags: string[];
  /** Entfernte Störwörter (z. B. „final“, „(1)“, „copy“). */
  removed: string[];
}

/** Gelerntes Verhalten: Wörter, die behalten bzw. immer entfernt werden sollen. */
export interface CleanupHints {
  keep?: ReadonlySet<string>;
  drop?: ReadonlySet<string>;
}

/** Benennungsschema pro Ordner: Reihenfolge der Felder + Trenner. */
export interface NameSchema {
  fields: NameField[];
  separator: string;
}

export const SCHEMA_PRESETS: { id: string; label: string; schema: NameSchema }[] = [
  { id: 'model-variant', label: 'Modell – Variante', schema: { fields: ['model', 'variant'], separator: ' – ' } },
  {
    id: 'full',
    label: 'Modell – Variante – Material – Schichthöhe',
    schema: { fields: ['model', 'variant', 'material', 'layerHeight'], separator: ' – ' },
  },
  { id: 'model-version', label: 'Modell – Version', schema: { fields: ['model', 'version'], separator: ' – ' } },
  {
    id: 'printer',
    label: 'Modell – Drucker – Material',
    schema: { fields: ['model', 'printer', 'material'], separator: ' – ' },
  },
  { id: 'underscore', label: 'Modell_Variante_Material', schema: { fields: ['model', 'variant', 'material'], separator: '_' } },
];

const MATERIALS = [
  'PLA+', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PAHT-CF', 'PA6-CF', 'PLA', 'PETG', 'PET', 'ABS', 'ASA', 'TPU', 'TPE',
  'PA6', 'PA12', 'PA', 'PC', 'PVA', 'HIPS', 'PP', 'PVB', 'Resin',
];
const MATERIAL_MODIFIERS = ['silk', 'matte', 'matt', 'galaxy', 'marble', 'glow', 'wood', 'cf', 'gf', 'hf', 'basic'];
/** Wortgrenze, die auch Unterstriche als Trenner gelten lässt (anders als \b). */
function word(pattern: string): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`, 'i');
}

const PRINTERS: [RegExp, string][] = [
  [word('a1[\\s_-]?mini'), 'A1 mini'],
  [word('x1[\\s_-]?c(?:arbon)?'), 'X1C'],
  [word('x1[\\s_-]?e'), 'X1E'],
  [word('p1[\\s_-]?s'), 'P1S'],
  [word('p1[\\s_-]?p'), 'P1P'],
  [word('h2[\\s_-]?d'), 'H2D'],
  [word('a1'), 'A1'],
  [word('mk[\\s_-]?4s?'), 'MK4'],
  [word('mk[\\s_-]?3s?\\+?'), 'MK3S'],
  [word('core[\\s_-]?one'), 'Core One'],
  [word('ender[\\s_-]?3(?:[\\s_-]?(?:v[23]|pro|s1))?'), 'Ender-3'],
  [word('k1[\\s_-]?max'), 'K1 Max'],
  [word('k1c?'), 'K1'],
  [word('voron'), 'Voron'],
];
const NOISE = new Set(['final', 'finale', 'fertig', 'copy', 'kopie', 'neu', 'new', 'export', 'exported', 'print', 'druck', 'stl', '3mf', 'f3d', 'model', 'modell', 'file', 'datei', 'v', 'tmp', 'test']);
const SMALL_WORDS = new Set(['und', 'and', 'für', 'for', 'mit', 'with', 'of', 'the', 'der', 'die', 'das', 'von', 'zu', 'in', 'am', 'im', 'an', 'a']);
const VARIANT_WORDS = new Set(['klein', 'mittel', 'groß', 'gross', 'small', 'medium', 'large', 'xl', 'xxl', 'mini', 'left', 'right', 'links', 'rechts', 'top', 'bottom', 'oben', 'unten', 'base', 'lid', 'deckel', 'body', 'part', 'teil', 'hollow', 'solid', 'supported', 'support', 'presupported']);

function splitExtension(name: string): { base: string; extension: string | null } {
  const match = /^(.*?)(?:\.([A-Za-z0-9]{1,5}))?$/.exec(name.trim());
  if (!match || !match[1]) return { base: name, extension: null };
  return { base: match[1], extension: match[2] ? match[2].toLowerCase() : null };
}

function decimal(value: string): string {
  return value.replace('.', ',');
}

/** Groß-/Kleinschreibung: Wörter mit Großbuchstaben bleiben, kleine werden kapitalisiert. */
function tidyWord(word: string, index: number): string {
  if (/[A-Z]/.test(word) || /\d/.test(word)) return word;
  if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function tidyPhrase(words: string[]): string {
  return words.map(tidyWord).join(' ').replace(/\s+/g, ' ').trim();
}

/** Dateinamen in Modell, Variante, Druckparameter und Störwörter zerlegen. */
export function parseFileName(name: string, hints: CleanupHints = {}): ParsedName {
  const { base, extension } = splitExtension(name);
  const removed: string[] = [];
  let rest = ` ${base} `;
  const take = (re: RegExp, format: (m: RegExpExecArray) => string): string | null => {
    const m = re.exec(rest);
    if (!m) return null;
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return format(m);
  };

  // UUIDs, lange Hex-IDs und Zeitstempel/IDs entfernen.
  rest = rest.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => (removed.push(m), ' '));
  rest = rest.replace(/(?<![a-z0-9])[0-9a-f]{12,}(?![a-z0-9])/gi, (m) => (removed.push(m), ' '));
  rest = rest.replace(/(?<![\d.,])\d{6,}(?![\d.,])/g, (m) => (removed.push(m), ' '));
  // Kopie-Zähler „(1)“, „ - Kopie“, „copy 2“.
  rest = rest.replace(/\s*\(\d{1,3}\)\s*/g, (m) => (removed.push(m.trim()), ' '));

  const layerHeight = take(/(?<![\d.,])(0[.,]\d{1,2})\s*mm(?:[\s_-]?(?:layer|lh|schicht))?(?![a-z])/i, (m) => `${decimal(m[1])} mm`)
    ?? take(/(?<![a-z\d])(?:lh|layer)[\s_-]?(0[.,]\d{1,2})(?![\d])/i, (m) => `${decimal(m[1])} mm`);
  const nozzle = take(/(?<![\d.,])(0[.,]\d)\s*(?:mm)?[\s_-]?(?:nozzle|düse|duese|n)(?![a-z])/i, (m) => `${decimal(m[1])} mm`)
    ?? take(/(?:nozzle|düse|duese)[\s_-]?(0[.,]\d)(?![\d])/i, (m) => `${decimal(m[1])} mm`);
  const printTime = take(/(?<![a-z\d])(\d{1,3})\s?h(?:rs?)?[\s_-]?(\d{1,2})\s?m(?:in)?(?![a-z])/i, (m) => `${+m[1]} h ${+m[2]} min`)
    ?? take(/(?<![a-z\d])(\d{1,3})\s?h(?:rs?)?(?![a-z\d])/i, (m) => `${+m[1]} h`)
    ?? take(/(?<![a-z\d])(\d{1,3})\s?min(?![a-z])/i, (m) => `${+m[1]} min`);

  let printer: string | null = null;
  for (const [re, label] of PRINTERS) {
    if (re.test(rest)) {
      rest = rest.replace(re, ' ');
      printer = label;
      break;
    }
  }

  let material: string | null = null;
  for (const mat of MATERIALS) {
    const escaped = mat.replace(/[+]/g, '\\+').replace(/-/g, '[\\s_-]?');
    const re = new RegExp(`(?<![a-z0-9])(?:(${MATERIAL_MODIFIERS.join('|')})[\\s_-]?)?${escaped}(?:[\\s_-]?(${MATERIAL_MODIFIERS.join('|')}))?(?![a-z0-9+])`, 'i');
    const m = re.exec(rest);
    if (!m) continue;
    const mod = m[1] || m[2];
    material = mod ? `${mat} ${mod.charAt(0).toUpperCase()}${mod.slice(1).toLowerCase()}` : mat;
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    break;
  }

  const version = take(/(?<![a-z\d])(?:v|ver|version|rev|r)[\s_.-]?(\d{1,3}(?:[.,]\d{1,2})?)(?![\d])/i, (m) => `V${m[1].replace(',', '.')}`);
  const plate = take(/(?<![a-z])plate[\s_-]?(\d{1,2})(?![\d])/i, (m) => `Platte ${+m[1]}`);

  // Variante: Text nach einem deutlichen Trenner („ - “, „__“, „ – “).
  let variantText: string | null = null;
  const sep = /\s[-–—]\s|__/.exec(rest);
  if (sep) {
    variantText = rest.slice(sep.index + sep[0].length);
    rest = rest.slice(0, sep.index);
  }

  const toWords = (text: string) =>
    text
      .replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2')
      .split(/[\s_.,+-]+/)
      .map((w) => w.trim())
      .filter(Boolean);

  const modelWords: string[] = [];
  const variantWords: string[] = [];
  for (const word of toWords(rest)) {
    const lower = word.toLowerCase();
    if (hints.drop?.has(lower)) {
      removed.push(word);
      continue;
    }
    if (NOISE.has(lower) && !hints.keep?.has(lower)) {
      removed.push(word);
      continue;
    }
    if (VARIANT_WORDS.has(lower) && modelWords.length) variantWords.push(word);
    else modelWords.push(word);
  }
  const extraVariant = variantText ? toWords(variantText).filter((w) => !NOISE.has(w.toLowerCase()) || hints.keep?.has(w.toLowerCase())) : [];
  const variantParts = [...extraVariant, ...variantWords].map((w, i) => tidyWord(w, i + 1));
  if (plate) variantParts.push(plate);
  // Doppelte Wörter entfernen (z. B. „benchy benchy“).
  const seen = new Set<string>();
  const uniqueModel = modelWords.filter((w) => {
    const key = w.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const model = tidyPhrase(uniqueModel) || tidyPhrase(toWords(base)) || base;
  const variant = variantParts.length ? variantParts.join(' ') : null;
  const tags = [material, layerHeight, nozzle && `Düse ${nozzle}`, printer, printTime].filter((t): t is string => !!t);
  return { original: name, extension, model, variant, material, layerHeight, nozzle, printer, version, printTime, tags, removed };
}

/** Bereinigter Name: „Modell – Variante (Version)“ + Endung, Druckparameter wandern in Tags. */
export function cleanFileName(name: string, hints: CleanupHints = {}): string {
  const parsed = parseFileName(name, hints);
  return withExtension(
    [parsed.model, parsed.variant, parsed.version].filter(Boolean).join(' – '),
    parsed.extension,
  );
}

export function withExtension(base: string, extension: string | null): string {
  return extension ? `${base}.${extension}` : base;
}

/** Namen nach Schema zusammensetzen; leere Felder fallen samt Trenner weg. */
export function applySchema(parsed: ParsedName, schema: NameSchema, overrides: Partial<Record<NameField, string | null>> = {}): string {
  const value = (field: NameField) => (field in overrides ? overrides[field] : parsed[field]) ?? '';
  const parts = schema.fields.map((f) => String(value(f)).trim()).filter(Boolean);
  const base = (parts.join(schema.separator) || parsed.model).replace(/[/\\:]/g, '-');
  return withExtension(base, parsed.extension);
}

/** Schema aus Geschwisterdateien erraten: welche Felder kommen dort regelmäßig vor? */
export function guessSchema(siblingNames: string[]): NameSchema | null {
  if (siblingNames.length < 2) return null;
  const parsed = siblingNames.map((n) => parseFileName(n));
  const share = (field: NameField) => parsed.filter((p) => !!p[field]).length / parsed.length;
  const sep = siblingNames.filter((n) => n.includes(' – ')).length >= siblingNames.length / 2 ? ' – ' : siblingNames.filter((n) => n.includes('_')).length >= siblingNames.length / 2 ? '_' : ' – ';
  const fields: NameField[] = ['model'];
  for (const field of ['variant', 'material', 'layerHeight', 'printer', 'version'] as NameField[]) {
    if (share(field) >= 0.5) fields.push(field);
  }
  return fields.length > 1 ? { fields, separator: sep } : null;
}

/** Wortähnlichkeit (Jaccard) zweier Namen – für „gehört zu …“ und ähnliche Dateien. */
export function nameSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      parseFileName(s)
        .model.toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3),
    );
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return common / (wa.size + wb.size - common);
}

/** Zeichenweiser Diff (Präfix/Suffix) für die Vorher/Nachher-Ansicht. */
export function diffNames(before: string, after: string): { prefix: string; removed: string; added: string; suffix: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  return {
    prefix: before.slice(0, start),
    removed: before.slice(start, before.length - end),
    added: after.slice(start, after.length - end),
    suffix: before.slice(before.length - end),
  };
}

/**
 * Lernen aus Korrekturen: Wörter, die der Nutzer gegenüber dem Vorschlag wieder ergänzt hat
 * („keep“), und Wörter, die er zusätzlich entfernt hat („drop“).
 */
export function learnFromCorrection(original: string, suggested: string, final: string): { keep: string[]; drop: string[] } {
  const words = (s: string) =>
    new Set(
      splitExtension(s)
        .base.toLowerCase()
        .split(/[\s_.,()+–-]+/)
        .filter((w) => w.length >= 2),
    );
  const o = words(original);
  const s = words(suggested);
  const f = words(final);
  const keep = [...f].filter((w) => o.has(w) && !s.has(w));
  const drop = [...s].filter((w) => o.has(w) && !f.has(w));
  return { keep, drop };
}
