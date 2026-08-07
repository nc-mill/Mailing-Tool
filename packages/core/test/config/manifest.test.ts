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

  it('obsahuje právě 183 proměnných', () => {
    // 180 + LOGIN_THROTTLING_DISABLED (vypínač brzd přihlašování pro vývoj)
    // + DATABASE_URL_GDPR (připojení pod rolí mlain_gdpr, bez kterého nedoběhne
    // výmaz podle článku 17)
    // + TRACKING_CONTACT_LOOKUP_TIMEOUT_MS (strop dohledání kontaktu při
    // prokliku, dřív napsaný natvrdo na 30 ms, což měření neuneslo).
    expect(buildConfigManifest().variables.length).toBe(183);
  });
});
