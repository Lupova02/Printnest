import electron from 'electron';

const { Menu, app, shell } = electron;

/**
 * Deutsche Menüleiste. Eigene Kürzel werden nur angezeigt (`registerAccelerator: false`)
 * und im Renderer behandelt – so funktionieren sie identisch im Browser-Dev-Modus und
 * stören Texteingaben nicht (z. B. ⌘⌫ im Suchfeld).
 */
export function buildApplicationMenu(send) {
  const item = (label, accelerator, action, extra = {}) => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(action),
    ...extra,
  });

  const template = [
    {
      label: app.name,
      submenu: [
        { label: 'Über Printnest', role: 'about' },
        { type: 'separator' },
        item('Einstellungen …', 'CmdOrCtrl+,', 'settings'),
        { type: 'separator' },
        { label: 'Dienste', role: 'services' },
        { type: 'separator' },
        { label: 'Printnest ausblenden', role: 'hide' },
        { label: 'Andere ausblenden', role: 'hideOthers' },
        { label: 'Alle einblenden', role: 'unhide' },
        { type: 'separator' },
        { label: 'Printnest beenden', role: 'quit' },
      ],
    },
    {
      label: 'Ablage',
      submenu: [
        item('Neuer Ordner', 'Shift+CmdOrCtrl+N', 'new-folder'),
        item('Link hinzufügen …', 'CmdOrCtrl+L', 'new-link'),
        item('Namens-Assistent …', 'Shift+CmdOrCtrl+A', 'name-assist'),
        item('Dateien importieren …', 'CmdOrCtrl+O', 'import'),
        { type: 'separator' },
        item('Im Finder zeigen', 'Alt+CmdOrCtrl+R', 'reveal'),
        item('Im Slicer öffnen', 'Shift+CmdOrCtrl+O', 'open-slicer'),
        { type: 'separator' },
        item('Bibliotheksordner wählen …', undefined, 'pick-library'),
        { type: 'separator' },
        { label: 'Fenster schließen', role: 'close' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { label: 'Widerrufen', role: 'undo' },
        { label: 'Wiederholen', role: 'redo' },
        { type: 'separator' },
        { label: 'Ausschneiden', role: 'cut' },
        { label: 'Kopieren', role: 'copy' },
        { label: 'Einsetzen', role: 'paste' },
        { label: 'Alles auswählen', role: 'selectAll' },
        { type: 'separator' },
        item('Umbenennen', 'Shift+Return', 'rename'),
        item('Stapelumbenennung …', 'Shift+CmdOrCtrl+R', 'batch-rename'),
        item('Verschieben …', undefined, 'move'),
        item('In den Papierkorb legen', 'CmdOrCtrl+Backspace', 'trash'),
        { type: 'separator' },
        item('Suchen', 'CmdOrCtrl+F', 'find'),
      ],
    },
    {
      label: 'Darstellung',
      submenu: [
        item('Als Liste', 'CmdOrCtrl+1', 'view-list'),
        item('Als Raster', 'CmdOrCtrl+2', 'view-grid'),
        { type: 'separator' },
        item('Neu laden', 'CmdOrCtrl+R', 'reload'),
        { type: 'separator' },
        { label: 'Vollbildmodus', role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ label: 'Entwicklerwerkzeuge', role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Fenster',
      role: 'windowMenu',
      submenu: [
        { label: 'Im Dock ablegen', role: 'minimize' },
        { label: 'Zoomen', role: 'zoom' },
        { type: 'separator' },
        { label: 'Alle nach vorne bringen', role: 'front' },
      ],
    },
    {
      label: 'Hilfe',
      role: 'help',
      submenu: [
        item('Tastaturkürzel', 'CmdOrCtrl+/', 'shortcuts'),
        {
          label: 'Printnest auf GitHub',
          click: () => void shell.openExternal('https://github.com/Lupova02/Printnest'),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
