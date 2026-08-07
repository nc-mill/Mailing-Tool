import { RENDER_DATA_MAX_BYTES } from '../constants';

/**
 * Merge tagy, ktere se do render_data NIKDY nedostanou:
 *  - contact.email: sender ho bere z messages.email. Kdyby byl na dvou mistech, mohl by
 *    se rozejit a obalkova adresa je jedina, ktera musi byt jednoznacna.
 *  - unsubscribe_url a webview_url: stavi je sender z podepsaneho tokenu (kontrakt 3).
 *    Kdyby je stavela aplikace, byla by to druha implementace tehoz podpisu a zhruba
 *    117 znaku URL navic u kazde zpravy, tedy pres 100 MB u milionove kampane.
 *
 * TOTEZ PLATI PRO CELE KORENY `campaign` A `workspace`, jen se to nedrzi vyctem: smycka
 * nize bere vyhradne cesty pod `contact.`, takze `campaign.name`, `campaign.subject`,
 * `workspace.name` ani `workspace.sender_address` se nesnapshotuji. NENI TO OPOMENUTI.
 * Jsou konstantni pro celou kampan, takze kopie do kazde zpravy by u milionove kampane
 * stala stovky megabajtu kvuli udaji, ktery se nemeni, a `render_data` ma na zpravu strop.
 * Dodava je sender z hlavicky kampane (`setCampaignRoots` v `apps/sender/internal/app/worker.go`,
 * sloupce v `StmtCampaignHeader`) a v aplikaci totez dela
 * `packages/core/src/campaigns/render-roots.ts` pro webovou podobu zpravy a report.
 * Kdo sem ty koreny doplni, prida megabajty a nic tim neopravi.
 */
export const RENDER_DATA_EXCLUDED_FIELDS = [
  'contact.email',
  'unsubscribe_url',
  'webview_url',
] as const;

export type ContactSnapshotSource = {
  id: string;
  email: string;
  attributes?: Record<string, unknown> | null;
} & Record<string, unknown>;

export type RenderDataResult = {
  data: { contact: Record<string, unknown> & { attr?: Record<string, unknown> } };
  bytes: number;
  tooLarge: boolean;
  errorCode?: 'render_data_too_large';
};

/**
 * Sloupce tabulky `contacts`, ktere se smi dostat do kandidatskeho dotazu materializace.
 *
 * SEZNAM JE BEZPECNOSTNI HRANICE, ne pohodli. `renderDataColumns` je jediny zdroj
 * nazvu sloupcu, ktere `materializeBatch` sklada do SELECT jako TEXT (parametrem
 * se sloupec predat neda). Cesty prichazeji z `compile_meta`, tedy z ulozeneho
 * vysledku kompilace, a bez tohohle filtru by stacil zapis do te struktury k tomu,
 * aby se do dotazu dostal cizi identifikator. Neznamy nazev se proto ZAHAZUJE.
 *
 * Druhy ucel je odolnost: kdyby sem propadl sloupec, ktery v tabulce neexistuje,
 * spadne cely SELECT na 42703 a kampan se nezmaterializuje ANI O RADEK. Zahozeni
 * je horsi jen o prazdnou hodnotu, coz je presne to, co se stane u pole, ktere
 * sablona nesmi mit.
 *
 * Obsah je zrcadlo `FIRST_CLASS_FIELDS` v `contacts/fields/catalog.ts`, tedy toho,
 * co uzivateli nabizi paletka personalizace, MINUS `email` (ten je ve vyctu
 * `RENDER_DATA_EXCLUDED_FIELDS` vys), PLUS `attributes` pro `contact.attr.*`.
 * Ze se ty dva seznamy nerozejdou, hlida test `render-data.test.ts`; kdo prida
 * pole do katalogu a sem ne, dostane cerveny test misto tiche prazdne hodnoty
 * v odeslane zprave.
 *
 * Interni sloupce (status, source, vocative_confidence, email_fingerprints,
 * sloupce s _at krome created_at) tu ZAMERNE nejsou, stejne jako v katalogu.
 */
export const SNAPSHOTTABLE_CONTACT_COLUMNS = [
  'first_name',
  'last_name',
  'middle_name',
  'title_prefix',
  'title_suffix',
  'gender',
  'first_name_vocative',
  'last_name_vocative',
  'greeting',
  'locale',
  'created_at',
  'attributes',
] as const;

