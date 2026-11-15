# Changelog

## 0.3.0 – 2026-11-15

### Neu
- **App-Icon:** Druckdüse (Messing) mit leuchtendem Filamentstrang auf dem Druckbett, macOS-Squircle;
  auch bei 16–32 px klar erkennbar. Logo in der App ausgetauscht.
- **Quick Look wie im Finder:** Leertaste öffnet und schließt (auch bei Videos). Pfeiltasten blättern –
  Liste ↑/↓, Raster ←/→ und ↑/↓ zeilenweise; Ordner/Links werden übersprungen, Auswahl wandert sichtbar mit,
  Crossfade (140 ms, View Transition).
- **Video-Player:** Autoplay stumm, eigene Steuerleiste (Play/Pause, Scrubbing mit Zeitvorschau, Lautstärke,
  Tempo 0,5–2×, Vollbild), Tasten K/M/F und ⇧←/⇧→ (±5 s). Videos haben nur eine Notiz (Autosave), keine Sterne.
- **3D-Vorschau:** Parsen im Web Worker (STL binär/ASCII, 3MF inkl. Komponenten/Transformationen über fflate),
  Geometrie als Transferable, flache Normalen im Worker, Vereinfachung ab 1 Mio. Dreiecken, ein geteilter
  WebGLRenderer, Render-on-Demand, DPR ≤ 2, Fortschrittsanzeige, Abbruch beim Weiterblättern,
  Fallback bei verlorenem WebGL-Kontext.
- **F3D:** größtes eingebettetes Vorschaubild in nativer Auflösung (statt `small.png`).
- **Virtualisierte Liste/Raster:** nur Sichtbereich + Puffer im DOM; Thumbnail-Warteschlange (max. 3 parallel,
  sichtbare zuerst, Abbruch beim Wegscrollen), In-Memory-LRU vor dem Server-Cache.
- **Slicer-Auswahl:** 16 Slicer (Bambu Studio, OrcaSlicer, PrusaSlicer, UltiMaker Cura, Creality Print,
  ElegooSlicer, Anycubic Slicer Next, QIDI Studio, Snapmaker Orca, FlashForge Orca, FlashPrint, SuperSlicer,
  ideaMaker, Simplify3D, Lychee Slicer, CHITUBOX) mit Dateitypen je Slicer; „Andere App wählen …“.
  Überall erscheint nur der gewählte Standard-Slicer („In <Name> öffnen“, ⇧⌘O).
- **Farbprofile je Dateityp** (STL, 3MF, F3D, PDF, Video, Bilder, Links, Bewertung) in Hell und Dunkel,
  aus der Typfarbe in OKLCH abgeleitet; Ordneransicht bleibt Eisblau. Weiche Überblendung (250 ms).
- **Link-Assistent:** URL einfügen genügt – Titel, Beschreibung, Bild (OpenGraph/oEmbed), Portal-Erkennung
  (MakerWorld, Printables, Thingiverse, Cults3D, Thangs, MyMiniFactory, Creality Cloud, YouTube) inkl. Ersteller,
  Duplikaterkennung (normalisierte URL), „gehört zu …“, Einfügen aus der Zwischenablage auf Klick,
  URL per Drag & Drop, Links bearbeiten, Erreichbarkeit prüfen.
- **Namens-Assistent:** Bereinigung (Unterstriche, Versionen, „final“, „(1)“, IDs), Druckparameter als Tags
  (Material, Schichthöhe, Düse, Drucker, Druckzeit), 3MF-Metadaten (Titel, Designer, Plates), Ordner-Schemata,
  Geschwister-/Ordnerkontext, lernt lokal aus angenommenen/korrigierten Vorschlägen.
- **Stapelumbenennung** mit Vorher/Nachher-Diff, Konflikterkennung, alles-oder-nichts und **⌘Z** (Undo-Stack für
  Umbenennen/Verschieben). Mehrfachauswahl per ⌘-/⇧-Klick und ⇧-Pfeil.

### Sicherheit
- Link-Abrufe serverseitig mit SSRF-Schutz: nur http/https, keine privaten/lokalen Ziele (auch nicht per DNS
  oder Weiterleitung, Prüfung beim Verbindungsaufbau), Timeout 5 s, Größenlimits.

