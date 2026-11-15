import fs from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { META_FILE } from '../lib/meta.mjs';
import { startTestServer } from './helpers.mjs';

let t;
const exists = (rel) => fs.access(path.join(t.lib, rel)).then(() => true, () => false);

beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

describe('Stapelumbenennung und Undo', () => {
  it('benennt mehrere Dateien in einem Schritt um und zieht Bewertungen mit', async () => {
    await t.write('B/benchy_final (1).stl');
    await t.write('B/halter__v2.stl');
    await t.api('PUT', '/api/meta', { body: { path: 'B/benchy_final (1).stl', rating: 5 } });
    const res = await t.api('POST', '/api/entries/batch', {
      body: { ops: [{ path: 'B/benchy_final (1).stl', name: 'Benchy.stl' }, { path: 'B/halter__v2.stl', name: 'Halter – V2.stl' }] },
    });
    expect(res.status).toBe(200);
    expect(res.json.results).toHaveLength(2);
    expect(await exists('B/Benchy.stl')).toBe(true);
    expect(await exists('B/Halter – V2.stl')).toBe(true);
    const meta = JSON.parse(await fs.readFile(path.join(t.lib, META_FILE), 'utf8'));
    expect(meta.entries['B/Benchy.stl'].rating).toBe(5);

    // Undo = Gegen-Stapel (wie der Client ihn aus den Ergebnissen baut).
    const inverse = res.json.results.map((r) => ({ path: r.to, name: r.from.split('/').pop() }));
    expect((await t.api('POST', '/api/entries/batch', { body: { ops: inverse } })).status).toBe(200);
    expect(await exists('B/benchy_final (1).stl')).toBe(true);
    expect(await exists('B/halter__v2.stl')).toBe(true);
    const meta2 = JSON.parse(await fs.readFile(path.join(t.lib, META_FILE), 'utf8'));
    expect(meta2.entries['B/benchy_final (1).stl'].rating).toBe(5);
  });

  it('tauscht Namen (zweiphasig) ohne Konflikt', async () => {
    await t.write('S/a.stl', 'A');
    await t.write('S/b.stl', 'B');
    const res = await t.api('POST', '/api/entries/batch', { body: { ops: [{ path: 'S/a.stl', name: 'b.stl' }, { path: 'S/b.stl', name: 'a.stl' }] } });
    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(t.lib, 'S/a.stl'), 'utf8')).toBe('B');
    expect(await fs.readFile(path.join(t.lib, 'S/b.stl'), 'utf8')).toBe('A');
  });

  it('meldet Konflikte mit Liste und ändert dann nichts (alles oder nichts)', async () => {
    await t.write('K/x.stl');
    await t.write('K/y.stl');
    await t.write('K/z.stl');
    const res = await t.api('POST', '/api/entries/batch', { body: { ops: [{ path: 'K/x.stl', name: 'neu.stl' }, { path: 'K/y.stl', name: 'z.stl' }] } });
    expect(res.status).toBe(409);
    expect(res.json.conflicts).toEqual([expect.objectContaining({ path: 'K/y.stl', target: 'K/z.stl' })]);
    expect(await exists('K/x.stl')).toBe(true);
    const dup = await t.api('POST', '/api/entries/batch', { body: { ops: [{ path: 'K/x.stl', name: 'Q.stl' }, { path: 'K/y.stl', name: 'q.stl' }] } });
    expect(dup.status).toBe(409);
    const dry = await t.api('POST', '/api/entries/batch', { body: { dryRun: true, ops: [{ path: 'K/x.stl', name: 'ok.stl' }] } });
    expect(dry.json.results).toEqual([{ from: 'K/x.stl', to: 'K/ok.stl' }]);
    expect(await exists('K/x.stl')).toBe(true);
  });

  it('verschiebt im Stapel und macht es rückgängig', async () => {
    await t.write('M/teil.stl');
    await fs.mkdir(path.join(t.lib, 'Ziel'), { recursive: true });
    const res = await t.api('POST', '/api/entries/batch', { body: { ops: [{ path: 'M/teil.stl', destination: 'Ziel' }] } });
    expect(res.json.results[0].to).toBe('Ziel/teil.stl');
    await t.api('POST', '/api/entries/batch', { body: { ops: [{ path: 'Ziel/teil.stl', destination: 'M' }] } });
    expect(await exists('M/teil.stl')).toBe(true);
  });
});

describe('Video und Medien', () => {
  it('Videos: nur Notiz, keine Sterne, kein Druckdatum', async () => {
    await t.write('V/clip.mp4', 'video');
    expect((await t.api('PUT', '/api/meta', { body: { path: 'V/clip.mp4', rating: 4 } })).status).toBe(400);
    expect((await t.api('PUT', '/api/meta', { body: { path: 'V/clip.mp4', printedAt: '2026-11-15' } })).status).toBe(400);
    const ok = await t.api('PUT', '/api/meta', { body: { path: 'V/clip.mp4', note: 'Timelapse' } });
    expect(ok.status).toBe(200);
    expect(ok.json.meta.note).toBe('Timelapse');
  });

  it('liefert Range-Requests (206) für flüssiges Spulen', async () => {
    await t.write('V/lang.mp4', '0123456789abcdef');
    const res = await fetch(`${t.base}/api/media?path=V/lang.mp4&token=test-token-123`, { headers: { Range: 'bytes=4-7' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-range')).toBe('bytes 4-7/16');
    expect(await res.text()).toBe('4567');
  });
});

describe('Namens-Assistent: 3MF-Metadaten und Lerndaten', () => {
  it('liest Titel, Designer und Plate-Namen aus 3MF', async () => {
    const zip = zipSync({
      '3D/3dmodel.model': strToU8('<model><metadata name="Title">Kabelhalter</metadata><metadata name="Designer">Ada</metadata><resources><object id="1" name="Basis"/></resources></model>'),
      'Metadata/model_settings.config': strToU8('<config><plate><metadata key="plater_name" value="Teil A"/></plate></config>'),
    });
    await t.write('N/druck_0.2mm.3mf', Buffer.from(zip));
    const res = await t.api('GET', `/api/model-meta?path=${encodeURIComponent('N/druck_0.2mm.3mf')}`);
    expect(res.json.meta).toMatchObject({ title: 'Kabelhalter', designer: 'Ada', plates: ['Teil A'] });
    expect(res.json.meta.objects).toContain('Basis');
  });

  it('speichert Ordner-Schema und Rückmeldungen lokal in userData', async () => {
    const schema = { fields: ['model', 'variant', 'material'], separator: ' – ' };
    await t.api('PUT', '/api/name-assist/schema', { body: { folder: 'N', schema } });
    expect((await t.api('PUT', '/api/name-assist/schema', { body: { folder: 'N', schema: { fields: ['x'], separator: '/' } } })).status).toBe(400);
    await t.api('POST', '/api/name-assist/feedback', { body: { source: 'clean', accepted: true, keep: ['final'] } });
    await t.api('POST', '/api/name-assist/feedback', { body: { source: 'clean', accepted: false, drop: ['tmp'] } });
    const data = (await t.api('GET', '/api/name-assist')).json;
    expect(data.schemas.N).toEqual(schema);
    expect(data.sources.clean).toEqual({ accepted: 1, rejected: 1 });
    expect(data.keep.final).toBe(1);
    expect(data.drop.tmp).toBe(1);
    const file = JSON.parse(await fs.readFile(path.join(t.dataDir, 'name-assist.json'), 'utf8'));
    expect(file.schemas.N.fields).toEqual(schema.fields);
  });
});
