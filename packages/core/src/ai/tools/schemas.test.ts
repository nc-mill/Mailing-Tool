import { describe, expect, it } from 'vitest';
import {
  composeTemplateInput,
  extractBrandInput,
  languageTag,
  listMergeTagsInput,
  suggestSubjectInput,
  writeCopyInput,
} from './schemas';

describe('jazykový tag', () => {
  it('přijme libovolný platný BCP 47 tag, ne jen cs a en', () => {
    for (const tag of ['cs', 'en', 'de', 'pt-BR', 'sr-Latn-RS']) {
      expect(languageTag.safeParse(tag).success).toBe(true);
    }
  });

  it('odmítne nesmysl a příliš dlouhou hodnotu', () => {
    expect(languageTag.safeParse('CESTINA!').success).toBe(false);
    expect(languageTag.safeParse('a'.repeat(40)).success).toBe(false);
  });
});

describe('schémata nástrojů', () => {
  it('list_merge_tags nemá vstup', () => {
    expect(listMergeTagsInput.safeParse({}).success).toBe(true);
  });

  it('extract_brand bere jen url', () => {
    expect(extractBrandInput.safeParse({ url: 'https://kolo-shop.cz' }).success).toBe(true);
    expect(extractBrandInput.safeParse({ url: 'nic' }).success).toBe(false);
  });

  it('compose_template má čtyři druhy a výchozí tón friendly', () => {
    const parsed = composeTemplateInput.parse({
      kind: 'newsletter',
      brief: 'Pozvánka na letní výprodej kol',
      language: 'cs',
    });
    expect(parsed.tone).toBe('friendly');
    expect(
      composeTemplateInput.safeParse({ kind: 'promo', brief: 'x'.repeat(20), language: 'cs' })
        .success,
    ).toBe(false);
  });

  it('compose_template hlídá délku zadání a počet sekcí', () => {
    expect(
      composeTemplateInput.safeParse({ kind: 'newsletter', brief: 'krátké', language: 'cs' })
        .success,
    ).toBe(false);
    expect(
      composeTemplateInput.safeParse({
        kind: 'newsletter',
        brief: 'x'.repeat(20),
        language: 'cs',
        sectionCount: 9,
      }).success,
    ).toBe(false);
  });

  it('write_copy zná šest druhů textu a volitelné blockId ve tvaru b_xxxxxxxxxxxx', () => {
    const ok = writeCopyInput.safeParse({
      blockId: 'b_abc123def456',
      kind: 'headline',
      instruction: 'Zkrať to',
      language: 'cs',
      tone: 'friendly',
    });
    expect(ok.success).toBe(true);
    expect(
      writeCopyInput.safeParse({
        blockId: 'blok-1',
        kind: 'headline',
        instruction: 'Zkrať to',
        language: 'cs',
        tone: 'friendly',
      }).success,
    ).toBe(false);
  });

  it('suggest_subject má výchozích pět variant a emoji vypnuté', () => {
    const parsed = suggestSubjectInput.parse({ summary: 'Letní výprodej kol', language: 'cs' });
    expect(parsed.count).toBe(5);
    expect(parsed.includeEmoji).toBe(false);
  });
});
