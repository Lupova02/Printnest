import fs from 'node:fs/promises';
import { unzipSync } from 'fflate';

const MAX_BYTES = 512 * 1024 * 1024;

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Metadaten aus einer 3MF-Datei: Titel, Designer, Beschreibung (3D/3dmodel.model) sowie
 * Plate- und Objektnamen (Bambu/Orca: Metadata/model_settings.config). Entpackt nur diese Dateien.
 */
export async function read3mfMeta(absolutePath) {
  const st = await fs.stat(absolutePath);
  if (st.size > MAX_BYTES) return { plates: [], objects: [] };
  const files = unzipSync(new Uint8Array(await fs.readFile(absolutePath)), {
    filter: (f) => /3dmodel\.model$/i.test(f.name) || f.name === 'Metadata/model_settings.config',
  });
  const meta = { plates: [], objects: [] };
  const decoder = new TextDecoder();
  const rootName = Object.keys(files).find((n) => /3dmodel\.model$/i.test(n));
  if (rootName) {
    const xml = decoder.decode(files[rootName]);
    for (const m of xml.matchAll(/<(?:\w+:)?metadata\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?metadata>/g)) {
      const key = m[1].toLowerCase();
      const value = decodeXml(m[2]);
      if (!value) continue;
      if (key === 'title') meta.title = value.slice(0, 200);
      else if (key === 'designer') meta.designer = value.slice(0, 120);
      else if (key === 'description') meta.description = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    }
    for (const m of xml.matchAll(/<(?:\w+:)?object\b[^>]*\bname="([^"]+)"/g)) {
      const name = decodeXml(m[1]);
      if (name && !meta.objects.includes(name)) meta.objects.push(name);
    }
  }
  const settings = files['Metadata/model_settings.config'];
  if (settings) {
    const xml = decoder.decode(settings);
    for (const m of xml.matchAll(/<metadata\s+key="(plater_name|name)"\s+value="([^"]*)"/g)) {
      const value = decodeXml(m[2]);
      const list = m[1] === 'plater_name' ? meta.plates : meta.objects;
      if (value && !list.includes(value)) list.push(value);
    }
  }
  meta.objects = meta.objects.slice(0, 20);
  meta.plates = meta.plates.slice(0, 20);
  return meta;
}
