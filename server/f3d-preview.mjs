import { inflateSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';

const PK_LOCAL = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const ZSTD_METHOD = 93;

function indexOfSeq(buf, seq, from = 0) {
  outer: for (let i = from; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function isPng(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

/** Pixelfläche aus dem PNG-IHDR (0, wenn unlesbar). */
function pngArea(bytes) {
  if (bytes.length < 24) return 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return dv.getUint32(16) * dv.getUint32(20);
}

/**
 * Liest die eingebettete PNG-Vorschau aus einer Fusion-360-.f3d-Datei (ZIP).
 * Unterstützt store, deflate und zstd (Method 93).
 * `variant`: 'thumb' bevorzugt `small.png` (schnell für Kacheln),
 * 'large' nimmt das Bild mit der höchsten Auflösung (große Vorschau).
 */
export function extractF3dPreviewBytes(fileData, { variant = 'thumb' } = {}) {
  const data = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
  const dv = new DataView(data.buffer, data.byteOffset, data.length);

  let best = null;
  let i = indexOfSeq(data, PK_LOCAL, 0);

  for (let guard = 0; i >= 0 && guard < 10_000; guard++) {
    if (i + 30 > data.length) break;

    const method = dv.getUint16(i + 8, true);
    const compSize = dv.getUint32(i + 18, true);
    const nlen = dv.getUint16(i + 26, true);
    const elen = dv.getUint16(i + 28, true);
    const nameStart = i + 30;
    const dataStart = nameStart + nlen + elen;

    if (nameStart + nlen <= data.length && dataStart <= data.length) {
      let name = '';
      for (let k = 0; k < nlen; k++) name += String.fromCharCode(data[nameStart + k]);

      if (/preview/i.test(name) && /\.png$/i.test(name)) {
        let bytes = null;
        const compressed = data.subarray(dataStart, dataStart + compSize);

        if (method === 0) {
          bytes = compressed;
        } else if (method === 8) {
          try {
            bytes = inflateSync(compressed);
          } catch {
            bytes = null;
          }
        } else if (method === ZSTD_METHOD) {
          try {
            bytes = zstdDecompress(compressed);
          } catch {
            bytes = null;
          }
        }

        if (bytes && isPng(bytes)) {
          const lo = name.toLowerCase();
          let score;
          if (variant === 'large') {
            score = pngArea(bytes) * 10 + (lo.includes('preview') ? 1 : 0);
          } else {
            score = bytes.length;
            if (lo.includes('small.png')) score += 1_000_000;
            if (lo.includes('preview')) score += 100_000;
          }
          if (!best || score > best.score) best = { bytes, score };
        }
      }
    }

    i = indexOfSeq(data, PK_LOCAL, i + 4);
  }

  return best?.bytes ?? null;
}
