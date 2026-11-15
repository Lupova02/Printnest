import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';

const locks = new Map();

/** JSON lesen; fehlt die Datei, wird `fallback` geliefert. */
export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error(`Datei beschädigt: ${file}`), { status: 500 });
    }
    throw error;
  }
}

/** Atomar schreiben: temporäre Datei im selben Ordner + rename. */
export async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Lese-Ändere-Schreibe-Zyklen pro Datei serialisieren (keine verlorenen Updates). */
export function withFileLock(file, fn) {
  const previous = locks.get(file) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(file, tail);
  void tail.then(() => {
    if (locks.get(file) === tail) locks.delete(file);
  });
  return run;
}
