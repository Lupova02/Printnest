import { unzipSync } from 'fflate';

/**
 * Reine Parse-Logik für STL (binär/ASCII) und 3MF – ohne Three.js und DOM,
 * damit sie im Web Worker und in Tests laufen kann.
 */

export type ModelKind = 'stl' | '3mf';

/** Ab dieser Dreieckszahl wird für die Anzeige vereinfacht. */
export const SIMPLIFY_THRESHOLD = 1_000_000;
/** Zielgröße nach der Vereinfachung. */
export const SIMPLIFY_TARGET = 600_000;

export interface ThreeMfMeta {
  title?: string;
  designer?: string;
  description?: string;
  application?: string;
  plates: string[];
  objects: string[];
}

export interface ParsedModel {
  /** Nicht indizierte, zentrierte Positionen (9 Werte je Dreieck). */
  positions: Float32Array;
  /** Flache Normalen passend zu `positions`. */
  normals: Float32Array;
  /** Angezeigte Dreiecke. */
  triangles: number;
  /** Dreiecke in der Datei (vor Vereinfachung). */
  sourceTriangles: number;
  simplified: boolean;
  /** Maße in Modelleinheiten (x = Breite, y = Tiefe, z = Höhe). */
  size: { x: number; y: number; z: number };
  meta?: ThreeMfMeta;
}

// --- STL ---

function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (84 + count * 50 === bytes.length) return true;
  // ASCII beginnt mit „solid“ und enthält „facet“.
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512)));
  return !(/^\s*solid/i.test(head) && /facet/i.test(head));
}

export function parseStl(bytes: Uint8Array): Float32Array {
  if (isBinaryStl(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = Math.min(view.getUint32(80, true), Math.floor((bytes.length - 84) / 50));
    const out = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const base = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(base + k * 4, true);
    }
    return out;
  }
  const text = new TextDecoder().decode(bytes);
  const values: number[] = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) values.push(+match[1], +match[2], +match[3]);
  return new Float32Array(values.slice(0, values.length - (values.length % 9)));
}

// --- 3MF ---

type Matrix = number[]; // 12 Werte (3MF-Reihenfolge)

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseMatrix(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  const parts = value.trim().split(/\s+/).map(Number);
  return parts.length === 12 && parts.every(Number.isFinite) ? parts : IDENTITY;
}

/** a ∘ b: erst b, dann a anwenden. */
function compose(a: Matrix, b: Matrix): Matrix {
  const r: Matrix = new Array(12);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      r[row * 3 + col] = b[row * 3] * a[col] + b[row * 3 + 1] * a[3 + col] + b[row * 3 + 2] * a[6 + col];
    }
  }
  for (let col = 0; col < 3; col++) {
    r[9 + col] = b[9] * a[col] + b[10] * a[3 + col] + b[11] * a[6 + col] + a[9 + col];
  }
  return r;
}

function attrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out[m[1]] = m[2];
  return out;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

interface MeshObject {
  vertices: Float32Array;
  triangles: Uint32Array;
}

interface ModelObject {
  mesh?: MeshObject;
  components: { key: string; transform: Matrix }[];
}

function parseMesh(body: string): MeshObject | undefined {
  const verts: number[] = [];
  const vre = /<(?:\w+:)?vertex\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = vre.exec(body))) {
    const a = attrs(m[1]);
    verts.push(+a['x'] || 0, +a['y'] || 0, +a['z'] || 0);
  }
  if (!verts.length) return undefined;
  const tris: number[] = [];
  const tre = /<(?:\w+:)?triangle\b([^>]*)\/?>/g;
  while ((m = tre.exec(body))) {
    const a = attrs(m[1]);
    tris.push(+a['v1'] | 0, +a['v2'] | 0, +a['v3'] | 0);
  }
  return { vertices: new Float32Array(verts), triangles: new Uint32Array(tris) };
}

function parseModelFile(xml: string, path: string, objects: Map<string, ModelObject>): void {
  const ore = /<(?:\w+:)?object\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:\w+:)?object>)/g;
  let m: RegExpExecArray | null;
  while ((m = ore.exec(xml))) {
    const a = attrs(m[1]);
    const body = m[3] ?? '';
    const components: ModelObject['components'] = [];
    const cre = /<(?:\w+:)?component\b([^>]*)\/?>/g;
    let c: RegExpExecArray | null;
    while ((c = cre.exec(body))) {
      const ca = attrs(c[1]);
      const target = ca['p:path'] ? ca['p:path'].replace(/^\//, '') : path;
      components.push({ key: `${target}#${ca['objectid']}`, transform: parseMatrix(ca['transform']) });
    }
    objects.set(`${path}#${a['id']}`, { mesh: parseMesh(body), components });
  }
}