const SNAPSHOTTABLE = new Set<string>(SNAPSHOTTABLE_CONTACT_COLUMNS);

/**
 * Sloupce, ktere se NESMI vzit ze SELECT syrove, protoze jsou to casova razitka.
 *
 * Ovladac vraci `timestamptz` retezcem v postgresovem tvaru
 * „2026-08-07 09:57:51.034352+00", tedy s MEZEROU misto T. Filtr `date` v senderu
 * je pevne na RFC 3339 (`parseDateInput` v `apps/sender/internal/liquidx/datefilter.go`)
 * a pro neplatny vstup vraci ZAMERNE prazdny retezec misto chyby, takze
 * `{{ contact.created_at | date: "%d.%m.%Y" }}` vyrenderuje PRAZDNO a nic nespadne.
 * Bez filtru by se do zpravy dostal ten syrovy tvar i s mikrosekundami.
 *
 * Nahled v editoru pritom tutez hodnotu dodava pres `toISOString()`
 * (`templates/api/preview-data.ts`), takze bez teto normalizace ukazuje nahled
 * datum a odeslana zprava prazdno. Presne ten rozchod, kteremu ma branit
 * spolecne `prepareRenderData`.
 *
 * `to_char` s vyslovnym UTC, ne `to_json`: vystup `to_json` zavisi na nastaveni
 * `DateStyle` spojeni, kdezto tenhle tvar je stejny vzdy.
 */
export const ISO_DATE_CONTACT_COLUMNS = ['created_at'] as const;

const ISO_DATE = new Set<string>(ISO_DATE_CONTACT_COLUMNS);

/**
 * Jedna polozka do seznamu sloupcu kandidatskeho dotazu. `alias` je alias tabulky
 * contacts v tom dotazu; nazev sloupce uz je overeny proti SNAPSHOTTABLE_CONTACT_COLUMNS.
 */
export function renderDataSelectItem(column: string, alias: string): string {
  if (!ISO_DATE.has(column)) return `${alias}.${column}`;
  return `to_char(${alias}.${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ${column}`;
}

/**
 * Ktere sloupce contacts musi umet dodat kandidatsky dotaz pro dane merge tagy.
 *
 * Vysledek je SETRIDENY, aby z tehoz planu vzesel bajt po bajtu tentyz SELECT.
 * Poradi z mnoziny je jinak dane poradim znacek v sablone, takze dve kampane
 * nad stejnymi sloupci daji dva ruzne texty dotazu a planovac si je kesuje zvlast.
 */
export function renderDataColumns(usedFields: readonly string[]): string[] {
  const cols = new Set<string>();
  for (const f of usedFields) {
    if ((RENDER_DATA_EXCLUDED_FIELDS as readonly string[]).includes(f)) continue;
    const parts = f.split('.');
    if (parts[0] !== 'contact') continue;
    if (parts[1] === 'attr') cols.add('attributes');
    else if (parts.length === 2 && SNAPSHOTTABLE.has(parts[1]!)) cols.add(parts[1]!);
  }
  return [...cols].sort();
}

export function buildRenderData(
  contact: ContactSnapshotSource,
  usedFields: readonly string[],
): RenderDataResult {
  const out: Record<string, unknown> & { attr?: Record<string, unknown> } = {};

  for (const field of usedFields) {
    if ((RENDER_DATA_EXCLUDED_FIELDS as readonly string[]).includes(field)) continue;
    const parts = field.split('.');
    if (parts[0] !== 'contact') continue;

    if (parts.length === 2) {
      out[parts[1]!] = normalize(contact[parts[1]!]);
      continue;
    }
    if (parts.length === 3 && parts[1] === 'attr') {
      out.attr ??= {};
      out.attr[parts[2]!] = normalize((contact.attributes ?? {})[parts[2]!]);
      continue;
    }
    throw new Error(
      `Merge tag ${field} má víc než dvě úrovně. Liquid subset neumí vnořené cykly, hlubší struktury se nesnapshotují.`,
    );
  }

  const data = { contact: out };
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > RENDER_DATA_MAX_BYTES) {
    return { data, bytes, tooLarge: true, errorCode: 'render_data_too_large' };
  }
  return { data, bytes, tooLarge: false };
}

/**
 * Hodnota, ktera je NULL, se zapisuje jako null, ne vynechava. Sender pak rozlisi
 * "pole neexistuje" (chyba sablony) od "pole je prazdne" (normalni stav, resi | default:).
 */
function normalize(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