### Technik
- `/api/media` mit Range-Requests (206), pdf.js wird erst bei Bedarf geladen.
- Neue Server-Module: `batch.mjs`, `link-meta.mjs`, `model-meta.mjs`, `name-assist.mjs`; Slicer-Erkennung injizierbar.
- Tests: 65 Server-/Skript-Tests (inkl. Theme-Kontraste), 55 Komponententests, UI-Smoke-Test mit 54 Prüfungen
  inkl. Scroll-Messung (2 000 Dateien: 60 fps).

## 0.2.0 – 2026-11-15

### Neu
- Neues App-Icon (Nest mit gedrucktem Würfel) als SVG-Quelle; Build-Skript erzeugt icns/png/ico.
- Mac-Oberfläche: Seitenleiste (Ordner, Typfilter mit Anzahl, Gut bewertet, Zuletzt geändert), Toolbar mit
  Breadcrumbs, Suche, Bewertungsfilter, Sortierung, Liste/Raster; Vibrancy, versteckte Titelleiste, Hell/Dunkel.
- Rasteransicht mit Vorschaubildern (STL/3MF gerendert und gecacht, PDF, F3D, Bilder, Video), Lazy-Loading.
- Druck-Bewertung 1–5 Sterne, Notiz und Druckdatum (`.printnest-meta.json`), Filter und Sortierung nach Bewertung.
- Quick-Look-Vorschau mit Blättern, 3D-Orbit/Zoom/Reset/Drahtgitter, Maßen und Dreiecksanzahl.
- Im Slicer öffnen (Bambu Studio, OrcaSlicer), Standard-Slicer in den Einstellungen.
- Deutsche Menüleiste, Kontextmenü, umfassende Tastaturbedienung, Tastaturkürzel-Übersicht.
- Drag & Drop aus dem Finder (Dateien und Ordner, serverseitiges Kopieren) und innerhalb der App.
- Live-Aktualisierung über `fs.watch` + Server-Sent Events statt Polling.
- Fensterzustand und UI-Zustand (letzter Ordner, Ansicht, Sortierung) werden gemerkt.
- Toasts, Skeleton-Loader, leere Zustände mit Illustration, View Transitions, `prefers-reduced-motion`.

### Sicherheit
- API-Schutz per Start-Token, Host-/Origin-Prüfung; `cors({ origin: true })` entfernt.
- Löschen verschiebt in den Papierkorb statt endgültig zu löschen.
- Electron: IPC nur vom eigenen Origin, Navigation/Popups nur intern bzw. im Standardbrowser.
- Paket enthält keine Tests, keine `server/config.json` und keine Bootstrap-Config mehr.

### Behoben
- Upload überschrieb gleichnamige Dateien → jetzt „Name (2).ext“ mit Meldung.
- Umlaute in hochgeladenen Dateinamen wurden zerstört (multer latin1).
- Kaputte Symlinks/gesperrte Dateien brachen das Listing ab.
- Index enthielt Dateien aus versteckten Ordnern; Index scheiterte, wenn der Root selbst in einem versteckten Ordner lag.
- `isSafeName` lehnte Namen wie `v1..2.stl` ab und erlaubte `:`.
- Unbekannte `/api`-Routen lieferten HTML statt JSON-404; Fehlerbehandlung jetzt nach Static/SPA-Fallback.
- Belegter Port 3847 beendete die App still → freier Port + nativer Fehlerdialog.
- Zweiter App-Start öffnete eine zweite Instanz → Single-Instance-Lock.
- Ein WebGL-Kontext pro STL-Zeile überschritt das Browser-Limit → ein gemeinsamer Thumbnail-Renderer.
- Externe Google-Fonts entfernt (Systemschrift, offline-fähig).

### Technik
- `server/index.mjs` aufgeteilt in `server/app.mjs`, `server/lib/*`, `server/routes/*`.
- `dashboard.ts` aufgeteilt in `LibraryStore` (Signals) und kleine Komponenten.
- Electron 37 → 45.3.2, electron-builder 26.18.0; Ad-hoc-Signatur.
- Tests: 34 Server-Tests (Vitest), 17 Komponententests, Electron-UI-Smoke-Test mit 25 Prüfungen.