function rootModelPath(files: Record<string, Uint8Array>): string {
  const rels = files['_rels/.rels'];
  if (rels) {
    const target = /Target="\/?([^"]+\.model)"/i.exec(new TextDecoder().decode(rels))?.[1];
    if (target && files[target]) return target;
  }
  return Object.keys(files).find((n) => /3dmodel\.model$/i.test(n)) ?? Object.keys(files).find((n) => n.endsWith('.model')) ?? '';
}

/** Metadaten aus 3MF: Titel, Designer, Beschreibung, Plate- und Objektnamen (Bambu/Orca). */
export function parse3mfMetaFromFiles(files: Record<string, Uint8Array>): ThreeMfMeta {
  const meta: ThreeMfMeta = { plates: [], objects: [] };
  const root = rootModelPath(files);
  const decoder = new TextDecoder();
  if (root && files[root]) {
    const xml = decoder.decode(files[root]);
    const re = /<(?:\w+:)?metadata\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?metadata>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const key = m[1].toLowerCase();
      const value = decodeXml(m[2]);
      if (!value) continue;
      if (key === 'title') meta.title = value;
      else if (key === 'designer') meta.designer = value;
      else if (key === 'description') meta.description = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      else if (key === 'application') meta.application = value;
    }
    const ore = /<(?:\w+:)?object\b([^>]*)>/g;
    while ((m = ore.exec(xml))) {
      const name = attrs(m[1])['name'];
      if (name && !meta.objects.includes(name)) meta.objects.push(decodeXml(name));
    }
  }
  const settings = files['Metadata/model_settings.config'];
  if (settings) {
    const xml = decoder.decode(settings);
    const re = /<metadata\s+key="(plater_name|name)"\s+value="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const value = decodeXml(m[2]);
      if (!value) continue;
      const list = m[1] === 'plater_name' ? meta.plates : meta.objects;
      if (!list.includes(value)) list.push(value);
    }
  }
  meta.objects = meta.objects.slice(0, 20);
  return meta;
}

/** Nur die für Metadaten nötigen Dateien entpacken (schnell, auch für große 3MF). */
export function read3mfMeta(bytes: Uint8Array): ThreeMfMeta {
  const files = unzipSync(bytes, {
    filter: (f) => f.name === '_rels/.rels' || /3dmodel\.model$/i.test(f.name) || f.name === 'Metadata/model_settings.config',
  });
  return parse3mfMetaFromFiles(files);
}

export function parse3mf(bytes: Uint8Array): { positions: Float32Array; meta: ThreeMfMeta } {
  const files = unzipSync(bytes, {
    filter: (f) => f.name.endsWith('.model') || f.name.endsWith('.rels') || f.name === 'Metadata/model_settings.config',
  });
  const decoder = new TextDecoder();
  const objects = new Map<string, ModelObject>();
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('.model')) parseModelFile(decoder.decode(data), name, objects);
  }
  const root = rootModelPath(files);
  const rootXml = root ? decoder.decode(files[root]) : '';
  const items: { key: string; transform: Matrix }[] = [];
  const ire = /<(?:\w+:)?item\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = ire.exec(rootXml))) {
    const a = attrs(m[1]);
    const target = a['p:path'] ? a['p:path'].replace(/^\//, '') : root;
    items.push({ key: `${target}#${a['objectid']}`, transform: parseMatrix(a['transform']) });
  }
  // Ohne Build-Items alle Objekte mit Mesh anzeigen.
  if (!items.length) {
    for (const [key, obj] of objects) if (obj.mesh) items.push({ key, transform: IDENTITY });
  }

  const count = (key: string, depth: number): number => {
    const obj = objects.get(key);
    if (!obj || depth > 16) return 0;
    let total = obj.mesh ? obj.mesh.triangles.length / 3 : 0;
    for (const c of obj.components) total += count(c.key, depth + 1);
    return total;
  };
  const total = items.reduce((sum, item) => sum + count(item.key, 0), 0);
  const out = new Float32Array(total * 9);
  let offset = 0;

  const emit = (key: string, transform: Matrix, depth: number): void => {
    const obj = objects.get(key);
    if (!obj || depth > 16) return;
    if (obj.mesh) {
      const { vertices: v, triangles: t } = obj.mesh;
      const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = transform;
      for (let k = 0; k < t.length; k++) {
        const vi = t[k] * 3;
        const x = v[vi] ?? 0;
        const y = v[vi + 1] ?? 0;
        const z = v[vi + 2] ?? 0;
        out[offset++] = x * a + y * d + z * g + tx;
        out[offset++] = x * b + y * e + z * h + ty;
        out[offset++] = x * c + y * f + z * i + tz;
      }
    }
    for (const comp of obj.components) emit(comp.key, compose(transform, comp.transform), depth + 1);
  };
  for (const item of items) emit(item.key, item.transform, 0);
  return { positions: out, meta: parse3mfMetaFromFiles(files) };
}

