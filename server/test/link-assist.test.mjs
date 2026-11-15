import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanTitle,
  createSafeLookup,
  detectPortal,
  isPrivateAddress,
  normalizeUrl,
  parseHtmlMeta,
  safeFetch,
} from '../lib/link-meta.mjs';
import { startTestServer } from './helpers.mjs';

describe('URL-Normalisierung und Duplikate', () => {
  it('entfernt Tracking-Parameter, www, Fragment und Schrägstrich', () => {
    const a = normalizeUrl('https://www.printables.com/model/3161-benchy/?utm_source=x&fbclid=abc#comments');
    const b = normalizeUrl('http://printables.com/model/3161-benchy');
    expect(a).toBe('https://printables.com/model/3161-benchy');
    expect(a).toBe(b);
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe('https://example.com/a?a=1&b=2');
    expect(normalizeUrl('https://youtu.be/abc123?si=xyz')).toBe(normalizeUrl('https://www.youtube.com/watch?v=abc123'));
    expect(normalizeUrl('ftp://example.com')).toBeNull();
  });
});

describe('3D-Portale', () => {
  it('erkennt Portale und liest Modellname/Ersteller aus der URL', () => {
    expect(detectPortal('https://makerworld.com/de/models/123456-cable-clip-set')).toMatchObject({ id: 'makerworld', label: 'MakerWorld', title: 'Cable Clip Set', modelId: '123456' });
    expect(detectPortal('https://www.printables.com/model/3161-3d-benchy')).toMatchObject({ id: 'printables', title: 'Benchy' });
    expect(detectPortal('https://www.thingiverse.com/thing:763622')).toMatchObject({ id: 'thingiverse', modelId: '763622' });
    expect(detectPortal('https://cults3d.com/de/3d-model/haus/vase-mode-lamp')).toMatchObject({ id: 'cults3d', title: 'Vase Mode Lamp' });
    expect(detectPortal('https://thangs.com/designer/Maker%20Joe/3d-model/gear-box-12345')).toMatchObject({ id: 'thangs', creator: 'Maker Joe', title: 'Gear Box', modelId: '12345' });
    expect(detectPortal('https://www.myminifactory.com/object/3d-print-dragon-bust-98765')).toMatchObject({ id: 'myminifactory', title: 'Dragon Bust' });
    expect(detectPortal('https://www.crealitycloud.com/model-detail/phone-stand')).toMatchObject({ id: 'crealitycloud', title: 'Phone Stand' });
    expect(detectPortal('https://youtu.be/abc')).toMatchObject({ id: 'youtube' });
    expect(detectPortal('https://example.com/x')).toBeNull();
  });

  it('liest OpenGraph und bereinigt Portal-Titel', () => {
    const meta = parseHtmlMeta(
      '<html><head><title>Fallback</title><meta property="og:title" content="Benchy &amp; Co | Printables.com"><meta property="og:image" content="/img/b.jpg"><meta name="description" content="Kalibrierboot"></head></html>',
      'https://www.printables.com/model/1',
    );
    expect(meta.image).toBe('https://www.printables.com/img/b.jpg');
    expect(meta.description).toBe('Kalibrierboot');
    expect(cleanTitle(meta.title, { id: 'printables' }).title).toBe('Benchy & Co');
    expect(cleanTitle('Gear Box by Maker Joe - Thingiverse', { id: 'thingiverse' })).toEqual({ title: 'Gear Box', creator: 'Maker Joe' });
  });
});

