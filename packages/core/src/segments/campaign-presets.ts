import type { GroupNode, SegmentAst } from './ast';

/**
 * Předlohy segmentů vázané na JEDNU konkrétní kampaň.
 *
 * PROČ VLASTNÍ SOUBOR A NE `SEGMENT_PRESETS`. Předlohy v `presets.ts` vystavuje
 * `/api/v1/segments/presets` a obrazovka segmentů je vykresluje jako karty ke
 * kliknutí. Tyhle dvě bez čísla kampaně nedávají smysl, takže by se na kartách
 * objevily jako nabídka, po jejímž rozkliknutí nevznikne nic. Nabízí je proto
 * jen report kampaně, který to číslo má.
 *
 * JAZYK PODMÍNEK NA TO STAČIL. `EngagementScope` má pole `campaign_id` už od
 * P07 a kompilátor podle něj skládá `AND me.campaign_id = …` (viz
 * `compile/engagement-event.ts`, funkce `slowExists`). Nebylo tedy potřeba měnit
 * ani definici, ani vyhodnocení, jen tohle chybělo někomu složit dohromady.
 * Rozsah na kampaň jde mimo předpočítaný rollup `contact_engagement`, takže
 * kompilátor u něj hlásí `segment_slow_engagement`; u jedné kampaně to je
 * dotaz přes její vlastní oddíly, ne přes celou historii.
 */

export type CampaignSegmentKind = 'clicked' | 'not_opened';

export const CAMPAIGN_SEGMENT_KINDS: readonly CampaignSegmentKind[] = ['clicked', 'not_opened'];

export function isCampaignSegmentKind(value: unknown): value is CampaignSegmentKind {
  return typeof value === 'string' && (CAMPAIGN_SEGMENT_KINDS as readonly string[]).includes(value);
}

const group = (children: GroupNode['children']): SegmentAst => ({
  version: 1,
  root: { type: 'group', op: 'and', children },
});

/**
 * Definice segmentu „lidé, kteří v téhle kampani udělali (nebo neudělali) X".
 *
 * U `not_opened` jsou TŘI podmínky a žádná není navíc:
 *
 * 1. `sent did` drží množinu na příjemcích kampaně. Bez ní by „neotevřel"
 *    platilo i o všech, komu jsme kampaň nikdy neposlali, tedy skoro o celé
 *    databázi. Je to nejčastější chyba tohohle druhu segmentu a `presets.ts`
 *    na ni upozorňuje u předlohy „nikdy neotevřel".
 *
 * 2. `opened did_not` je vlastní otázka.
 *
 * 3. `clicked did_not` sladí segment s tím, co o téže kampani tvrdí report.
 *    Produkt počítá PROKLIK JAKO DŮKAZ OTEVŘENÍ: když ke zprávě nedorazilo
 *    otevření, ale někdo v ní klikl, `upsertMessageEngagement` otevření dopočítá
 *    (`impliedOpenFromClick` v `tracking/repo/engagement.repo.ts`) a do
 *    `campaign_stats.opens_unique` se započítá. Segment ale čte syrové
 *    `message_events`, kde takový řádek NENÍ. Bez třetí podmínky by tedy
 *    o člověku, kterého report ukazuje mezi těmi, kdo otevřeli, segment tvrdil,
 *    že neotevřel, a znovuposlání „nestihli jste" by dorazilo právě tomu, kdo
 *    na odkaz klikl. Ověřeno na skutečné kampani: nula událostí typu `open`,
 *    přitom report hlásí tři otevření, všechna dopočítaná z prokliku.
 */
export function campaignSegmentDefinition(
  kind: CampaignSegmentKind,
  campaignId: string,
): SegmentAst {
  const scope = { campaign_id: campaignId };

  if (kind === 'clicked') {
    // Příjemce se neověřuje: kdo v kampani klikl, ten ji z definice dostal.
    return group([
      {
        type: 'condition',
        field: { kind: 'engagement', metric: 'clicked', scope },
        operator: 'did',
      },
    ]);
  }

  return group([
    { type: 'condition', field: { kind: 'engagement', metric: 'sent', scope }, operator: 'did' },
    {
      type: 'condition',
      field: { kind: 'engagement', metric: 'opened', scope },
      operator: 'did_not',
    },
    {
      type: 'condition',
      field: { kind: 'engagement', metric: 'clicked', scope },
      operator: 'did_not',
    },
  ]);
}