// --- Nachbearbeitung ---

/** Vereinfachung per Vertex-Clustering (schnell, O(n)); liefert neue Positionen. */
export function simplifyPositions(positions: Float32Array, target = SIMPLIFY_TARGET): Float32Array {
  const triangles = positions.length / 9;
  if (triangles <= target) return positions;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // Oberflächen-Netze: Dreiecke ~ 2 × belegte Zellen ~ R². Startauflösung daraus schätzen.
  let resolution = Math.max(16, Math.min(2048, Math.round(Math.sqrt(target) * 1.1)));
  let result = positions;
  for (let attempt = 0; attempt < 4; attempt++) {
    const cell = extent / resolution;
    const ids = new Map<number, number>();
    const sums: number[] = [];
    const vertexCluster = new Int32Array(positions.length / 3);
    for (let v = 0; v < vertexCluster.length; v++) {
      const ix = Math.min(resolution, Math.floor((positions[v * 3] - min[0]) / cell));
      const iy = Math.min(resolution, Math.floor((positions[v * 3 + 1] - min[1]) / cell));
      const iz = Math.min(resolution, Math.floor((positions[v * 3 + 2] - min[2]) / cell));
      const key = ix + (resolution + 1) * (iy + (resolution + 1) * iz);
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
        sums.push(0, 0, 0, 0);
      }
      sums[id * 4] += positions[v * 3];
      sums[id * 4 + 1] += positions[v * 3 + 1];
      sums[id * 4 + 2] += positions[v * 3 + 2];
      sums[id * 4 + 3] += 1;
      vertexCluster[v] = id;
    }
    const kept: number[] = [];
    for (let t = 0; t < triangles; t++) {
      const a = vertexCluster[t * 3];
      const b = vertexCluster[t * 3 + 1];
      const c = vertexCluster[t * 3 + 2];
      if (a !== b && b !== c && a !== c) kept.push(a, b, c);
    }
    const out = new Float32Array(kept.length * 3);
    for (let i = 0; i < kept.length; i++) {
      const id = kept[i];
      const n = sums[id * 4 + 3];
      out[i * 3] = sums[id * 4] / n;
      out[i * 3 + 1] = sums[id * 4 + 1] / n;
      out[i * 3 + 2] = sums[id * 4 + 2] / n;
    }
    result = out;
    const ratio = out.length / 9 / target;
    if (ratio <= 1.15) break;
    resolution = Math.max(16, Math.floor(resolution / Math.sqrt(ratio)));
  }
  return result;
}

/** Flache Normalen je Dreieck (statt computeVertexNormals im Hauptthread). */
export function flatNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i];
    const uy = positions[i + 4] - positions[i + 1];
    const uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i];
    const vy = positions[i + 7] - positions[i + 1];
    const vz = positions[i + 8] - positions[i + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let k = 0; k < 3; k++) {
      normals[i + k * 3] = nx;
      normals[i + k * 3 + 1] = ny;
      normals[i + k * 3 + 2] = nz;
    }
  }
  return normals;
}

/** Auf den Ursprung zentrieren (in place) und Maße liefern. */
export function centerPositions(positions: Float32Array): { x: number; y: number; z: number } {
  if (!positions.length) return { x: 0, y: 0, z: 0 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= center[0];
    positions[i + 1] -= center[1];
    positions[i + 2] -= center[2];
  }
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

/** Komplett: Datei-Bytes → anzeigefertige Geometrie. */
export function parseModel(bytes: Uint8Array, kind: ModelKind): ParsedModel {
  let positions: Float32Array;
  let meta: ThreeMfMeta | undefined;
  if (kind === 'stl') {
    positions = parseStl(bytes);
  } else {
    const parsed = parse3mf(bytes);
    positions = parsed.positions;
    meta = parsed.meta;
  }
  const sourceTriangles = positions.length / 9;
  if (!sourceTriangles) throw new Error('Keine Geometrie gefunden.');
  const size = centerPositions(positions);
  const simplified = sourceTriangles > SIMPLIFY_THRESHOLD;
  if (simplified) positions = simplifyPositions(positions);
  return {
    positions,
    normals: flatNormals(positions),
    triangles: positions.length / 9,
    sourceTriangles,
    simplified,
    size,
    meta,
  };
}
