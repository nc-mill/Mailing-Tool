import { describe, expect, it } from 'vitest';
import { decideKeyId, keyIdsInEnv, MAX_KEY_ID } from '../../src/ops/genkey';

/**
 * Volba `key_id` pro nový klíč.
 *
 * Vada, kterou tenhle soubor hlídá: `mlain genkey` měl `--id` s výchozí
 * hodnotou 2, takže druhá rotace bez přepínače vyrobila DRUHÝ RŮZNÝ klíč
 * se stejným `key_id`. Data zašifrovaná tím prvním se přestala dát přečíst
 * a neohlásilo to nic, protože `key_id` sedělo.
 */

describe('pokolení přečtená z prostředí', () => {
  it('přečte aktuální i všechna předchozí pokolení', () => {
    expect(keyIdsInEnv({ SECRET_KEY: '3:abc', SECRET_KEY_PREVIOUS: '1:def,2:ghi' })).toEqual([
      1, 2, 3,
    ]);
  });

  it('prázdné prostředí je prázdný seznam, ne výjimka', () => {
    expect(keyIdsInEnv({})).toEqual([]);
    expect(keyIdsInEnv({ SECRET_KEY: '', SECRET_KEY_PREVIOUS: '' })).toEqual([]);
  });

  it('rozbité prostředí NEVYHODÍ výjimku, jen přeskočí, co nedává smysl', () => {
    // Příkaz se pouští právě tehdy, když je s klíči něco v nepořádku.
    // Kdyby na rozbité hodnotě spadl, nedal by se použít, kdy je nejvíc potřeba.
    expect(
      keyIdsInEnv({ SECRET_KEY: 'bez-dvojtecky', SECRET_KEY_PREVIOUS: 'x:y,0:z,2:ok' }),
    ).toEqual([2]);
  });

  it('pokolení mimo rozsah 1 až 255 se ignoruje', () => {
    expect(keyIdsInEnv({ SECRET_KEY: '256:abc', SECRET_KEY_PREVIOUS: '0:def' })).toEqual([]);
  });
});

describe('volba key_id pro nový klíč', () => {
  it('bez --id odvodí NÁSLEDUJÍCÍ pokolení, ne pevnou dvojku', () => {
    const decision = decideKeyId(undefined, [1, 2, 3]);
    expect(decision).toMatchObject({ ok: true, keyId: 4 });
  });

  it('druhá rotace bez přepínače tedy NEVYROBÍ dvojku podruhé', () => {
    expect(decideKeyId(undefined, [1, 2])).toMatchObject({ ok: true, keyId: 3 });
  });

  it('bez --id a bez pokolení v prostředí ODMÍTNE hádat', () => {
    const decision = decideKeyId(undefined, []);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.message).toContain('--id');
    expect(decision.message).toContain('--id 1');
  });

  it('vyžádané pokolení, které už existuje, ODMÍTNE a poradí volné', () => {
    const decision = decideKeyId('2', [1, 2]);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.message).toContain('UŽ ZNÁ');
    expect(decision.message).toContain('mlain genkey --id 3');
  });

  it('vyžádané volné pokolení projde', () => {
    expect(decideKeyId('5', [1, 2])).toMatchObject({ ok: true, keyId: 5 });
  });

  it('nižší volné pokolení projde, ale s varováním, že rotace jde nahoru', () => {
    const decision = decideKeyId('3', [1, 2, 4]);
    expect(decision).toMatchObject({ ok: true, keyId: 3 });
    if (!decision.ok) return;
    expect(decision.notes.join(' ')).toContain('nižší');
  });

  it('nesmysl v --id skončí hláškou o rozsahu, ne pádem', () => {
    for (const value of ['nula', '0', '-1', '1.5', String(MAX_KEY_ID + 1), '']) {
      expect(decideKeyId(value, [1]).ok, `hodnota ${value}`).toBe(false);
    }
  });
});
