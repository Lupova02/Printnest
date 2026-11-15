import fs from 'node:fs';

const DEBOUNCE_MS = 350;
const HEARTBEAT_MS = 25000;

/** Server-Sent-Events-Verteiler für /api/events. */
export function createEventHub() {
  const clients = new Set();
  let heartbeat = null;

  function ensureHeartbeat() {
    if (heartbeat || clients.size === 0) return;
    heartbeat = setInterval(() => {
      for (const res of clients) res.write(': ping\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
  }

  return {
    get size() {
      return clients.size;
    },
    attach(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      ensureHeartbeat();
      req.on('close', () => {
        clients.delete(res);
        if (clients.size === 0 && heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      });
    },
    broadcast(event, data) {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) res.write(payload);
    },
    close() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}

function isRelevant(filename) {
  if (!filename) return true;
  const rel = String(filename).replaceAll('\\', '/');
  if (rel.endsWith('.tmp')) return false;
  const parts = rel.split('/');
  // Versteckte Pfade ignorieren – außer Links/Bewertungen im Root.
  return !parts.some((part, i) => {
    if (!part.startsWith('.')) return false;
    return !(i === 0 && parts.length === 1 && part.startsWith('.printnest-'));
  });
}

/**
 * Beobachtet die Bibliothek rekursiv (macOS: FSEvents) und meldet gebündelte Änderungen.
 */
export function createLibraryWatcher({ onChange, debounceMs = DEBOUNCE_MS }) {
  let watcher = null;
  let watchedRoot = null;
  let timer = null;
  let pending = new Set();

  function flush() {
    timer = null;
    const paths = [...pending].slice(0, 50);
    pending = new Set();
    onChange({ root: watchedRoot, paths });
  }

  return {
    get root() {
      return watchedRoot;
    },
    watch(root) {
      if (root === watchedRoot && watcher) return;
      this.close();
      watchedRoot = root;
      if (!root) return;
      try {
        watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
          if (!isRelevant(filename)) return;
          pending.add(filename ? String(filename) : '');
          if (timer) clearTimeout(timer);
          timer = setTimeout(flush, debounceMs);
        });
        watcher.on('error', () => this.close());
      } catch (error) {
        console.warn('Dateiüberwachung nicht verfügbar:', error.message || error);
        watcher = null;
      }
    },
    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      watcher?.close();
      watcher = null;
      watchedRoot = null;
    },
  };
}

export const __test__ = { isRelevant };
