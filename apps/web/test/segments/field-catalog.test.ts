import { fieldRefKey } from '@mlain/ui/patterns/query-builder';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/features/segments/field-catalog';
import { catalogTranslate, messages } from '../helpers/intl';

const t = catalogTranslate('cs', 'segments');

/**
 * Skutečný překladač next-intl, ne zjednodušený z helperu. Popisek omezeného
 * rozsahu je ICU s množným číslem a helper umí jen dosadit `{jméno}`, takže by
 * test prošel i nad nezformátovanou zprávou.
 */
const icu = createTranslator({
  locale: 'cs',
  namespace: 'segments',
  messages: messages('cs', 'segments'),
}) as unknown as (key: string, values?: Record<string, string | number>) => string;

const TAGS = [
  { id: '019fc79f-7b3e-751c-a316-38118b61ec55', name: 'Newsletter' },
  { id: '019fc79f-7b3d-7c61-aa73-dee3763a23f0', name: 'Praha' },
];

function fieldById(fields: ReturnType<typeof buildFieldCatalog>, id: string) {
  const found = fields.find((field) => field.id === id);
  if (found === undefined) throw new Error(`pole ${id} v katalogu není`);
  return found;
}

describe('katalog polí segmentu', () => {
  it('nabízí u štítku skutečné štítky projektu, hodnotou je identifikátor', () => {
    const tag = fieldById(buildFieldCatalog(t, { tags: TAGS }), 'tag');
    expect(tag.options).toEqual([
      { value: TAGS[0]!.id, label: 'Newsletter' },
      { value: TAGS[1]!.id, label: 'Praha' },
    ]);
  });

  it('bez štítků nechá nabídku prázdnou, ne nedefinovanou', () => {
    // Rozdíl je podstatný: prázdné pole znamená „vybírá se z nabídky a ta je
    // prázdná", chybějící by znamenalo „piš volný text", tedy zpátky jméno
    // štítku v dotazu na uuid.
    expect(fieldById(buildFieldCatalog(t), 'tag').options).toEqual([]);
  });

  it('u stavu kontaktu nabízí hodnoty, ne volný text', () => {
    const status = fieldById(buildFieldCatalog(t), 'contact.status');
    expect(status.options?.map((option) => option.value)).toEqual([
      'active',
      'unconfirmed',
      'unsubscribed',
      'bounced',
      'complained',
    ]);
    // Smazané kontakty vyřazuje obálka dotazu vždycky, taková podmínka by
    // vracela nulu pokaždé.
    expect(status.options?.some((option) => option.value === 'deleted')).toBe(false);
  });

  it('u odkazu na segment nechce hodnotu, cíl nese pole', () => {
    const fields = buildFieldCatalog(t, { segments: [{ id: 'a', name: 'Zákazníci' }] });
    const segment = fieldById(fields, 'segment.a');
    expect(segment.ref).toEqual({ kind: 'segment', segment_id: 'a' });
    expect(segment.operators.map((operator) => operator.shape)).toEqual(['none', 'none']);
  });

  it('účel souhlasu má český popisek, ne strojový klíč', () => {
    const consent = fieldById(buildFieldCatalog(t), 'consent.email_marketing');
    expect(consent.label).toBe('Marketingové e-maily');
  });

  it('doplní pole pro omezený rozsah aktivity z otevírané definice', () => {
    // Předloha „Neotevřel posledních 5 kampaní" nese scope, který obecná
    // položka katalogu nemá, takže by se podmínka nespárovala s žádným polem.
    const definition = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'engagement', metric: 'opened', scope: { last_n_campaigns: 5 } },
            operator: 'did_not',
          },
        ],
      },
    };
    const fields = buildFieldCatalog(icu, { definition });
    const matched = fields.find(
      (field) =>
        fieldRefKey(field.ref) ===
        fieldRefKey({ kind: 'engagement', metric: 'opened', scope: { last_n_campaigns: 5 } }),
    );
    expect(matched?.label).toBe('Otevřel kampaň (posledních 5 kampaní)');
  });

  it('bez definice žádné pole navíc nevznikne', () => {
    expect(buildFieldCatalog(t).length).toBe(buildFieldCatalog(t, { definition: null }).length);
  });
});
