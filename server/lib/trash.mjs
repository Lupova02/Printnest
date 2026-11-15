import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Standard-Papierkorb ohne Electron. In der App wird stattdessen `shell.trashItem`
 * injiziert (siehe electron/main.mjs).
 */
export async function defaultTrash(absolutePath) {
  if (process.platform === 'darwin') {
    // Pfad als Argument übergeben – keine String-Interpolation ins AppleScript.
    await execFileAsync('osascript', [
      '-e',
      'on run argv',
      '-e',
      'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
      '-e',
      'end run',
      absolutePath,
    ]);
    return;
  }
  if (process.platform === 'linux') {
    await execFileAsync('gio', ['trash', absolutePath]);
    return;
  }
  throw Object.assign(new Error('Papierkorb ist auf diesem System nicht verfügbar.'), {
    status: 501,
  });
}
