import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SLICERS, createSlicerService } from '../lib/slicers.mjs';
import { startTestServer } from './helpers.mjs';

let t;
let appsDir;
let calls;

beforeAll(async () => {
  calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { stdout: '' };
  };
  // Ordner wird erst nach dem Start angelegt – Service liest ihn bei jeder Erkennung neu.
  appsDir = path.join(await fs.realpath((await import('node:os')).tmpdir()), `pn-apps-${Date.now()}`);
  t = await startTestServer({
    slicers: createSlicerService({ platform: 'darwin', appDirs: [appsDir], exec, useSpotlight: false }),
  });
  await fs.mkdir(path.join(appsDir, 'BambuStudio.app'), { recursive: true });
  await fs.mkdir(path.join(appsDir, 'Lychee Slicer.app'), { recursive: true });
  await t.write('Teile/halter.stl', 'solid x\nendsolid x\n');
  await t.write('Teile/halter.3mf', 'PK');
  await t.write('Teile/anleitung.pdf', '%PDF');
});

afterAll(async () => {
  await t.close();
  await fs.rm(appsDir, { recursive: true, force: true });
});

beforeEach(() => {
  calls.length = 0;
});

describe('Slicer-Liste und Erkennung', () => {
  it('kennt mindestens die 15 geforderten Slicer mit Dateitypen', () => {
    const names = SLICERS.map((s) => s.name);
    for (const n of ['Bambu Studio', 'OrcaSlicer', 'PrusaSlicer', 'UltiMaker Cura', 'Creality Print', 'ElegooSlicer', 'Anycubic Slicer Next', 'QIDI Studio', 'Snapmaker Orca', 'FlashForge Orca', 'FlashPrint', 'SuperSlicer', 'ideaMaker', 'Simplify3D', 'Lychee Slicer', 'CHITUBOX']) {
      expect(names).toContain(n);
    }
    const lychee = SLICERS.find((s) => s.id === 'lychee');
    expect(lychee.technology).toBe('resin');
    expect(lychee.extensions).not.toContain('.3mf');
    expect(SLICERS.every((s) => s.extensions.includes('.stl'))).toBe(true);
  });

  it('erkennt installierte Apps (installierte oben) und meldet nicht installierte', async () => {
    const res = await t.api('GET', '/api/slicers?refresh=1');
    expect(res.status).toBe(200);
    const { slicers, defaultSlicer, selected } = res.json;
    expect(slicers.length).toBeGreaterThanOrEqual(16);
    expect(slicers.slice(0, 2).map((s) => s.id).sort()).toEqual(['bambu', 'lychee']);
    expect(slicers.find((s) => s.id === 'orca').installed).toBe(false);
    expect(defaultSlicer).toBe('bambu');
    expect(selected.name).toBe('Bambu Studio');
  });
});

describe('Standard-Slicer', () => {
  it('Regression: „In Bambu Studio öffnen“ startet open -a mit der App', async () => {
    const res = await t.api('POST', '/api/open-in-slicer', { body: { path: 'Teile/halter.3mf' } });
    expect(res.status).toBe(200);
    expect(res.json.slicer).toBe('Bambu Studio');
    expect(calls).toEqual([['open', '-a', path.join(appsDir, 'BambuStudio.app'), path.join(t.lib, 'Teile/halter.3mf')]]);
  });

  it('speichert genau einen Standard-Slicer in config.json', async () => {
    expect((await t.api('PUT', '/api/settings', { body: { slicer: 'lychee' } })).status).toBe(200);
    const config = JSON.parse(await fs.readFile(path.join(t.dataDir, 'config.json'), 'utf8'));
    expect(config.settings.slicer).toBe('lychee');
    expect((await t.api('GET', '/api/slicers')).json.selected.id).toBe('lychee');
    expect((await t.api('PUT', '/api/settings', { body: { slicer: 'gibts-nicht' } })).status).toBe(400);
  });

  it('prüft die Dateitypen des gewählten Slicers (Resin: kein 3MF)', async () => {
    await t.api('PUT', '/api/settings', { body: { slicer: 'lychee' } });
    const bad = await t.api('POST', '/api/open-in-slicer', { body: { path: 'Teile/halter.3mf' } });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('UNSUPPORTED_TYPE');
    expect((await t.api('POST', '/api/open-in-slicer', { body: { path: 'Teile/halter.stl' } })).status).toBe(200);
    expect((await t.api('POST', '/api/open-in-slicer', { body: { path: 'Teile/anleitung.pdf' } })).status).toBe(400);
    await t.api('PUT', '/api/settings', { body: { slicer: 'bambu' } });
  });

  it('meldet einen gewählten, aber nicht installierten Slicer', async () => {
    await t.api('PUT', '/api/settings', { body: { slicer: 'orca' } });
    const res = await t.api('POST', '/api/open-in-slicer', { body: { path: 'Teile/halter.stl' } });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('SLICER_MISSING');
    await t.api('PUT', '/api/settings', { body: { slicer: 'bambu' } });
  });

  it('„Andere App wählen …“ fügt eine eigene App hinzu und macht sie zum Standard', async () => {
    const custom = path.join(appsDir, 'Mein Slicer.app');
    await fs.mkdir(custom);
    const res = await t.api('POST', '/api/slicers/custom', { body: { appPath: custom } });
    expect(res.status).toBe(201);
    expect(res.json.selected.name).toBe('Mein Slicer');
    expect(res.json.selected.custom).toBe(true);
    expect((await t.api('POST', '/api/open-in-slicer', { body: { path: 'Teile/halter.stl' } })).json.slicer).toBe('Mein Slicer');
    expect((await t.api('POST', '/api/slicers/custom', { body: { appPath: path.join(t.lib, 'Teile') } })).status).toBe(400);
    const removed = await t.api('DELETE', `/api/slicers/custom/${res.json.selected.id}`);
    expect(removed.json.defaultSlicer).toBeNull();
    await t.api('PUT', '/api/settings', { body: { slicer: 'bambu' } });
  });
});
