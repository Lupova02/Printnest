import { FileKind, LibraryEntry } from '../../core/services/library.service';

export type NameSuggestionKind = 'folder' | 'file' | 'variant';

export interface NameSuggestion {
  id: string;
  kind: NameSuggestionKind;
  label: string;
  value: string;
  reason: string;
  /** Herkunft für die Lerngewichtung (z. B. 'clean', '3mf-title', 'schema'). */
  source?: string;
  /** Erkannte Druckparameter (Material, Schichthöhe …). */
  tags?: string[];
}

export interface AnalyzedItem {
  id: string;
  source: 'file' | 'link';
  originalName: string;
  displayName: string;
  extension: string | null;
  fileKind: FileKind | null;
  url?: string;
  file?: File;
  tokens: string[];
  baseTitle: string;
  suggestions: NameSuggestion[];
  similarCount: number;
}

const EXT_TO_KIND: Record<string, FileKind> = {
  stl: 'stl',
  '3mf': '3mf',
  f3d: 'f3d',
  pdf: 'pdf',
  mp4: 'mp4',
  png: 'img',
  jpg: 'img',
  jpeg: 'img',
  webp: 'img',
  gif: 'img',
  bmp: 'img',
  tif: 'img',
  tiff: 'img',
};

const STOP = new Set([
  'the',
  'and',
  'und',
  'for',
  'mit',
  'von',
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'to',
  'of',
  'a',
  'an',
  'v1',
  'v2',
  'v3',
  'final',
  'copy',
  'neu',
  'new',
  'print',
  'printed',
  'model',
  'file',
  'stl',
  '3mf',
  'f3d',
  'pdf',
  'mp4',
]);

function stripExtension(name: string): { base: string; extension: string | null } {
  const match = name.match(/^(.*?)(\.[A-Za-z0-9]+)?$/);
  if (!match) return { base: name, extension: null };
  const extension = match[2] ? match[2].slice(1).toLowerCase() : null;
  return { base: match[1] || name, extension };
}

