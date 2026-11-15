import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, createContext } from '../app.mjs';
import { createSecurityMiddleware, tokensEqual } from '../lib/security.mjs';
import { META_FILE } from '../lib/meta.mjs';

const TOKEN = 'test-token-123';

let tmp;
let lib;
let server;
let base;
let trashed;

async function api(method, url, { body, headers = {}, raw } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      'X-Printnest-Token': TOKEN,
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keine JSON-Antwort
  }
  return { status: res.status, json, text };
}

async function write(rel, content = 'x') {
  const abs = path.join(lib, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pn-api-'));
  lib = path.join(tmp, 'lib');
  await fs.mkdir(lib);
  trashed = [];
  const ctx = createContext({
    dataDir: path.join(tmp, 'data'),
    seedLinksPath: null,
    // Papierkorb simulieren: Datei in eigenen Ordner verschieben.
    trash: async (abs) => {
      trashed.push(abs);
      await fs.rm(abs, { recursive: true });
    },
  });
  await fs.mkdir(path.join(tmp, 'data'));
  let port = 0;
  const app = createApp(ctx, { token: TOKEN, getPort: () => port });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('Token- und Herkunftsprüfung', () => {
  it('Health ohne Token, alles andere nur mit Token', async () => {
    expect((await api('GET', '/api/health', { headers: { 'X-Printnest-Token': '' } })).status).toBe(200);
    const res = await fetch(`${base}/api/library`);
    expect(res.status).toBe(401);
    expect((await api('GET', '/api/library', { headers: { 'X-Printnest-Token': 'falsch' } })).status).toBe(401);
    expect((await api('GET', '/api/library')).status).toBe(200);
  });

  it('Token per Query nur für Medienrouten', async () => {
    const lib1 = await fetch(`${base}/api/library?token=${TOKEN}`);
    expect(lib1.status).toBe(401);
    const media = await fetch(`${base}/api/media?path=x.stl&token=${TOKEN}`);
    expect(media.status).not.toBe(401);
  });

  it('fremde Origins werden abgewiesen', async () => {
    const res = await api('POST', '/api/folders', {
      body: { name: 'x' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('vergleicht Tokens zeitkonstant und typsicher', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
    expect(tokensEqual('abc', 'abd')).toBe(false);
    expect(tokensEqual('abc', 'abcd')).toBe(false);
    expect(tokensEqual('abc', undefined)).toBe(false);
  });

  it('prüft den Host-Header (DNS-Rebinding)', () => {
    const mw = createSecurityMiddleware({ token: TOKEN, getPort: () => 3847 });
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
    let passed = false;
    mw({ headers: { host: 'evil.example:3847' }, path: '/api/library', query: {} }, res, () => (passed = true));
    expect(passed).toBe(false);
    expect(res.code).toBe(403);
    mw({ headers: { host: '127.0.0.1:3847', 'x-printnest-token': TOKEN }, path: '/api/library', query: {} }, res, () => (passed = true));
    expect(passed).toBe(true);
  });

  it('Dev-Modus erlaubt Anfragen ohne Token, aber nicht von fremden Origins', () => {
    const mw = createSecurityMiddleware({ token: TOKEN, getPort: () => 3847, dev: true });
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
    let passed = false;
    mw({ headers: { host: '127.0.0.1:3847', origin: 'http://localhost:4200' }, path: '/api/library', query: {} }, res, () => (passed = true));
    expect(passed).toBe(true);
    passed = false;
    mw({ headers: { host: '127.0.0.1:3847', origin: 'https://evil.example' }, path: '/api/library', query: {} }, res, () => (passed = true));
    expect(passed).toBe(false);
  });
});

describe('Bibliothek', () => {
  beforeAll(async () => {
    const res = await api('PUT', '/api/library/path', { body: { path: lib } });
    expect(res.status).toBe(200);
  });

  beforeEach(async () => {
    for (const name of await fs.readdir(lib)) await fs.rm(path.join(lib, name), { recursive: true, force: true });
    trashed.length = 0;
  });

  it('unbekannte API-Routen liefern JSON-404', async () => {
    const res = await api('GET', '/api/gibt-es-nicht');
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('NOT_FOUND');
  });

  it('Listing überspringt kaputte Symlinks und versteckte Einträge', async () => {
    await write('Teile/würfel.stl');
    await write('.versteckt/geheim.stl');
    await fs.symlink(path.join(tmp, 'gibt-es-nicht'), path.join(lib, 'kaputt.stl'));
    const res = await api('GET', '/api/library');
    expect(res.status).toBe(200);
    expect(res.json.entries.map((e) => e.name)).toEqual(['Teile']);
    expect(res.json.entries[0].childCount).toBe(1);
  });

  it('Path-Traversal bleibt in der Bibliothek', async () => {
    const res = await api('GET', `/api/media?path=${encodeURIComponent('../../etc/hosts')}`);
    expect(res.status).toBe(404);
  });

  it('Index schließt versteckte Ordner auch bei Dateien aus', async () => {
    await write('a.stl');
    await write('.cache/b.stl');
    await write('Ordner/.intern/c.stl');
    const res = await api('GET', '/api/library/search?kind=stl');
    expect(res.json.entries.map((e) => e.relativePath)).toEqual(['a.stl']);
  });

  it('Umbenennen mit „..“ im Namen und Bewertung wandert mit', async () => {
    await write('Teile/würfel.stl');
    expect((await api('PUT', '/api/meta', { body: { path: 'Teile/würfel.stl', rating: 4, note: 'PLA' } })).status).toBe(200);
    const renamed = await api('PATCH', '/api/entries', { body: { path: 'Teile', name: 'Teile v1..2' } });
    expect(renamed.status).toBe(200);
    const meta = await api('GET', `/api/meta?path=${encodeURIComponent('Teile v1..2/würfel.stl')}`);
    expect(meta.json.meta).toMatchObject({ rating: 4, note: 'PLA' });
    const listing = await api('GET', `/api/library?path=${encodeURIComponent('Teile v1..2')}`);
    expect(listing.json.entries[0].rating).toBe(4);
  });

  it('Verschieben einer Datei zieht die Bewertung mit, Ordner nicht in sich selbst', async () => {
    await write('A/x.stl');
    await fs.mkdir(path.join(lib, 'B'));
    await api('PUT', '/api/meta', { body: { path: 'A/x.stl', rating: 5 } });
    expect((await api('PATCH', '/api/entries', { body: { path: 'A/x.stl', destination: 'B' } })).status).toBe(200);
    expect((await api('GET', '/api/meta?path=B/x.stl')).json.meta.rating).toBe(5);
    expect((await api('PATCH', '/api/entries', { body: { path: 'A', destination: 'A' } })).status).toBe(400);
  });

  it('Löschen nutzt den Papierkorb und entfernt Meta-Einträge', async () => {
    await write('Weg/teil.stl');
    await api('PUT', '/api/meta', { body: { path: 'Weg/teil.stl', rating: 2 } });
    const res = await api('DELETE', '/api/entries', { body: { path: 'Weg' } });
    expect(res.status).toBe(200);
    expect(res.json.trashed).toBe(true);
    expect(trashed).toEqual([path.join(lib, 'Weg')]);
    const meta = JSON.parse(await fs.readFile(path.join(lib, META_FILE), 'utf8'));
    expect(meta.entries).toEqual({});
  });

  it('Upload überschreibt nicht, sondern nummeriert', async () => {
    await write('teil.stl', 'alt');
    const form = new FormData();
    form.append('parent', '');
    form.append('files', new Blob(['neu1']), 'teil.stl');
    form.append('files', new Blob(['neu2']), 'teil.stl');
    form.append('files', new Blob(['ä']), 'Würfel.3mf');
    const res = await fetch(`${base}/api/files`, { method: 'POST', headers: { 'X-Printnest-Token': TOKEN }, body: form });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.files.map((f) => f.name).sort()).toEqual(['Würfel.3mf', 'teil (2).stl', 'teil (3).stl'].sort());
    expect(json.files.filter((f) => f.renamed)).toHaveLength(2);
    expect(await fs.readFile(path.join(lib, 'teil.stl'), 'utf8')).toBe('alt');
  });

  it('Upload lehnt unerlaubte Typen ab', async () => {
    const form = new FormData();
    form.append('parent', '');
    form.append('files', new Blob(['x']), 'virus.exe');
    const res = await fetch(`${base}/api/files`, { method: 'POST', headers: { 'X-Printnest-Token': TOKEN }, body: form });
    expect(res.status).toBe(400);
  });

  it('Import kopiert Ordner rekursiv, überspringt Typen und löst Konflikte', async () => {
    const src = path.join(tmp, 'finder');
    await fs.rm(src, { recursive: true, force: true });
    await fs.mkdir(path.join(src, 'Projekt', 'leer'), { recursive: true });
    await fs.writeFile(path.join(src, 'Projekt', 'a.stl'), 'a');
    await fs.writeFile(path.join(src, 'Projekt', 'notiz.txt'), 't');
    await fs.writeFile(path.join(src, 'teil.stl'), 'neu');
    await write('teil.stl', 'alt');

    const res = await api('POST', '/api/import', {
      body: { parent: '', paths: [path.join(src, 'Projekt'), path.join(src, 'teil.stl'), 'relativ/x.stl'] },
    });
    expect(res.status).toBe(201);
    expect(res.json.imported.map((i) => i.relativePath).sort()).toEqual(['Projekt', 'teil (2).stl']);
    expect(res.json.skipped.map((s) => s.name).sort()).toEqual(['leer', 'notiz.txt', 'relativ/x.stl']);
    expect(await fs.readFile(path.join(lib, 'Projekt', 'a.stl'), 'utf8')).toBe('a');
    expect(await fs.readFile(path.join(lib, 'teil.stl'), 'utf8')).toBe('alt');
  });

  it('Links: anlegen, bewerten, Ordner verschieben zieht mit, Löschen entfernt Bewertung', async () => {
    await fs.mkdir(path.join(lib, 'Quellen'));
    const created = await api('POST', '/api/links', {
      body: { name: 'Benchy', url: 'https://example.com/benchy', parent: 'Quellen' },
    });
    expect(created.status).toBe(201);
    const id = created.json.relativePath;
    expect((await api('PUT', '/api/meta', { body: { path: id, rating: 5 } })).status).toBe(200);
    await api('PATCH', '/api/entries', { body: { path: 'Quellen', name: 'Links' } });
    const listing = await api('GET', '/api/library?path=Links');
    expect(listing.json.entries.find((e) => e.id === id)?.rating).toBe(5);
    expect((await api('POST', '/api/links', { body: { name: 'x', url: 'javascript:alert(1)' } })).status).toBe(400);
    await api('DELETE', '/api/entries', { body: { path: id } });
    expect((await api('GET', `/api/meta?path=${id}`)).status).toBe(404);
  });

  it('Bewertete Einträge und Statistik', async () => {
    await write('a.stl');
    await write('b.3mf');
    await api('PUT', '/api/meta', { body: { path: 'a.stl', rating: 5 } });
    await api('PUT', '/api/meta', { body: { path: 'b.3mf', rating: 3 } });
    expect((await api('GET', '/api/library/rated?min=4')).json.entries.map((e) => e.name)).toEqual(['a.stl']);
    expect((await api('GET', '/api/library/stats')).json.counts).toMatchObject({ stl: 1, '3mf': 1, pdf: 0 });
    expect((await api('PUT', '/api/meta', { body: { path: 'a.stl', rating: 9 } })).status).toBe(400);
  });

  it('Thumbnails nur als PNG', async () => {
    await write('m.stl');
    expect((await api('GET', '/api/thumb?path=m.stl')).status).toBe(404);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const put = await api('PUT', '/api/thumb?path=m.stl', { raw: png, headers: { 'Content-Type': 'image/png' } });
    expect(put.status).toBe(204);
    expect((await api('GET', '/api/thumb?path=m.stl')).status).toBe(200);
    const bad = await api('PUT', '/api/thumb?path=m.stl', { raw: Buffer.from('nope-nope-nope'), headers: { 'Content-Type': 'image/png' } });
    expect(bad.status).toBe(400);
  });
});
