import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, createContext } from './app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3847;

let running = null;

function listen(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

/**
 * Startet die lokale API (+ statische UI, falls `staticDir` gesetzt).
 *
 * Optionen: port, host, dataDir, staticDir, seedLinksPath, bootstrapConfigPath,
 * token (sonst zufällig), dev (Token-Ausnahme), trash/openExternal (Electron-Injektion),
 * portFallback (bei belegtem Port freien Port nehmen, Standard: true).
 */
export async function startServer(options = {}) {
  if (running) return { port: running.port, token: running.token, server: running.server };

  const dataDir = path.resolve(options.dataDir ?? process.env.PRINTNEST_DATA_DIR ?? __dirname);
  const staticDir = options.staticDir ?? process.env.PRINTNEST_STATIC_DIR ?? null;
  // `seedLinksPath: null` deaktiviert Seed-Links (Tests).
  const seedLinksPath =
    'seedLinksPath' in options
      ? options.seedLinksPath
      : (process.env.PRINTNEST_SEED_LINKS ?? path.join(__dirname, '../electron/seed-links.json'));
  const host = options.host || '127.0.0.1';
  const preferredPort = Number(options.port ?? process.env.PRINTNEST_API_PORT ?? DEFAULT_PORT);
  const fixedToken = options.token ?? process.env.PRINTNEST_TOKEN ?? null;
  const token = fixedToken || randomUUID();
  const dev = options.dev ?? process.env.NODE_ENV === 'development';

  await fs.mkdir(dataDir, { recursive: true });

  const ctx = createContext({
    dataDir,
    seedLinksPath: seedLinksPath ? path.resolve(seedLinksPath) : null,
    trash: options.trash,
    openExternal: options.openExternal,
    slicers: options.slicers,
  });
  await ctx.config.adoptBootstrap(options.bootstrapConfigPath);

  let port = preferredPort;
  const app = createApp(ctx, {
    token,
    getPort: () => port,
    dev,
    // Mit festem Token (PRINTNEST_TOKEN) wird es auch im Dev-Modus verlangt.
    requireTokenInDev: Boolean(fixedToken),
    staticDir: staticDir ? path.resolve(staticDir) : null,
  });

  let server;
  try {
    server = await listen(app, preferredPort, host);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || options.portFallback === false) throw error;
    console.warn(`Port ${preferredPort} belegt – weiche auf freien Port aus.`);
    server = await listen(app, 0, host);
  }
  port = server.address().port;

  const root = await ctx.config.getLibraryRoot();
  if (root) {
    await ctx.ensureSeeded(root).catch(() => {});
    ctx.watcher.watch(root);
  }

  running = { server, port, token, ctx };
  console.log(`Printnest API auf http://${host}:${port}${dev && !fixedToken ? ' (Dev-Modus ohne Token)' : ''}`);
  return { port, token, server, dataDir, staticDir };
}

export async function stopServer() {
  if (!running) return;
  const { server, ctx } = running;
  running = null;
  ctx.watcher.close();
  ctx.events.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(() => resolve()));
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer({ portFallback: false }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
