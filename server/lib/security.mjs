import { timingSafeEqual } from 'node:crypto';

export const TOKEN_HEADER = 'x-printnest-token';

/** Diese Routen werden per <img>/<video>/<iframe>/EventSource geladen → Token als Query erlaubt. */
export const QUERY_TOKEN_PATHS = new Set([
  '/api/media',
  '/api/preview',
  '/api/download',
  '/api/thumb',
  '/api/link-image',
  '/api/events',
]);

const DEV_ORIGIN_PORTS = [4200];

export function tokensEqual(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Schutz der lokalen API:
 * - Host-Header muss 127.0.0.1/localhost:<port> sein (gegen DNS-Rebinding),
 * - ein vorhandener Origin muss die eigene App sein (im Dev-Modus zusätzlich `ng serve`),
 * - jede /api-Route außer /api/health braucht das Start-Token
 *   (Dev-Ausnahme nur, wenn `dev` gesetzt ist und kein festes Token konfiguriert wurde).
 */
export function createSecurityMiddleware({ token, getPort, dev = false, requireTokenInDev = false }) {
  return function security(req, res, next) {
    const port = getPort();
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    if (dev) {
      for (const devPort of DEV_ORIGIN_PORTS) {
        allowedHosts.add(`127.0.0.1:${devPort}`);
        allowedHosts.add(`localhost:${devPort}`);
        allowedOrigins.add(`http://127.0.0.1:${devPort}`);
        allowedOrigins.add(`http://localhost:${devPort}`);
      }
    }

    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: 'Unzulässiger Host.', code: 'FORBIDDEN_HOST' });
      return;
    }

    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !allowedOrigins.has(String(origin).toLowerCase())) {
      res.status(403).json({ error: 'Unzulässige Herkunft.', code: 'FORBIDDEN_ORIGIN' });
      return;
    }
    if (origin === 'null') {
      res.status(403).json({ error: 'Unzulässige Herkunft.', code: 'FORBIDDEN_ORIGIN' });
      return;
    }

    if (!req.path.startsWith('/api/') || req.path === '/api/health') {
      next();
      return;
    }
    if (dev && !requireTokenInDev) {
      next();
      return;
    }

    const headerToken = req.headers[TOKEN_HEADER];
    const queryToken = QUERY_TOKEN_PATHS.has(req.path) ? req.query?.token : undefined;
    const received = typeof headerToken === 'string' ? headerToken : queryToken;
    if (!tokensEqual(token, typeof received === 'string' ? received : '')) {
      res.status(401).json({ error: 'Nicht autorisiert.', code: 'UNAUTHORIZED' });
      return;
    }
    next();
  };
}
