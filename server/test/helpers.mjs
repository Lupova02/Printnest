import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, createContext } from '../app.mjs';

export const TOKEN = 'test-token-123';

/** Test-Server mit temporärer Bibliothek; `contextOptions` überschreibt Kontext-Teile (z. B. slicers). */
export async function startTestServer(contextOptions = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pn-test-'));
  const lib = path.join(tmp, 'lib');
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(lib);
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ libraryRoot: lib }));
  const ctx = createContext({ dataDir, seedLinksPath: null, trash: (abs) => fs.rm(abs, { recursive: true }), ...contextOptions });
  let port = 0;
  const app = createApp(ctx, { token: TOKEN, getPort: () => port });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function api(method, url, { body, headers = {} } = {}) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'X-Printnest-Token': TOKEN, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // keine JSON-Antwort
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  async function write(rel, content = 'x') {
    const abs = path.join(lib, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  async function close() {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  }

  return { ctx, api, write, close, lib, dataDir, base, port, tmp };
}
