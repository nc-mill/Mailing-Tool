import { describe, expect, it } from 'vitest';
import { assertCampaignInboxLiquid } from '../inbox-liquid';
import { ApiError } from '../../errors/api-error';

/**
 * Regresní sada nálezu N1, druhá vrstva. Předmět a preheader kampaně byly
 * jediná uživatelská pole bez validátoru, takže se do nich dal uložit
 * `{% include "../../../../app/.env" %}` a obsah souboru dorazil v hlavičce
 * Subject.
 */
describe('validace Liquidu v předmětu a preheaderu', () => {
  const codes = (fn: () => void): string[] => {
    try {
      fn();
    } catch (error) {
      if (error instanceof ApiError) return (error.errors ?? []).map((issue) => issue.code);
      throw error;
    }
    return [];
  };

  const paths = (fn: () => void): string[] => {
    try {
      fn();
    } catch (error) {
      if (error instanceof ApiError) return (error.errors ?? []).map((issue) => issue.path);
      throw error;
    }
    return [];
  };

  it.each([
    '{% include "../../../../app/.env" %}',
    "{% render '../../package.json' %}",
    '{% layout "x" %}',
    '{% assign x = 1 %}',
    '{% capture x %}y{% endcapture %}',
    '{% raw %}x{% endraw %}',
  ])('předmět s tagem %s se neuloží', (subject) => {
    expect(() => assertCampaignInboxLiquid({ subject })).toThrow(ApiError);
    expect(codes(() => assertCampaignInboxLiquid({ subject }))).toContain('liquid_tag_not_allowed');
    expect(paths(() => assertCampaignInboxLiquid({ subject }))).toContain('subject');
  });

  it('preheader se kontroluje stejně jako předmět', () => {
    const preheader = '{% include "/etc/passwd" %}';
    expect(() => assertCampaignInboxLiquid({ preheader })).toThrow(ApiError);
    expect(paths(() => assertCampaignInboxLiquid({ preheader }))).toEqual(['preheader']);
  });

  it('chyba je validation_failed se statusem 422', () => {
    try {
      assertCampaignInboxLiquid({ subject: '{% include "x" %}' });
      throw new Error('mělo to spadnout');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('validation_failed');
      expect((error as ApiError).status).toBe(422);
    }
  });

  it.each([
    'Vítejte u nás',
    'Ahoj {{ contact.first_name }}!',
    '{{ contact.first_name | default: "kolego" }}, máme pro tebe novinku',
    '{% if contact.is_vip %}VIP nabídka{% else %}Nabídka{% endif %}',
    '{% unless contact.is_vip %}Staň se VIP{% endunless %}',
    '{{ campaign.name }} od {{ workspace.name }}',
    '{{ contact.signup_at | date: "%d.%m.%Y" }}',
    '',
  ])('legitimní předmět %s projde', (subject) => {
    expect(() => assertCampaignInboxLiquid({ subject })).not.toThrow();
  });

  it('nevyplněná pole se nevalidují, PATCH posílá jen to, co se mění', () => {
    expect(() => assertCampaignInboxLiquid({})).not.toThrow();
    expect(() => assertCampaignInboxLiquid({ subject: undefined })).not.toThrow();
  });

  it('obě pole naráz vrátí obě chyby, ne jen první', () => {
    const found = codes(() =>
      assertCampaignInboxLiquid({
        subject: '{% include "a" %}',
        preheader: '{% render "b" %}',
      }),
    );
    expect(found).toEqual(['liquid_tag_not_allowed', 'liquid_tag_not_allowed']);
  });
});
