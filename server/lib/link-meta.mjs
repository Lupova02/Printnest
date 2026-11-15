import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const FETCH_TIMEOUT_MS = 5000;
export const HTML_MAX_BYTES = 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Printnest/0.3 (lokale Bibliothek)';

/** Tracking-Parameter, die für Vergleich und Speicherung entfernt werden. */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'igshid', 'mc_cid', 'mc_eid',
  '_gl', 'ref', 'ref_src', 'ref_url', 'si', 'spm', 'from', 'source', 'feature', 'share_source',
]);

// --- URL-Normalisierung ---

/**
 * URL für Vergleich/Duplikaterkennung normalisieren: https, Kleinbuchstaben im Host, ohne „www.“,
 * Standardport, Fragment, Tracking-Parameter (utm_*, fbclid …) und Schrägstrich am Ende;
 * restliche Parameter sortiert. YouTube-Kurzlinks werden vereinheitlicht.
 */
export function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  let host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id) {
      host = 'youtube.com';
      url.pathname = '/watch';
      url.searchParams.set('v', id);
    }
  }
  if (host === 'youtube.com' && url.pathname.startsWith('/shorts/')) {
    const id = url.pathname.split('/')[2];
    url.pathname = '/watch';
    url.searchParams.set('v', id);
  }
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  const port = url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) ? `:${url.port}` : '';
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
  // http und https gelten beim Vergleich als gleich.
  return `https://${host}${port}${pathname}${query}`;
}

/** Saubere URL zum Speichern: wie eingegeben, nur ohne Tracking-Parameter und Fragment-Tracking. */
export function cleanUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return String(raw).trim();
  }
}

// --- Portale ---

