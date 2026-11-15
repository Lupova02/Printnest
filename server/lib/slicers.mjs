import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CACHE_MS = 60 * 1000;

const FDM = ['.stl', '.3mf', '.obj', '.step', '.stp', '.amf'];
const FDM_NO_STEP = ['.stl', '.3mf', '.obj'];
const RESIN = ['.stl', '.obj'];

/**
 * Bekannte Slicer für macOS.
 * - `appNames`: übliche Namen in /Applications bzw. ~/Applications (primäre Erkennung),
 * - `bundleIds`: für `mdfind`; `verified` = Bundle-ID über Homebrew-Cask-Daten belegt
 *   (zap-/quit-Pfade), sonst nur App-Name bekannt,
 * - `extensions`: Dateitypen, die der Slicer öffnen kann (Resin-Slicer z. B. nur STL/OBJ).
 */
export const SLICERS = [
  { id: 'bambu', name: 'Bambu Studio', appNames: ['BambuStudio.app', 'Bambu Studio.app'], bundleIds: ['com.bambulab.bambu-studio'], verified: true, technology: 'fdm', extensions: FDM },
  { id: 'orca', name: 'OrcaSlicer', appNames: ['OrcaSlicer.app'], bundleIds: ['com.softfever3d.orca-slicer', 'com.orcaslicer.OrcaSlicer'], verified: true, technology: 'fdm', extensions: FDM },
  { id: 'prusa', name: 'PrusaSlicer', appNames: ['PrusaSlicer.app', 'Original Prusa Drivers/PrusaSlicer.app'], bundleIds: ['com.prusa3d.slic3r/', 'com.prusa3d.slic3r'], verified: true, technology: 'fdm', extensions: FDM },
  { id: 'cura', name: 'UltiMaker Cura', appNames: ['UltiMaker Cura.app', 'Ultimaker Cura.app'], bundleIds: ['nl.ultimaker.cura'], verified: true, technology: 'fdm', extensions: FDM_NO_STEP },
  { id: 'creality', name: 'Creality Print', appNames: ['Creality Print.app', 'CrealityPrint.app'], bundleIds: ['com.creality.crealityprint'], verified: true, technology: 'fdm', extensions: FDM },
  { id: 'elegoo', name: 'ElegooSlicer', appNames: ['ElegooSlicer.app', 'Elegoo Slicer.app'], bundleIds: ['com.elegoo3d.elegoo-slicer', 'com.elegootechsupport.elegoo-slicer'], verified: true, technology: 'fdm', extensions: FDM },
  { id: 'anycubic', name: 'Anycubic Slicer Next', appNames: ['AnycubicSlicerNext.app', 'Anycubic Slicer Next.app'], bundleIds: [], verified: false, technology: 'fdm', extensions: FDM },
  { id: 'qidi', name: 'QIDI Studio', appNames: ['QIDIStudio.app', 'QIDI Studio.app'], bundleIds: [], verified: false, technology: 'fdm', extensions: FDM },
  { id: 'snapmaker-orca', name: 'Snapmaker Orca', appNames: ['Snapmaker Orca.app', 'Snapmaker_Orca.app'], bundleIds: ['com.snapmaker.snapmaker-orca'], verified: true, technology: 'fdm', extensions: FDM },
  { id: 'flashforge-orca', name: 'FlashForge Orca', appNames: ['Orca-Flashforge.app', 'OrcaSlicer-Flashforge.app', 'Flashforge Orca.app'], bundleIds: [], verified: false, technology: 'fdm', extensions: FDM },
  { id: 'flashprint', name: 'FlashPrint', appNames: ['FlashPrint 5.app', 'FlashPrint.app'], bundleIds: [], verified: false, technology: 'fdm', extensions: FDM_NO_STEP },
  { id: 'superslicer', name: 'SuperSlicer', appNames: ['SuperSlicer.app'], bundleIds: [], verified: false, technology: 'fdm', extensions: FDM },
  { id: 'ideamaker', name: 'ideaMaker', appNames: ['ideaMaker.app'], bundleIds: ['com.raise3d.ideaMaker'], verified: true, technology: 'fdm', extensions: FDM_NO_STEP },
  { id: 'simplify3d', name: 'Simplify3D', appNames: ['Simplify3D.app', 'Simplify3D 5.app'], bundleIds: [], verified: false, technology: 'fdm', extensions: FDM_NO_STEP },
  { id: 'lychee', name: 'Lychee Slicer', appNames: ['Lychee Slicer.app', 'LycheeSlicer.app'], bundleIds: [], verified: false, technology: 'resin', extensions: RESIN },
  { id: 'chitubox', name: 'CHITUBOX', appNames: ['CHITUBOX.app', 'CHITUBOX Basic.app', 'CHITUBOX Pro.app'], bundleIds: [], verified: false, technology: 'resin', extensions: RESIN },
];

