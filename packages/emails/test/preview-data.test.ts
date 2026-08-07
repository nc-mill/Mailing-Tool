import { describe, expect, it } from 'vitest';
import { buildGreeting } from '../src/greeting';
import { sampleFor, sampleRenderData } from '../src/preview-data';

describe('sampleRenderData', () => {
  /**
   * Do 7. 8. 2026 tu stál literál. Kdyby se v `buildGreeting` změnila čárka nebo
   * znění, náhled i editor by dál slibovaly starou větu a rozdíl by se poznal
   * až u příjemce.
   */
  it('skládá oslovení tímtéž skladatelem, který ho složí při odeslání', () => {
    const data = sampleRenderData('cs');
    const composed = buildGreeting({
      locale: 'cs',
      addressForm: 'formal',
      salutationBy: 'first_name',
      vocativePolicy: 'strict',
      firstName: data.contact.first_name as string,
      lastName: null,
      gender: 'male',
      firstNameVocative: data.contact.first_name_vocative as string,
      lastNameVocative: null,
      vocativeConfidence: 'high',
    }).greeting;
    expect(data.contact.greeting).toBe(composed);
  });

  /**
   * Kontakt bez jména dostane neutrální „Dobrý den" BEZ čárky, ne prázdno.
   * Volba „Kontakt bez jména" tu do teď ukazovala na prvním řádku díru.
   */
  it('u kontaktu bez jména ukáže neutrální pozdrav, ne prázdno', () => {
    expect(sampleFor('cs', 'no_name').contact.greeting).toBe('Dobrý den');
    expect(sampleFor('en', 'no_name').contact.greeting).toBe('Hello');
  });

  /**
   * NASTAVENÍ PROJEKTU MÁ NA VĚTU VLIV, a do 7. 8. 2026 ho vzorek neznal:
   * dostával jen jazyk, takže projekt s tykáním viděl v náhledu i na plátně
   * „Dobrý den, Přemyslave-Řehoři" u e-mailu, který odejde s „Ahoj".
   */
  it('skládá vzorovou větu podle nastavení projektu, ne podle výchozích hodnot', () => {
    const informal = sampleRenderData('cs', {
      addressForm: 'informal',
      salutationBy: 'first_name',
      vocativePolicy: 'strict',
    });
    expect(informal.contact.greeting).toBe('Ahoj Přemyslave-Řehoři');

    // Táž věta i ve variantě bez jména: tam se skládá podruhé a vlastní cestou,
    // takže by se nastavení dalo ztratit zvlášť.
    const noName = sampleFor('cs', 'no_name', {
      addressForm: 'informal',
      salutationBy: 'first_name',
      vocativePolicy: 'strict',
    });
    expect(noName.contact.greeting).toBe('Ahoj');
  });

  it('bez nastavení bere výchozí hodnoty nového projektu', () => {
    expect(sampleRenderData('cs').contact.greeting).toBe('Dobrý den, Přemyslave-Řehoři');
  });

  it('provides both language variants', () => {
    expect(sampleRenderData('cs').contact.greeting).toContain('Dobrý den');
    expect(sampleRenderData('en').contact.greeting).toContain('Hello');
  });

  it('includes hostile values that break naive templates', () => {
    const data = sampleRenderData('cs');
    expect(data.contact.first_name).toMatch(/[ěščřžýáíé]/);
    expect(data.contact.last_name).toBe('');
    expect(JSON.stringify(data)).toContain('<');
    expect(JSON.stringify(data)).toContain('&');
  });

  it('always fills the internal context roots', () => {
    const data = sampleRenderData('cs');
    expect(data._context.timezone).toBe('Europe/Prague');
    expect(data._context.locale).toBe('cs');
  });

  it('starts with an empty presence map so the caller must fill it', () => {
    expect(sampleRenderData('cs')._present).toEqual({});
  });

  it('points every system url at the disabled anchor', () => {
    const data = sampleRenderData('cs');
    for (const key of ['unsubscribe_url', 'preferences_url', 'webview_url'] as const) {
      expect(data[key]).toBe('#preview-disabled');
    }
  });
});