function titleFromSlug(slug) {
  if (!slug) return null;
  const words = decodeURIComponent(slug)
    .replace(/\.(html?|php)$/i, '')
    .split(/[-_+]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !/^(3d|print|model|stl|file|free)$/i.test(w));
  if (!words.length) return null;
  const small = new Set(['and', 'or', 'of', 'for', 'the', 'with', 'a', 'an', 'und', 'oder', 'für', 'mit', 'der', 'die', 'das']);
  return words
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export const PORTALS = [
  { id: 'makerworld', label: 'MakerWorld', hosts: ['makerworld.com', 'makerworld.com.cn'], parse: (p) => { const m = /\/models\/(\d+)(?:-([^/]+))?/.exec(p); return m && { modelId: m[1], title: titleFromSlug(m[2]) }; } },
  { id: 'printables', label: 'Printables', hosts: ['printables.com'], parse: (p) => { const m = /\/model\/(\d+)(?:-([^/]+))?/.exec(p); return m && { modelId: m[1], title: titleFromSlug(m[2]) }; } },
  { id: 'thingiverse', label: 'Thingiverse', hosts: ['thingiverse.com'], parse: (p) => { const m = /\/thing:(\d+)/.exec(p); return m && { modelId: m[1], title: null }; } },
  { id: 'cults3d', label: 'Cults3D', hosts: ['cults3d.com'], parse: (p) => { const m = /\/3d-model\/[^/]+\/([^/?#]+)/.exec(p); return m && { title: titleFromSlug(m[1]) }; } },
  { id: 'thangs', label: 'Thangs', hosts: ['thangs.com'], parse: (p) => { const m = /\/designer\/([^/]+)\/3d-model\/([^/?#]+?)(?:-(\d+))?$/.exec(p); return m && { creator: decodeURIComponent(m[1]), title: titleFromSlug(m[2]), modelId: m[3] ?? null }; } },
  { id: 'myminifactory', label: 'MyMiniFactory', hosts: ['myminifactory.com'], parse: (p) => { const m = /\/object\/(?:3d-print-)?([^/?#]+?)-(\d+)$/.exec(p); return m && { title: titleFromSlug(m[1]), modelId: m[2] }; } },
  { id: 'crealitycloud', label: 'Creality Cloud', hosts: ['crealitycloud.com'], parse: (p) => { const m = /\/model-detail\/([^/?#]+)/.exec(p); return m && { title: titleFromSlug(m[1].replace(/-[0-9a-f]{12,}$/i, '')) }; } },
  { id: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], parse: () => ({ title: null }) },
];

/** Bekanntes 3D-Portal anhand der URL erkennen (inkl. Modellname/Ersteller aus dem Pfad). */
export function detectPortal(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const portal = PORTALS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  if (!portal) return null;
  const info = portal.parse(url.pathname) ?? {};
  return { id: portal.id, label: portal.label, title: info.title ?? null, creator: info.creator ?? null, modelId: info.modelId ?? null };
}

// --- SSRF-Schutz ---

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

/** Private, lokale, reservierte oder Multicast-Adresse (IPv4/IPv6)? */
export function isPrivateAddress(address) {
  const ip = String(address).replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(ip)) {
    const value = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, mask]) => (value & mask) >>> 0 === base);
  }
  if (!net.isIPv6(ip)) return true;
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateAddress(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || lower.startsWith('2001:db8');
}

function blockedError(host) {
  return Object.assign(new Error(`Adresse nicht erlaubt (lokales oder privates Netz): ${host}`), { status: 400, code: 'BLOCKED_ADDRESS' });
}

/** DNS-Auflösung, die private Ziele verweigert – greift beim Verbindungsaufbau (kein Rebinding-Fenster). */
export function createSafeLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    resolve(hostname, { all: true, family: opts.family ?? 0 }, (error, addresses) => {
      if (error) return cb(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIPv6(addresses) ? 6 : 4 }];
      if (!list.length || list.some((a) => isPrivateAddress(a.address))) return cb(blockedError(hostname));
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

/**
 * GET mit SSRF-Schutz: nur http/https, keine privaten Ziele (auch nicht nach Weiterleitung),
 * Timeout, Größenlimit. Liefert { status, headers, body (Buffer), url }.
 */
export async function safeFetch(raw, { method = 'GET', maxBytes = HTML_MAX_BYTES, timeoutMs = FETCH_TIMEOUT_MS, accept = 'text/html,application/xhtml+xml', lookup = createSafeLookup() } = {}) {
  let current = String(raw);
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url;
    try {
      url = new URL(current);
    } catch {
      throw Object.assign(new Error('Ungültige URL.'), { status: 400 });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw Object.assign(new Error('Nur http/https erlaubt.'), { status: 400 });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateAddress(host)) throw blockedError(host);
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw blockedError(host);

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('Zeitüberschreitung.'), { status: 504, code: 'TIMEOUT' });
    const response = await new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        { method, lookup, headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'de,en;q=0.8' }, timeout: remaining },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              // Größenlimit: abbrechen, Gelesenes behalten (für HTML-Kopf reicht das).
              chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
              res.destroy();
              resolve({ res, body: Buffer.concat(chunks), truncated: true });
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ res, body: Buffer.concat(chunks), truncated: false }));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('Zeitüberschreitung.'), { status: 504, code: 'TIMEOUT' })));
      req.on('error', reject);
      req.end();
    });
    const { res } = response;
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      current = new URL(res.headers.location, url).toString();
      continue;
    }
    return { status: res.statusCode ?? 0, headers: res.headers, body: response.body, url: url.toString(), truncated: response.truncated };
  }
  throw Object.assign(new Error('Zu viele Weiterleitungen.'), { status: 400 });
}

// --- HTML-Metadaten ---

function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** OpenGraph/Twitter/Meta-Angaben aus HTML lesen. */
export function parseHtmlMeta(html, baseUrl) {
  const meta = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of tag[0].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? '';
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = decodeEntities(attrs.content);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let image = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || null;
  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch {
      image = null;
    }
  }
  return {
    title: meta['og:title'] || meta['twitter:title'] || (title ? decodeEntities(title) : null),
    description: meta['og:description'] || meta['twitter:description'] || meta.description || null,
    image,
    siteName: meta['og:site_name'] || null,
    creator: meta.author || meta['twitter:creator'] || meta['article:author'] || null,
  };
}

/** Portal-Zusätze aus Titeln entfernen („… | Printables.com“, „… by X - Thingiverse“). */
export function cleanTitle(title, portal) {
  if (!title) return null;
  let t = title;
  t = t.replace(/\s*[|–—-]\s*(?:Download\s+free\s+STL\s+model\s*\|\s*)?(?:Printables(?:\.com)?|MakerWorld|Thingiverse|Cults|Cults3D|Thangs|MyMiniFactory|Creality Cloud|YouTube)\s*$/i, '');
  t = t.replace(/\s*[|–—-]\s*(?:Download free STL model|Free 3D print model|3D model)\s*$/i, '');
  let creator = null;
  const by = /^(.*)\s+by\s+([^|–—-]+)$/i.exec(t);
  if (by && portal) {
    t = by[1];
    creator = by[2].trim();
  }
  t = t.replace(/^(?:3D Printable|STL file)\s+/i, '').trim();
  return { title: t || title, creator };
}

/** Saubereren Dateinamen-tauglichen Namen vorschlagen. */
export function suggestLinkName(title) {
  if (!title) return null;
  return title.replace(/[/\\:]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
}

/** Vorschau eines Links: Portal aus URL + Titel/Beschreibung/Bild aus OpenGraph bzw. oEmbed. */
export async function fetchLinkPreview(raw, options = {}) {
  const portal = detectPortal(raw);
  const result = {
    url: cleanUrl(raw),
    normalizedUrl: normalizeUrl(raw),
    portal: portal?.id ?? null,
    portalLabel: portal?.label ?? null,
    title: portal?.title ?? null,
    creator: portal?.creator ?? null,
    description: null,
    image: null,
    error: null,
  };
  try {
    if (portal?.id === 'youtube') {
      const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(result.url)}`;
      const res = await safeFetch(oembed, { ...options, accept: 'application/json', maxBytes: 64 * 1024 });
      if (res.status === 200) {
        const data = JSON.parse(res.body.toString('utf8'));
        result.title = data.title ?? result.title;
        result.creator = data.author_name ?? result.creator;
        result.image = data.thumbnail_url ?? null;
      }
    } else {
      const res = await safeFetch(result.url, options);
      if (res.status >= 400) {
        result.error = `Seite antwortet mit HTTP ${res.status}.`;
      } else {
        const meta = parseHtmlMeta(res.body.toString('utf8'), res.url);
        const cleaned = cleanTitle(meta.title, portal);
        result.title = cleaned?.title ?? result.title;
        result.creator = cleaned?.creator ?? meta.creator ?? result.creator;
        result.description = meta.description ? meta.description.slice(0, 300) : null;
        result.image = meta.image;
      }
    }
  } catch (error) {
    if (error?.code === 'BLOCKED_ADDRESS') throw error;
    result.error = error?.code === 'TIMEOUT' ? 'Zeitüberschreitung (5 s).' : 'Seite nicht erreichbar.';
  }
  result.suggestedName = suggestLinkName(result.title);
  return result;
}

/** Erreichbarkeit prüfen (HEAD, bei 405/403 GET). */
export async function checkLinkStatus(raw, options = {}) {
  try {
    let res = await safeFetch(raw, { ...options, method: 'HEAD', maxBytes: 1 });
    if (res.status === 405 || res.status === 403 || res.status === 501) res = await safeFetch(raw, { ...options, maxBytes: 16 * 1024 });
    const status = res.status === 404 || res.status === 410 ? 'not-found' : res.status < 400 ? 'ok' : 'error';
    return { status, httpStatus: res.status };
  } catch (error) {
    return { status: error?.code === 'BLOCKED_ADDRESS' ? 'blocked' : 'error', httpStatus: null };
  }
}
