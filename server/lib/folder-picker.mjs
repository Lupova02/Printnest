import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function cancelled() {
  return Object.assign(new Error('Ordnerauswahl abgebrochen.'), { status: 400, code: 'CANCELLED' });
}

/**
 * Ordnerdialog ohne Electron (Browser-Dev-Modus). In der App nutzt die UI
 * stattdessen `dialog.showOpenDialog` per IPC.
 */
export async function pickFolderNative() {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Printnest-Bibliothek wählen")',
      ]);
      return stdout.trim().replace(/\/+$/, '');
    } catch {
      throw cancelled();
    }
  }

  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "Printnest-Bibliothek wählen"',
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  Write-Output $dialog.SelectedPath',
      '} else {',
      '  exit 1',
      '}',
    ].join('; ');
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
      const selected = stdout.trim();
      if (!selected) throw new Error('empty');
      return selected;
    } catch {
      throw cancelled();
    }
  }

  try {
    const { stdout } = await execFileAsync('zenity', [
      '--file-selection',
      '--directory',
      '--title=Printnest-Bibliothek wählen',
    ]);
    return stdout.trim();
  } catch {
    throw Object.assign(
      new Error('Ordnerauswahl auf diesem System nicht verfügbar. Bitte den Pfad manuell eingeben.'),
      { status: 501 },
    );
  }
}

/** App-Auswahl ohne Electron (macOS, AppleScript); liefert den Pfad zur .app. */
export async function pickAppNative() {
  if (process.platform !== 'darwin') {
    throw Object.assign(new Error('App-Auswahl ist nur unter macOS verfügbar.'), { status: 501 });
  }
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'POSIX path of (choose file of type {"com.apple.application-bundle"} with prompt "Slicer-App wählen" default location (path to applications folder))',
    ]);
    return stdout.trim().replace(/\/+$/, '');
  } catch {
    throw Object.assign(new Error('App-Auswahl abgebrochen.'), { status: 400, code: 'CANCELLED' });
  }
}