function cleanToken(raw: string): string {
  return raw
    .replace(/^[\W_]+|[\W_]+$/g, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/** UUID / lange Hex-IDs und reine Zahlen am Ende entfernen. */
function stripNoise(base: string): string {
  return base
    .replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{4,}){1,}\b/gi, ' ')
    .replace(/\b[0-9a-f]{12,}\b/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectKindFromName(name: string): FileKind | null {
  const { extension } = stripExtension(name);
  if (!extension) return null;
  return EXT_TO_KIND[extension] ?? null;
}

export function detectKindFromUrl(url: string): FileKind | null {
  try {
    const pathname = new URL(url).pathname;
    const leaf = pathname.split('/').filter(Boolean).pop() || '';
    return detectKindFromName(leaf) || 'link';
  } catch {
    return 'link';
  }
}

export function tokenizeName(name: string): { tokens: string[]; baseTitle: string } {
  const { base } = stripExtension(name);
  const cleaned = stripNoise(base.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim());
  const parts = cleaned
    .split(/[^a-zA-Z0-9äöüÄÖÜß]+/)
    .map(cleanToken)
    .filter((t) => t.length >= 2 && !STOP.has(t.toLowerCase()));

  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (unique.some((u) => u.toLowerCase() === key)) continue;
    unique.push(part);
  }

  const baseTitle = titleCase(unique.slice(0, 4).join(' ') || cleaned || base);
  return { tokens: unique, baseTitle };
}

function kindLabel(kind: FileKind | null): string {
  if (!kind) return 'Datei';
  if (kind === 'img') return 'Bild';
  if (kind === 'link') return 'Link';
  return kind.toUpperCase();
}

function pushUnique(list: NameSuggestion[], item: NameSuggestion): void {
  if (list.some((x) => x.value.toLowerCase() === item.value.toLowerCase() && x.kind === item.kind)) {
    return;
  }
  list.push(item);
}

/**
 * Individuelle Namensvorschläge aus Dateiname/URL und ähnlichen Bibliothekseinträgen.
 */
export function buildNameSuggestions(
  originalName: string,
  fileKind: FileKind | null,
  similar: LibraryEntry[],
): { suggestions: NameSuggestion[]; similarCount: number; tokens: string[]; baseTitle: string } {
  const { extension } = stripExtension(originalName);
  const { tokens, baseTitle } = tokenizeName(originalName);
  const suggestions: NameSuggestion[] = [];
  const similarSameKind = similar.filter((e) => !fileKind || e.kind === fileKind || e.type === 'folder');
  const similarFiles = similarSameKind.filter((e) => e.type === 'file');
  const similarCount = similarFiles.length;

  if (baseTitle) {
    pushUnique(suggestions, {
      id: 'folder-base',
      kind: 'folder',
      label: 'Ordner',
      value: baseTitle,
      reason: `Aus dem Namen abgeleitet (${kindLabel(fileKind)})`,
    });
  }

  if (tokens.length >= 2) {
    const shortFolder = titleCase(tokens.slice(0, 2).join(' '));
    pushUnique(suggestions, {
      id: 'folder-short',
      kind: 'folder',
      label: 'Ordner',
      value: shortFolder,
      reason: 'Kurzform aus den wichtigsten Begriffen',
    });
  }

  if (tokens[0]) {
    const category = titleCase(tokens[0]);
    pushUnique(suggestions, {
      id: 'folder-category',
      kind: 'folder',
      label: 'Ordner',
      value: category,
      reason: `Kategorie „${category}“ für ähnliche Modelle`,
    });
  }

  // Häufige Parent-Ordner ähnlicher Dateien als Vorschlag
  const parentScores = new Map<string, number>();
  for (const entry of similarFiles) {
    const leaf = (entry.parentPath || '').split('/').filter(Boolean).pop();
    if (!leaf) continue;
    if (tokens.some((t) => leaf.toLowerCase().includes(t.toLowerCase())) || leaf.length >= 3) {
      parentScores.set(leaf, (parentScores.get(leaf) || 0) + 1);
    }
  }
  const topParents = [...parentScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [parent, count] of topParents) {
    pushUnique(suggestions, {
      id: `folder-lib-${parent}`,
      kind: 'folder',
      label: 'Ordner',
      value: parent,
      reason:
        count > 1
          ? `Häufig bei ${count} ähnlichen ${kindLabel(fileKind)}-Dateien`
          : `Bereits in der Bibliothek für ähnliche Dateien`,
    });
  }

  // Dateiname
  const fileBase = baseTitle || titleCase(stripNoise(stripExtension(originalName).base));
  const withExt = extension ? `${fileBase}.${extension}` : fileBase;
  pushUnique(suggestions, {
    id: 'file-clean',
    kind: 'file',
    label: 'Datei',
    value: withExt,
    reason: 'Bereinigter Dateiname',
  });

  if (tokens.length >= 2) {
    const descriptive = titleCase(tokens.join(' '));
    const descriptiveFile = extension ? `${descriptive}.${extension}` : descriptive;
    pushUnique(suggestions, {
      id: 'file-desc',
      kind: 'file',
      label: 'Datei',
      value: descriptiveFile,
      reason: 'Beschreibender Name aus allen erkannten Begriffen',
    });
  }

  // Varianten, wenn viele ähnliche Dateien derselben Art existieren
  if (similarCount >= 2) {
    const usedNames = new Set(similarFiles.map((e) => e.name.toLowerCase()));
    const variantSeeds = [
      tokens.slice(1).join(' '),
      tokens.filter((t) => !/^\d+$/.test(t)).slice(-2).join(' '),
      tokens[tokens.length - 1] || '',
    ]
      .map((s) => titleCase(s.trim()))
      .filter(Boolean);

    let index = 1;
    for (const seed of variantSeeds) {
      const folderVariant = seed.length > 1 ? `${baseTitle.split(' ')[0] || 'Modell'} ${seed}` : `${baseTitle} ${index}`;
      const fileVariantBase = seed.length > 1 ? `${titleCase(tokens[0] || 'Modell')} - ${seed}` : `${fileBase} ${index}`;
      const fileVariant = extension ? `${fileVariantBase}.${extension}` : fileVariantBase;

      if (!usedNames.has(fileVariant.toLowerCase())) {
        pushUnique(suggestions, {
          id: `variant-file-${index}`,
          kind: 'variant',
          label: 'Variante',
          value: fileVariant,
          reason: `${similarCount} ähnliche Dateien gefunden — unterscheidender Name`,
        });
      }
      pushUnique(suggestions, {
        id: `variant-folder-${index}`,
        kind: 'variant',
        label: 'Ordner-Variante',
        value: titleCase(folderVariant),
        reason: `Eigener Ordner neben ${similarCount} ähnlichen Einträgen`,
      });
      index += 1;
      if (index > 3) break;
    }

    // Nummerierte Variante als Fallback
    let n = similarCount + 1;
    while (n < similarCount + 4) {
      const numbered = extension ? `${fileBase} ${n}.${extension}` : `${fileBase} ${n}`;
      if (!usedNames.has(numbered.toLowerCase())) {
        pushUnique(suggestions, {
          id: `variant-num-${n}`,
          kind: 'variant',
          label: 'Variante',
          value: numbered,
          reason: `Nummeriert, weil „${fileBase}“ schon mehrfach vorkommt`,
        });
        break;
      }
      n += 1;
    }
  }

  return { suggestions: suggestions.slice(0, 10), similarCount, tokens, baseTitle };
}

export function analyzeFile(file: File, similar: LibraryEntry[]): AnalyzedItem {
  const fileKind = detectKindFromName(file.name);
  const built = buildNameSuggestions(file.name, fileKind, similar);
  return {
    id: `file-${file.name}-${file.size}-${file.lastModified}`,
    source: 'file',
    originalName: file.name,
    displayName: file.name,
    extension: stripExtension(file.name).extension,
    fileKind,
    file,
    tokens: built.tokens,
    baseTitle: built.baseTitle,
    suggestions: built.suggestions,
    similarCount: built.similarCount,
  };
}

export function analyzeLink(url: string, similar: LibraryEntry[]): AnalyzedItem {
  let leaf = url;
  try {
    leaf = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || url);
  } catch {
    // keep raw
  }
  const fileKind = detectKindFromUrl(url);
  const built = buildNameSuggestions(leaf, fileKind === 'link' ? null : fileKind, similar);
  return {
    id: `link-${url}`,
    source: 'link',
    originalName: leaf,
    displayName: url,
    extension: stripExtension(leaf).extension,
    fileKind: fileKind || 'link',
    url,
    tokens: built.tokens,
    baseTitle: built.baseTitle,
    suggestions: built.suggestions,
    similarCount: built.similarCount,
  };
}

