import { zipSync, strToU8 } from 'fflate';
import { flatNormals, parseModel, parseStl, read3mfMeta, simplifyPositions } from './model-parse';

function binaryStl(triangles: number[][]): Uint8Array {
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => t.forEach((v, k) => view.setFloat32(84 + i * 50 + 12 + k * 4, v, true)));
  return new Uint8Array(buf);
}

describe('3D-Parser (Worker-Logik)', () => {
  it('liest binäre und ASCII-STL', () => {
    const tri = [0, 0, 0, 10, 0, 0, 0, 20, 5];
    expect(Array.from(parseStl(binaryStl([tri])))).toEqual(tri);
    const ascii = strToU8('solid t\n facet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 10 0 0\n vertex 0 20 5\n endloop\n endfacet\nendsolid t\n');
    expect(Array.from(parseStl(ascii))).toEqual(tri);
  });

  it('zentriert, misst und berechnet flache Normalen', () => {
    const model = parseModel(binaryStl([[0, 0, 0, 30, 0, 0, 0, 12, 25]]), 'stl');
    expect(model.size).toEqual({ x: 30, y: 12, z: 25 });
    expect(model.triangles).toBe(1);
    expect(model.simplified).toBe(false);
    const n = flatNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(Array.from(n.slice(0, 3))).toEqual([0, 0, 1]);
  });

  it('liest 3MF mit Komponenten, Transformationen und Metadaten', () => {
    const model = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Benchy Boot</metadata>
  <metadata name="Designer">CreativeTools</metadata>
  <resources>
    <object id="1" type="model"><mesh>
      <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices>
      <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
    </mesh></object>
    <object id="2" type="model" name="Gruppe"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 100 0 0"/></components></object>
  </resources>
  <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 5"/><item objectid="1"/></build>
</model>`;
    const settings = '<config><plate><metadata key="plater_name" value="Rumpf"/></plate></config>';
    const zip = zipSync({ '3D/3dmodel.model': strToU8(model), 'Metadata/model_settings.config': strToU8(settings) });
    const parsed = parseModel(zip, '3mf');
    expect(parsed.triangles).toBe(2);
    expect(parsed.size.x).toBe(110);
    expect(parsed.size.z).toBe(5);
    const meta = read3mfMeta(zip);
    expect(meta.title).toBe('Benchy Boot');
    expect(meta.designer).toBe('CreativeTools');
    expect(meta.plates).toEqual(['Rumpf']);
  });

  it('vereinfacht große Netze per Clustering', () => {
    // Fein trianguliertes Gitter (20 000 Dreiecke) → Ziel 2 000.
    const n = 100;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        out.push(i, j, 0, i + 1, j, 0, i, j + 1, 0, i + 1, j, 0, i + 1, j + 1, 0, i, j + 1, 0);
      }
    }
    const simplified = simplifyPositions(new Float32Array(out), 2000);
    expect(simplified.length / 9).toBeLessThanOrEqual(2300);
    expect(simplified.length / 9).toBeGreaterThan(500);
  });
});
