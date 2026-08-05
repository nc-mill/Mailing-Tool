/**
 * Kroky kampaně.
 *
 * Kroky NEJSOU průvodce, který se odbyde jednou při zakládání. Jsou to trvalé
 * části téže kampaně a chodí se mezi nimi tam a zpátky, kolikrát je potřeba.
 * Než tohle vzniklo, existoval krok 1 jen na `campaigns/new` a po založení
 * kampaně nebylo jak se k obsahu vrátit: detail se hlásil jako „Krok 2 z 2"
 * a jinam nevedl.
 *
 * POŘADÍ JE OD E-MAILU K ODESLÁNÍ, ne od formuláře k e-mailu. Kampaň začíná
 * tím, co uživatel doopravdy dělá: píše e-mail. Předmět, název a předhlavička
 * jsou popisky toho hotového e-mailu a patří za něj, ne před něj. Nastavení
 * (publikum, odesílatel, měření) je poslední, protože se řeší až ve chvíli,
 * kdy je co odeslat.
 *
 * PRVNÍ KROK JE SÁM EDITOR, ne rozcestník s odkazem do editoru. Bydlí proto na
 * VLASTNÍ ADRESE `/campaigns/{id}/content`, kdežto zbylé dva kroky jsou dva
 * panely jednoho formuláře na `/campaigns/{id}`. Není to nedůslednost: editor
 * je celoobrazovková aplikace s vlastním ukládáním a schovávat ho do panelu
 * formuláře, který se jen `hidden`, by znamenalo držet ho běžící i ve chvíli,
 * kdy uživatel vyplňuje publikum.
 *
 * Dřív byly kroky dva a ten první míchal dohromady předmět s odkazem do
 * editoru. Obsah e-mailu, tedy jediná věc, kvůli které kampaň vzniká, byl
 * v něm poslední položkou pod třemi textovými poli a vedl na jinou obrazovku,
 * ze které se uživatel vracel tlačítkem.
 *
 * Soubor je schválně bez `'use client'` a bez komponent: čte ho i stránka
 * na serveru, když z adresy vytahuje, který krok se má otevřít.
 */

export type CampaignStep = 'content' | 'basics' | 'settings';

/** Pořadí je pořadím kroků na obrazovce, z něj se počítá „Krok X z Y". */
export const CAMPAIGN_STEPS = ['content', 'basics', 'settings'] as const;

/** Jméno parametru v adrese. Krok patří do URL, aby šel poslat odkazem. */
export const STEP_PARAM = 'step';

/**
 * Krok, na kterém se kampaň otevírá, když adresa neříká jinak: OBSAH E-MAILU.
 *
 * Uživatel se do rozepsané kampaně vrací kvůli tomu, co v ní píše, ne kvůli
 * odesílacímu účtu. Zbylé kroky jsou na dosah jedním kliknutím.
 */
export const DEFAULT_CAMPAIGN_STEP: CampaignStep = 'content';

/**
 * Krok z adresy. Cokoli neznámého (překlep, stará adresa, prázdno) padá na
 * výchozí krok; obrazovka se kvůli parametru v URL nesmí rozbít ani hlásit chybu.
 *
 * Jména kroků `content` a `settings` zůstala i po přeskládání, takže starší
 * odkazy s `?step=settings` (kontrolní seznam před odesláním, uložené záložky)
 * míří pořád tam, kam mířily.
 */
export function parseCampaignStep(value: unknown): CampaignStep {
  return CAMPAIGN_STEPS.includes(value as CampaignStep)
    ? (value as CampaignStep)
    : DEFAULT_CAMPAIGN_STEP;
}

/**
 * Pole, která patří do kroku s předmětem. Zbytek formuláře je krok nastavení.
 *
 * Výčet je JMENOVITÝ a malý schválně: podle něj se pozná, na který krok
 * přepnout, když uložení vrátí chybu pole. Bez toho by chyba přistála ve
 * skrytém kroku, uživatel by viděl formulář beze změny a nevěděl proč.
 *
 * Krok obsahu tu není, protože nemá jediné pole formuláře: obsah se needituje
 * tady, ale v editoru, a převzetí šablony je samostatná akce s vlastní hláškou.
 */
const BASICS_FIELDS = new Set(['name', 'subject', 'preheader']);

export function stepOfField(field: string): CampaignStep {
  return BASICS_FIELDS.has(field) ? 'basics' : 'settings';
}

/**
 * Adresa kroku. Jediné místo, které ví, že krok obsahu je vlastní stránka
 * a zbylé dva kroky jsou parametr `?step=` na detailu kampaně.
 *
 * `basePath` je `/w/{slug}`, tedy tvar bez jazyka, protože odkazy skládá
 * `@mlain/i18n/navigation` a jazyk si doplní samo.
 */
export function campaignStepHref(basePath: string, campaignId: string, step: CampaignStep): string {
  const detail = `${basePath}/campaigns/${campaignId}`;
  return step === 'content' ? `${detail}/content` : `${detail}?${STEP_PARAM}=${step}`;
}
