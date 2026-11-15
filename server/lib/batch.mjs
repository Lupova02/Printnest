import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isLinkPath, linkIdFromPath, remapLinksForMovedFolder, updateLinks } from './links.mjs';
import { remapMetaKeys, updateMeta } from './meta.mjs';
import { isSafeName, resolveInsideRoot, resolveRelative, safeStat, toRelative } from './paths.mjs';

export const BATCH_MAX = 500;

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

/**
 * Mehrere Umbenennungen/Verschiebungen planen und prüfen – ohne etwas zu ändern.
 * `ops`: [{ path, name?, destination? }]. Liefert Schritte oder wirft 409 mit `conflicts`.
 * Konflikte: doppelte Ziele innerhalb des Stapels und bestehende Einträge, die nicht selbst
 * Teil des Stapels sind (Tauschen von Namen ist damit erlaubt). Vergleich ohne Groß-/Kleinschreibung.
 */
export async function planBatch(root, ops) {
  if (!Array.isArray(ops) || !ops.length) throw httpError(400, 'Keine Änderungen übergeben.');
  if (ops.length > BATCH_MAX) throw httpError(400, `Höchstens ${BATCH_MAX} Einträge auf einmal.`);

  const steps = [];
  const links = [];
  for (const op of ops) {
    const fromRel = String(op?.path || '');
    const hasName = op && Object.hasOwn(op, 'name');
    const hasDest = op && Object.hasOwn(op, 'destination');
    const name = hasName ? String(op.name ?? '').trim() : null;
    if (!fromRel || (!hasName && !hasDest)) throw httpError(400, 'Ungültige Änderung im Stapel.');
    if (hasName && !isSafeName(name)) throw httpError(400, `Ungültiger Name: „${name}“.`);

    let destParts = null;
    if (hasDest) {
      const dest = resolveRelative(root, String(op.destination ?? ''));
      const st = await safeStat(dest.absolutePath);
      if (!st?.isDirectory()) throw httpError(404, 'Zielordner nicht gefunden.');
      destParts = dest.parts;
    }

    if (isLinkPath(fromRel)) {
      links.push({ id: linkIdFromPath(fromRel), from: fromRel, name, destination: destParts ? toRelative(destParts) : null });
      continue;
    }

    const { parts, absolutePath } = resolveRelative(root, fromRel);
    if (!parts.length) throw httpError(400, 'Die Bibliothekswurzel kann nicht geändert werden.');
    const st = await safeStat(absolutePath);
    if (!st) throw httpError(404, `Nicht gefunden: ${fromRel}`);
    const parentParts = destParts ?? parts.slice(0, -1);
    const finalName = name ?? parts[parts.length - 1];
    const from = toRelative(parts);
    const to = toRelative([...parentParts, finalName]);
    if (st.isDirectory() && to.startsWith(`${from}/`)) {
      throw httpError(400, 'Ein Ordner kann nicht in sich selbst verschoben werden.');
    }
    steps.push({
      from,
      to,
      fromAbs: absolutePath,
      toAbs: resolveInsideRoot(root, [...parentParts, finalName]),
      isDir: st.isDirectory(),
    });
  }

  const conflicts = [];
  const sources = new Set(steps.map((s) => s.fromAbs.toLowerCase()));
  const seen = new Map();
  for (const step of steps) {
    const key = step.toAbs.toLowerCase();
    if (seen.has(key)) conflicts.push({ path: step.from, target: step.to, reason: 'Gleicher Zielname wie ein anderer Eintrag im Stapel.' });
    seen.set(key, step);
    if (key !== step.fromAbs.toLowerCase() && !sources.has(key) && (await safeStat(step.toAbs))) {
      conflicts.push({ path: step.from, target: step.to, reason: 'Ein Eintrag mit diesem Namen existiert bereits.' });
    }
  }
  if (conflicts.length) throw httpError(409, 'Namenskonflikt im Stapel.', { code: 'CONFLICT', conflicts });
  return { steps: steps.filter((s) => s.fromAbs !== s.toAbs), links };
}

/**
 * Geplanten Stapel ausführen: zweiphasig (erst temporäre Namen, dann Zielnamen), damit auch
 * Tauschen/Kreisläufe funktionieren. Bei einem Fehler werden alle Schritte zurückgerollt.
 * Bewertungen/Notizen und Link-Ordner werden ebenfalls zweiphasig mitgezogen.
 */
export async function executeBatch(root, plan) {
  const { steps, links } = plan;
  const token = randomUUID().slice(0, 8);
  const temp = steps.map((step, i) => ({
    ...step,
    tmpAbs: path.join(path.dirname(step.fromAbs), `.printnest-tmp-${token}-${i}`),
    tmpRel: `.printnest-tmp-${token}-${i}`,
  }));
  const done = [];
  try {
    for (const step of temp) {
      await fs.rename(step.fromAbs, step.tmpAbs);
      done.push({ step, phase: 1 });
    }
    for (const step of temp) {
      await fs.mkdir(path.dirname(step.toAbs), { recursive: true });
      await fs.rename(step.tmpAbs, step.toAbs);
      done.push({ step, phase: 2 });
    }
  } catch (error) {
    // Rückwärts zurückrollen: Phase 2 → temp, Phase 1 → Original.
    for (const { step, phase } of done.reverse()) {
      try {
        if (phase === 2) await fs.rename(step.toAbs, step.tmpAbs);
        else await fs.rename(step.tmpAbs, step.fromAbs);
      } catch {
        // bestmöglich
      }
    }
    throw Object.assign(error, { status: error.status ?? 500 });
  }

  if (temp.length) {
    await updateMeta(root, (meta) => {
      let changed = false;
      for (const s of temp) changed = remapMetaKeys(meta, s.from, `\u0000${s.tmpRel}`) || changed;
      for (const s of temp) changed = remapMetaKeys(meta, `\u0000${s.tmpRel}`, s.to) || changed;
      return changed;
    });
    const folders = temp.filter((s) => s.isDir);
    if (folders.length) {
      await updateLinks(root, (list) => {
        let changed = false;
        for (const s of folders) changed = remapLinksForMovedFolder(list, s.from, `\u0000${s.tmpRel}`) || changed;
        for (const s of folders) changed = remapLinksForMovedFolder(list, `\u0000${s.tmpRel}`, s.to) || changed;
        return { changed };
      });
    }
  }

  if (links.length) {
    await updateLinks(root, (list) => {
      const now = new Date().toISOString();
      for (const op of links) {
        const link = list.find((l) => l.id === op.id);
        if (!link) continue;
        if (op.name) link.name = op.name;
        if (op.destination !== null) link.parentPath = op.destination;
        link.updatedAt = now;
      }
      return { changed: true };
    });
  }

  return [
    ...steps.map((s) => ({ from: s.from, to: s.to, name: path.basename(s.toAbs) })),
    ...links.map((l) => ({ from: l.from, to: l.from, name: l.name })),
  ];
}