/** Dateitypen, die überhaupt ein Slicer öffnen kann (Vereinigung). */
export const SLICER_EXTENSIONS = new Set(SLICERS.flatMap((s) => s.extensions));

/** Standard-Dateitypen für selbst gewählte Apps. */
export const CUSTOM_SLICER_EXTENSIONS = FDM;

export function customSlicerId(appPath) {
  return `custom-${createHash('sha1').update(appPath).digest('hex').slice(0, 10)}`;
}

/** Eigene App aus Einstellungen prüfen und normalisieren (null = ungültig). */
export function normalizeCustomSlicer(raw) {
  if (!raw || typeof raw.appPath !== 'string') return null;
  const appPath = path.resolve(raw.appPath.trim());
  if (!appPath.toLowerCase().endsWith('.app')) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : path.basename(appPath, '.app');
  return { id: customSlicerId(appPath), name, appPath, extensions: CUSTOM_SLICER_EXTENSIONS, technology: 'custom', custom: true };
}

async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Erkennung installierter Slicer und Öffnen von Dateien. Systemzugriffe (Ordner, `mdfind`,
 * `open`) sind injizierbar, damit Tests ohne echte Apps laufen.
 */
export function createSlicerService({
  platform = process.platform,
  appDirs = ['/Applications', path.join(os.homedir(), 'Applications')],
  exec = (cmd, args, options) => execFileAsync(cmd, args, options),
  useSpotlight = true,
} = {}) {
  let cache = null;

  async function mdfind(query) {
    try {
      const { stdout } = await exec('mdfind', [query], { timeout: 3000 });
      return String(stdout)
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.endsWith('.app') && !l.startsWith('/Volumes/')) ?? null;
    } catch {
      return null;
    }
  }

  async function findApp(slicer) {
    for (const dir of appDirs) {
      for (const name of slicer.appNames) {
        const candidate = path.join(dir, name);
        if (await isDir(candidate)) return candidate;
      }
    }
    if (!useSpotlight) return null;
    for (const id of slicer.bundleIds) {
      const hit = await mdfind(`kMDItemCFBundleIdentifier == '${id.replaceAll("'", '')}'`);
      if (hit) return hit;
    }
    for (const name of slicer.appNames) {
      const hit = await mdfind(`kMDItemFSName == '${path.basename(name).replaceAll("'", '')}'`);
      if (hit) return hit;
    }
    return null;
  }

  /** Alle bekannten Slicer mit Installationsstatus (60 s gecacht). */
  async function detect({ force = false } = {}) {
    if (platform !== 'darwin') return SLICERS.map((s) => ({ ...s, installed: false, appPath: null }));
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.list;
    const list = await Promise.all(
      SLICERS.map(async (s) => {
        const appPath = await findApp(s);
        return { ...s, installed: !!appPath, appPath };
      }),
    );
    cache = { at: Date.now(), list };
    return list;
  }

  /** Bekannte + eigene Slicer, installierte zuerst. */
  async function list(settings, options) {
    const known = await detect(options);
    const custom = await Promise.all(
      (settings.customSlicers ?? []).map(normalizeCustomSlicer).filter(Boolean).map(async (s) => ({ ...s, installed: await isDir(s.appPath) })),
    );
    return [...known, ...custom].sort((a, b) => Number(b.installed) - Number(a.installed));
  }

  /** Datei im (gewählten) Slicer öffnen. */
  async function open(slicerId, absolutePath, settings) {
    const all = await list(settings);
    const slicer = all.find((s) => s.id === slicerId);
    if (!slicer) {
      throw Object.assign(new Error('Kein Slicer gewählt. Bitte in den Einstellungen festlegen.'), { status: 400, code: 'NO_SLICER' });
    }
    if (!slicer.installed || !slicer.appPath) {
      throw Object.assign(new Error(`${slicer.name} ist nicht installiert.`), { status: 404, code: 'SLICER_MISSING' });
    }
    const ext = path.extname(absolutePath).toLowerCase();
    if (!slicer.extensions.includes(ext)) {
      throw Object.assign(new Error(`${slicer.name} kann ${ext || 'diesen Dateityp'} nicht öffnen.`), { status: 400, code: 'UNSUPPORTED_TYPE' });
    }
    await exec('open', ['-a', slicer.appPath, absolutePath]);
    return slicer;
  }

  return { detect, list, open, invalidate: () => (cache = null) };
}