export function kindDisplayLabel(kind: FileKind | null): string {
  return kindLabel(kind);
}

export interface SortScheme {
  id: string;
  title: string;
  description: string;
  /** Beispiel-Namen in Reihenfolge der Varianten. */
  examples: string[];
  /** Empfohlen, wenn Bibliothek schon so benennt. */
  recommended?: boolean;
}

const TEXT_LABELS_DE = ['Basis', 'Variante', 'Alternative', 'Revision', 'Neu'];
const TEXT_LABELS_SHAPE = ['Flach', 'Hoch', 'Rund', 'Eckig', 'Offen'];
const TEXT_LABELS_SIZE = ['Klein', 'Mittel', 'Groß', 'XL', 'XXL'];

function withExt(base: string, extension: string | null): string {
  return extension ? `${base}.${extension}` : base;
}

function detectExistingScheme(names: string[]): string | null {
  const bases = names.map((n) => stripExtension(n).base);
  if (bases.filter((b) => /\bv\s*\d+\b/i.test(b) || /\bv\d+\b/i.test(b)).length >= 2) return 'v-prefix';
  if (bases.filter((b) => /\b\d+\.\d+\b/.test(b)).length >= 2) return 'semver';
  if (bases.filter((b) => /\(\d+\)\s*$/.test(b)).length >= 2) return 'paren';
  if (bases.filter((b) => /[_\-\s]\d{2}$/.test(b)).length >= 2) return 'padded';
  if (bases.filter((b) => /\s[A-Z]$/.test(b)).length >= 2) return 'letter';
  return null;
}

/**
 * Sortier-/Benennungsschemata für mehrere ähnliche Dateien (V1/V2, 1.1/1.2, Text, …).
 */
