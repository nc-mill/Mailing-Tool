import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConfigManifest } from '../../src/config/manifest';

describe('manifest konfigurace', () => {
  it('commitnutý soubor se shoduje s vygenerovaným', () => {
    const file = path.join(import.meta.dirname, '../../src/config/config.manifest.json');
    const committed = fs.readFileSync(file, 'utf8');
    expect(committed).toBe(`${JSON.stringify(buildConfigManifest(), null, 2)}\n`);
  });

  it('obsahuje právě 179 proměnných', () => {
    expect(buildConfigManifest().variables.length).toBe(179);
  });
});