describe('SSRF-Schutz', () => {
  it('erkennt private, lokale und reservierte Adressen', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('verweigert Ziele, deren DNS auf private Adressen zeigt', async () => {
    const lookup = createSafeLookup((_host, _opts, cb) => cb(null, [{ address: '192.168.0.5', family: 4 }]));
    await expect(safeFetch('http://drucker.example.com/', { lookup })).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(safeFetch('http://127.0.0.1:9/')).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(safeFetch('http://localhost/')).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow();
  });

  it('folgt keiner Weiterleitung ins private Netz und hält Größenlimit/Timeout ein', async () => {
    // Öffentlicher Name → Test-Server (DNS gefälscht auf öffentliche IP, Verbindung aber lokal).
    const server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'http://127.0.0.1/geheim' });
        res.end();
      } else if (req.url === '/gross') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('x'.repeat(5000));
      } else {
        setTimeout(() => res.end('spät'), 2000);
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    // Resolver liefert öffentliche Adresse; tatsächliche Verbindung geht per Lookup-Override an 127.0.0.1.
    const lookup = (host, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (host === '127.0.0.1') return callback(Object.assign(new Error('blocked'), { code: 'BLOCKED_ADDRESS' }));
      return opts?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4);
    };
    try {
      await expect(safeFetch(`http://public.example:${port}/redirect`, { lookup })).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
      const big = await safeFetch(`http://public.example:${port}/gross`, { lookup, maxBytes: 1000 });
      expect(big.body.length).toBe(1000);
      expect(big.truncated).toBe(true);
      await expect(safeFetch(`http://public.example:${port}/langsam`, { lookup, timeoutMs: 200 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('Link-API', () => {
  let t;
  beforeAll(async () => {
    t = await startTestServer();
    await t.write('Projekte/benchy-boot.stl', 'solid x');
  });
  afterAll(() => t.close());

  it('Vorschau auf lokale Adressen wird blockiert', async () => {
    const res = await t.api('GET', `/api/link-preview?url=${encodeURIComponent(`http://127.0.0.1:${t.port}/api/health`)}`);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('BLOCKED_ADDRESS');
  });

  it('erkennt Duplikate (normalisiert) und speichert nur mit Bestätigung', async () => {
    const first = await t.api('POST', '/api/links', {
      body: { name: 'Benchy', url: 'https://www.printables.com/model/3161-benchy?utm_source=x', parent: 'Projekte', meta: { portal: 'printables', portalLabel: 'Printables', creator: 'CreativeTools', image: 'javascript:alert(1)' } },
    });
    expect(first.status).toBe(201);
    expect(first.json.url).toBe('https://www.printables.com/model/3161-benchy');
    expect(first.json.linkMeta).toMatchObject({ portalLabel: 'Printables', creator: 'CreativeTools', hasImage: false });

    const dup = await t.api('POST', '/api/links', { body: { name: 'Nochmal', url: 'http://printables.com/model/3161-benchy/#x', parent: '' } });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe('DUPLICATE_LINK');
    expect(dup.json.duplicates[0]).toMatchObject({ name: 'Benchy', parentPath: 'Projekte' });

    const forced = await t.api('POST', '/api/links', { body: { name: 'Nochmal', url: 'http://printables.com/model/3161-benchy', parent: '', allowDuplicate: true } });
    expect(forced.status).toBe(201);
  });

  it('Links lassen sich bearbeiten (Name und URL)', async () => {
    const created = await t.api('POST', '/api/links', { body: { name: 'Alt', url: 'https://example.org/a', parent: '' } });
    const res = await t.api('PATCH', '/api/entries', { body: { path: created.json.relativePath, name: 'Neu', url: 'https://example.org/b?fbclid=1' } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: 'Neu', url: 'https://example.org/b' });
    expect((await t.api('PATCH', '/api/entries', { body: { path: created.json.relativePath, url: 'javascript:alert(1)' } })).status).toBe(400);
  });

  it('Status-Prüfung meldet private Ziele als „blocked“ und speichert das Ergebnis', async () => {
    const created = await t.api('POST', '/api/links', { body: { name: 'Drucker', url: 'http://192.168.1.50/', parent: '' } });
    const res = await t.api('POST', '/api/links/status', { body: { path: created.json.relativePath } });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('blocked');
    expect(res.json.entry.linkMeta.status).toBe('blocked');
  });
});
