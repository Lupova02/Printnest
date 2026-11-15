import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES_SCSS } from '../build-themes.mjs';
import { THEME_SOURCES, allThemes, contrast, contrastPairs, oklch, renderThemesScss, rgbToOklch, hexToRgb } from '../themes.mjs';

describe('Farbprofile', () => {
  const themes = allThemes();

  it('gibt es für Home + alle Typen, jeweils Hell und Dunkel', () => {
    expect(Object.keys(themes)).toEqual(['home', 'stl', '3mf', 'f3d', 'pdf', 'mp4', 'img', 'link', 'rated']);
    for (const theme of Object.values(themes)) {
      expect(Object.keys(theme.light).sort()).toEqual(Object.keys(theme.dark).sort());
      expect(theme.light['bg-window']).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('alle Text/Hintergrund-Paare erfüllen WCAG AA', () => {
    const failures = [];
    for (const [id, theme] of Object.entries(themes)) {
      for (const mode of ['light', 'dark']) {
        for (const pair of contrastPairs(theme[mode])) {
          if (pair.ratio < pair.min) failures.push(`${id}/${mode}: ${pair.fg} auf ${pair.bg} = ${pair.ratio.toFixed(2)} (< ${pair.min})`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('übernimmt den Farbton der Typfarbe, Hintergründe sind kaum gesättigt', () => {
    for (const [id, source] of Object.entries(THEME_SOURCES)) {
      const [, , hue] = rgbToOklch(hexToRgb(source));
      const [, bgC] = rgbToOklch(hexToRgb(themes[id].dark['bg-window']));
      expect(bgC, id).toBeLessThan(0.03);
      const [, , accentHue] = rgbToOklch(hexToRgb(themes[id].dark.accent));
      const diff = Math.abs(((accentHue - hue + 540) % 360) - 180);
      expect(diff, id).toBeLessThan(12);
    }
  });

  it('Home bleibt das bisherige Eisblau/Navy', () => {
    expect(themes.home.dark.accent).toBe('#8fd4e8');
    expect(themes.home.dark['bg-window']).toBe('#0d141b');
  });

  it('Farb-Mathematik: Weiß/Schwarz = 21:1, OKLCH-Rundreise', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(oklch(...rgbToOklch(hexToRgb('#17728f')))).toBe('#17728f');
  });

  it('_themes.scss ist aktuell (sonst `node scripts/build-themes.mjs`)', () => {
    expect(fs.readFileSync(THEMES_SCSS, 'utf8')).toBe(renderThemesScss());
  });
});