export function buildSortSchemes(options: {
  baseTitle: string;
  extension: string | null;
  similarNames?: string[];
  count?: number;
}): SortScheme[] {
  const base = options.baseTitle.trim() || 'Modell';
  const ext = options.extension;
  const similarNames = options.similarNames || [];
  const count = Math.min(Math.max(options.count || similarNames.length || 3, 3), 6);
  const existing = detectExistingScheme(similarNames);
  const indexes = Array.from({ length: count }, (_, i) => i);

  const schemes: SortScheme[] = [
    {
      id: 'v-prefix',
      title: 'Version V1 / V2',
      description: 'Klar und kurz — gut für Iterationen desselben Modells.',
      examples: indexes.map((i) => withExt(`${base} V${i + 1}`, ext)),
      recommended: existing === 'v-prefix',
    },
    {
      id: 'semver',
      title: 'Unterversion 1.0 / 1.1',
      description: 'Feinere Schritte — sinnvoll bei kleinen Änderungen.',
      examples: indexes.map((i) => withExt(`${base} 1.${i}`, ext)),
      recommended: existing === 'semver',
    },
    {
      id: 'padded',
      title: 'Zweistellig 01 / 02',
      description: 'Sortiert im Finder/Explorer sauber nach Zahl.',
      examples: indexes.map((i) => withExt(`${base} ${String(i + 1).padStart(2, '0')}`, ext)),
      recommended: existing === 'padded',
    },
    {
      id: 'paren',
      title: 'Klammer (1) / (2)',
      description: 'Klassische Dubletten-Benennung.',
      examples: indexes.map((i) => withExt(`${base} (${i + 1})`, ext)),
      recommended: existing === 'paren',
    },
    {
      id: 'letter',
      title: 'Buchstaben A / B / C',
      description: 'Ohne Zahlen — gut, wenn Reihenfolge egal ist.',
      examples: indexes.map((i) => withExt(`${base} ${String.fromCharCode(65 + i)}`, ext)),
      recommended: existing === 'letter',
    },
    {
      id: 'text-de',
      title: 'Text: Basis / Variante / …',
      description: 'Deutsche Wörter statt Zahlen — lesbar auf einen Blick.',
      examples: indexes.map((i) => withExt(`${base} ${TEXT_LABELS_DE[i] || `Variante ${i + 1}`}`, ext)),
    },
    {
      id: 'text-shape',
      title: 'Form: Flach / Hoch / Rund',
      description: 'Wenn sich die Modelle in der Form unterscheiden.',
      examples: indexes.map((i) => withExt(`${base} ${TEXT_LABELS_SHAPE[i] || `Form ${i + 1}`}`, ext)),
    },
    {
      id: 'text-size',
      title: 'Größe: Klein / Mittel / Groß',
      description: 'Wenn es um skalierte Varianten geht.',
      examples: indexes.map((i) => withExt(`${base} ${TEXT_LABELS_SIZE[i] || `Größe ${i + 1}`}`, ext)),
    },
    {
      id: 'folder-versions',
      title: 'Ordner pro Version',
      description: 'Saubere Struktur: ein Ordner je Variante, Datei darin einheitlich.',
      examples: indexes.map((i) => `${base} / V${i + 1} / ${withExt(base, ext)}`),
    },
    {
      id: 'dash-rev',
      title: 'Bindestrich Rev-01',
      description: 'Technischer Stil für Serien und Revisionen.',
      examples: indexes.map((i) => withExt(`${base}-Rev-${String(i + 1).padStart(2, '0')}`, ext)),
    },
  ];

  // Unterscheidende Tokens aus bestehenden Namen → eigenes Schema
  const baseTokens = new Set(tokenizeName(base).tokens.map((t) => t.toLowerCase()));
  const diffs = new Set<string>();
  for (const name of similarNames) {
    for (const token of tokenizeName(name).tokens) {
      if (!baseTokens.has(token.toLowerCase()) && token.length >= 2 && !/^\d+$/.test(token)) {
        diffs.add(titleCase(token));
      }
    }
  }
  const diffList = [...diffs].slice(0, count);
  if (diffList.length >= 2) {
    schemes.unshift({
      id: 'from-library',
      title: 'Aus deinen Dateinamen',
      description: 'Unterscheidende Begriffe, die in der Bibliothek schon vorkommen.',
      examples: diffList.map((d) => withExt(`${base} ${d}`, ext)),
      recommended: true,
    });
  }

  return schemes.sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
}

