import {
  SCHEMA_PRESETS,
  applySchema,
  cleanFileName,
  diffNames,
  guessSchema,
  learnFromCorrection,
  nameSimilarity,
  parseFileName,
} from './name-cleanup';

describe('Namensbereinigung', () => {
  it('zerlegt benchy_0.2mm_PLA_2h13m.3mf in Name und Tags', () => {
    const parsed = parseFileName('benchy_0.2mm_PLA_2h13m.3mf');
    expect(parsed.model).toBe('Benchy');
    expect(parsed.material).toBe('PLA');
    expect(parsed.layerHeight).toBe('0,2 mm');
    expect(parsed.printTime).toBe('2 h 13 min');
    expect(parsed.extension).toBe('3mf');
    expect(parsed.tags).toEqual(['PLA', '0,2 mm', '2 h 13 min']);
    expect(cleanFileName('benchy_0.2mm_PLA_2h13m.3mf')).toBe('Benchy.3mf');
  });

  it('entfernt Störwörter, Kopie-Zähler und doppelte Leerzeichen, behält Versionen', () => {
    expect(cleanFileName('halter__final  (1).stl')).toBe('Halter.stl');
    expect(cleanFileName('Kabel-Clip v2 copy.stl')).toBe('Kabel Clip – V2.stl');
    expect(parseFileName('Kabel-Clip v2 copy.stl').removed).toContain('copy');
  });

  it('erkennt Varianten, Drucker, Düse und Platten', () => {
    const p = parseFileName('Vase - Groß_PETG_0.4nozzle_X1C_plate_2.3mf');
    expect(p.model).toBe('Vase');
    expect(p.variant).toBe('Groß Platte 2');
    expect(p.material).toBe('PETG');
    expect(p.nozzle).toBe('0,4 mm');
    expect(p.printer).toBe('X1C');
  });

  it('erkennt Material mit Zusatz (Silk PLA, PLA-CF)', () => {
    expect(parseFileName('drache_silk_pla.stl').material).toBe('PLA Silk');
    expect(parseFileName('halter_PLA-CF.stl').material).toBe('PLA-CF');
  });

  it('entfernt UUIDs und lange IDs', () => {
    expect(cleanFileName('Gear_3f2a9c1e-1b2c-4d5e-8f90-123456789abc.stl')).toBe('Gear.stl');
    expect(cleanFileName('Gear_model_20251103123045.stl')).toBe('Gear.stl');
  });

  it('wendet ein Schema an und lässt leere Felder samt Trenner weg', () => {
    const full = SCHEMA_PRESETS.find((p) => p.id === 'full')!.schema;
    expect(applySchema(parseFileName('benchy_0.2mm_PLA.3mf'), full)).toBe('Benchy – PLA – 0,2 mm.3mf');
    expect(applySchema(parseFileName('vase - hoch_PETG.stl'), full)).toBe('Vase – Hoch – PETG.stl');
  });

  it('errät ein Schema aus Geschwisterdateien', () => {
    const schema = guessSchema(['Clip – PLA.stl', 'Halter – PETG.stl', 'Deckel – PLA.stl']);
    expect(schema?.fields).toEqual(['model', 'material']);
    expect(guessSchema(['a.stl'])).toBeNull();
  });

  it('berechnet Ähnlichkeit und Diff', () => {
    expect(nameSimilarity('Benchy Boot.3mf', 'benchy_boot_0.2mm.stl')).toBe(1);
    expect(nameSimilarity('Vase.stl', 'Halter.stl')).toBe(0);
    expect(diffNames('halter_v2.stl', 'Halter – V2.stl')).toEqual({ prefix: '', removed: 'halter_v', added: 'Halter – V', suffix: '2.stl' });
  });

  it('lernt aus Korrekturen', () => {
    const learned = learnFromCorrection('benchy_final_test.stl', 'Benchy.stl', 'Benchy Final.stl');
    expect(learned.keep).toContain('final');
    const parsed = parseFileName('halter_final.stl', { keep: new Set(learned.keep) });
    expect(parsed.model).toBe('Halter Final');
    expect(parseFileName('halter_rot.stl', { drop: new Set(['rot']) }).model).toBe('Halter');
  });
});
