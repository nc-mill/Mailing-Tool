// @vitest-environment node
import {
  CONSENT_PURPOSES as CORE_PURPOSES,
  CONTACT_FIELD_KEYS as CORE_KEYS,
  ENGAGEMENT_METRICS as CORE_METRICS,
  FIELD_CLASS_OPERATORS as CORE_MATRIX,
  contactFieldClass as coreFieldClass,
} from '@mlain/core/segments';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_PURPOSES,
  CONTACT_FIELD_KEYS,
  contactFieldClass,
  ENGAGEMENT_METRICS,
  FIELD_CLASS_OPERATORS,
} from '../../src/features/segments/operator-matrix';

/**
 * Smlouva mezi obrazovkou a kompilátorem. Obrazovka nesmí importovat
 * `@mlain/core/segments`, protože ten balíček táhne přístup k databázi
 * a sestavení stránky na tom padá; kopie matice je proto vědomá a tenhle
 * test je jediné, co drží obě strany u sebe. Běží v Node, kde import jádra
 * nevadí.
 */
describe('matice operátorů se nesmí rozejít s kompilátorem', () => {
  it('má stejné třídy polí', () => {
    expect(Object.keys(FIELD_CLASS_OPERATORS).sort()).toEqual(Object.keys(CORE_MATRIX).sort());
  });

  it('má u každé třídy stejné operátory ve stejném pořadí', () => {
    for (const [fieldClass, operators] of Object.entries(CORE_MATRIX)) {
      expect(FIELD_CLASS_OPERATORS[fieldClass as never], fieldClass).toEqual(operators);
    }
  });

  it('pokrývá všech čtyřicet operátorů', () => {
    const seen = new Set(Object.values(FIELD_CLASS_OPERATORS).flat());
    expect(seen.size).toBe(40);
  });

  it('má stejné klíče polí kontaktu a jejich třídy', () => {
    expect(CONTACT_FIELD_KEYS.sort()).toEqual([...CORE_KEYS].sort());
    for (const key of CORE_KEYS) {
      expect(contactFieldClass(key), key).toBe(coreFieldClass(key));
    }
  });

  it('má stejné účely souhlasu a metriky aktivity', () => {
    expect(CONSENT_PURPOSES).toEqual([...CORE_PURPOSES]);
    expect(ENGAGEMENT_METRICS).toEqual([...CORE_METRICS]);
  });
});
