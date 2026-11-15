import { createCanvas, Image } from '@napi-rs/canvas';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Erzeugt alle Icon-Varianten aus der SVG-Quelle:
 * - build/icon.iconset (16–1024, @1x/@2x) → build/icon.icns (macOS, via iconutil)
 * - build/icon.png (1024 px, electron-builder)
 * - public/favicon.ico (16/32/48/64), public/printnest.png (512 px), public/branding/printnest-icon.svg
 * - printnest-logo.png (512 px) in assets/branding und public/branding
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcSvg = path.join(root, 'assets', 'branding', 'printnest-icon.svg');
const buildDir = path.join(root, 'build');
const publicDir = path.join(root, 'public');
const iconsetDir = path.join(buildDir, 'icon.iconset');

const svg = fs.readFileSync(srcSvg);

/** SVG direkt in der Zielgröße rastern (scharfer als Herunterskalieren). */
function renderPng(px) {
  const image = new Image();
  image.width = px;
  image.height = px;
  image.src = svg;
  const canvas = createCanvas(px, px);
  canvas.getContext('2d').drawImage(image, 0, 0, px, px);
  return canvas.toBuffer('image/png');
}

/** ICO-Container mit PNG-Einträgen (von allen aktuellen Browsern unterstützt). */
function buildIco(sizes) {
  const images = sizes.map((px) => ({ px, data: renderPng(px) }));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ px, data }, i) => {
    const base = 6 + i * 16;
    header.writeUInt8(px >= 256 ? 0 : px, base);
    header.writeUInt8(px >= 256 ? 0 : px, base + 1);
    header.writeUInt8(0, base + 2);
    header.writeUInt8(0, base + 3);
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(data.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((img) => img.data)]);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

for (const base of [16, 32, 128, 256, 512]) {
  fs.writeFileSync(path.join(iconsetDir, `icon_${base}x${base}.png`), renderPng(base));
  fs.writeFileSync(path.join(iconsetDir, `icon_${base}x${base}@2x.png`), renderPng(base * 2));
}

fs.writeFileSync(path.join(buildDir, 'icon.png'), renderPng(1024));
fs.writeFileSync(path.join(publicDir, 'printnest.png'), renderPng(512));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), buildIco([16, 32, 48, 64]));
fs.mkdirSync(path.join(publicDir, 'branding'), { recursive: true });
fs.copyFileSync(srcSvg, path.join(publicDir, 'branding', 'printnest-icon.svg'));
const logo = renderPng(512);
fs.writeFileSync(path.join(publicDir, 'branding', 'printnest-logo.png'), logo);
fs.writeFileSync(path.join(root, 'assets', 'branding', 'printnest-logo.png'), logo);

/**
 * ICNS direkt schreiben (PNG-Einträge, ab macOS 10.7 gültig) – Fallback, falls iconutil
 * nicht verfügbar ist oder in einer Sandbox ohne System-Dienste scheitert.
 */
function buildIcns() {
  const entries = [
    ['icp4', 'icon_16x16.png'],
    ['icp5', 'icon_32x32.png'],
    ['ic11', 'icon_16x16@2x.png'],
    ['ic12', 'icon_32x32@2x.png'],
    ['ic07', 'icon_128x128.png'],
    ['ic13', 'icon_128x128@2x.png'],
    ['ic08', 'icon_256x256.png'],
    ['ic14', 'icon_256x256@2x.png'],
    ['ic09', 'icon_512x512.png'],
    ['ic10', 'icon_512x512@2x.png'],
  ].map(([type, file]) => {
    const data = fs.readFileSync(path.join(iconsetDir, file));
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

const icnsPath = path.join(buildDir, 'icon.icns');
let usedIconutil = false;
if (process.platform === 'darwin') {
  try {
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'pipe' });
    usedIconutil = true;
  } catch {
    // Fallback unten.
  }
}
if (!usedIconutil) fs.writeFileSync(icnsPath, buildIcns());
console.log(`Icon erstellt (${usedIconutil ? 'iconutil' : 'JS-Writer'}):`, icnsPath);
fs.rmSync(iconsetDir, { recursive: true, force: true });
