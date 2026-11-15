import path from 'node:path';
import { readJson, withFileLock, writeJsonAtomic } from './json-file.mjs';

/** Lokale Lerndaten des Namens-Assistenten (userData/printnest-data/name-assist.json). */
export const NAME_ASSIST_FILE = 'name-assist.json';
const MAX_WORDS = 300;
const MAX_SCHEMAS = 200;
const FIELDS = new Set(['model', 'variant', 'material', 'layerHeight', 'nozzle', 'printer', 'version', 'printTime']);

function empty() {
  return { version: 1, schemas: {}, sources: {}, keep: {}, drop: {} };
}

/** Häufigste Wörter behalten, damit die Datei klein bleibt. */
function trimCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_WORDS),
  );
}

function validSchema(schema) {
  if (!schema || !Array.isArray(schema.fields) || typeof schema.separator !== 'string') return null;
  const fields = schema.fields.filter((f) => FIELDS.has(f)).slice(0, 8);
  if (!fields.length || schema.separator.length > 5 || /[/\\:]/.test(schema.separator)) return null;
  return { fields, separator: schema.separator };
}

export function createNameAssistStore(dataDir) {
  const file = path.join(dataDir, NAME_ASSIST_FILE);

  async function read() {
    const data = await readJson(file, empty());
    return { ...empty(), ...(data && typeof data === 'object' ? data : {}) };
  }

  function update(fn) {
    return withFileLock(file, async () => {
      const data = await read();
      fn(data);
      data.keep = trimCounts(data.keep);
      data.drop = trimCounts(data.drop);
      const schemaKeys = Object.keys(data.schemas);
      if (schemaKeys.length > MAX_SCHEMAS) for (const key of schemaKeys.slice(0, schemaKeys.length - MAX_SCHEMAS)) delete data.schemas[key];
      await writeJsonAtomic(file, data);
      return data;
    });
  }

  return {
    read,
    /** Schema für einen Ordner setzen (null entfernt es). */
    setSchema(folder, schema) {
      const valid = schema === null ? null : validSchema(schema);
      if (schema !== null && !valid) throw Object.assign(new Error('Ungültiges Schema.'), { status: 400 });
      return update((data) => {
        if (valid) data.schemas[String(folder ?? '')] = valid;
        else delete data.schemas[String(folder ?? '')];
      });
    },
    /** Rückmeldung: Vorschlagsquelle angenommen/abgelehnt, Wörter behalten/entfernen. */
    recordFeedback(input) {
      return update((data) => {
        const source = typeof input?.source === 'string' ? input.source.slice(0, 40) : null;
        if (source) {
          const entry = data.sources[source] ?? { accepted: 0, rejected: 0 };
          if (input.accepted) entry.accepted += 1;
          else entry.rejected += 1;
          data.sources[source] = entry;
        }
        for (const [key, list] of [['keep', input?.keep], ['drop', input?.drop]]) {
          if (!Array.isArray(list)) continue;
          for (const word of list.slice(0, 20)) {
            const w = String(word).toLowerCase().trim().slice(0, 40);
            if (w.length < 2) continue;
            data[key][w] = (data[key][w] ?? 0) + 1;
            // Gegenteil abschwächen, damit sich Präferenzen umkehren lassen.
            const other = key === 'keep' ? 'drop' : 'keep';
            if (data[other][w]) data[other][w] -= 1;
            if (data[other][w] <= 0) delete data[other][w];
          }
        }
      });
    },
  };
}
