import { and, isNull, ne } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { designHash } from '@mlain/emails/document/canonical';
import type { Document } from '@mlain/emails/document/types';
import type { BrandProfileSummary } from '../brand/repo/profiles.repo';
import { brandProfileTheme, brandThemeParts } from '../brand/theme';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';
import { assetIdsInDocument, loadAssetRefs } from './assets';
import { redressTemplateRow, validationProfileFor } from './repository';
import { validateTemplateDocument } from './validate';

/**
 * PŘEVLEČENÍ ULOŽENÝCH E-MAILŮ DO BAREV ZNAČKY.
 *
 * PROČ TO EXISTUJE. Motiv je součást uloženého dokumentu, ne věc kompilace,
 * takže samotné doplnění značky při ZAKLÁDÁNÍ řeší jen nové e-maily. Stížnost
 * ale zněla na ty existující: „změnil jsem barvy značky a v kampani mám pořád
 * staré". Bez převlékání by se tatáž stížnost vrátila při každé další změně
 * značky, protože i dnes založená kampaň má barvy zapečené.
 *
 * Specifikace to popisuje jako vlastnost, ne jako opravu: „Theme je jediné
 * místo, kde se drží vizuální styl... převlečení šablony do jiné značky je
 * změna jednoho objektu" (`docs/superpowers/specs/parts/03-obsah.md`, 3.1.4).
 *
 * CO SE PŘEVLÉKÁ A CO NE, ROZHODUJE `brandThemeParts` v doméně značky, ne tenhle
 * soubor. Je to totéž pravidlo, jaké platí při ZAKLÁDÁNÍ dokumentu, a schválně:
 * kdyby se rozešla, dostal by nový e-mail jiné barvy než ten, který se převlékl,
 * a rozdíl by nešel vysvětlit. Zkráceně to pravidlo zní „převezmi hodnotu ze
 * značky jen tam, kde dokument pořád drží to, co by dala značka předchozí, nebo
 * výchozí hodnotu"; podrobnosti i důvody jsou u něj.
 */

/** Kolik dokumentů se prošlo a u kolika se opravdu něco změnilo. */
export type RedressResult = { scanned: number; changed: number };

/**
 * Dokumenty, na které se sahat nesmí, protože nesou obsah kampaně, která už
 * není rozepsaná.
 *
 * Co odešlo, se nepřepisuje. Doručenou podobu sice drží `campaigns.compiled_html`
 * a ta se převlečením nezmění, ale obsah, který uvidí ten, kdo si odeslanou
 * kampaň otevře, ano, a rozešel by se s tím, co lidem přišlo.
 *
 * ZAMYKÁ SE PODLE ODKAZU Z KAMPANĚ, NE PODLE `kind`, a je to oprava dřívější
 * úvahy. Nabízelo se zamknout jen pracovní kopie (`kind = 'system'`) s tím, že
 * knihovní šablona je opakovaně použitelný materiál a svou kopii si kampaň drží
 * ve `campaigns.design`. Jenže `campaigns.design` vyplněný BÝT NEMUSÍ: ukázková
 * data zakládají odeslanou kampaň přímým SQL a vlastní kopii ani `compiled_html`
 * jí nedávají (`demo/seed.ts`). Naměřeno na běžící instalaci, kampaň „Ukázka:
 * Letní výprodej" ve stavu `sent`. U ní je ta šablona JEDINÝ záznam o tom, co
 * kampaň obsahovala, a převlečení by ho přepsalo.
 *
 * Cena toho zpřísnění je vědomá: knihovní šablona, ze které kdysi vyšla odeslaná
 * kampaň, zůstane ve starých barvách a převlékne se až tím, že ji někdo otevře
 * a uloží. To je vidět a dá se to spravit, kdežto tiše přepsaný obsah odeslané
 * kampaně ne.
 */
async function lockedByCampaign(tx: Tx, ctx: WorkspaceContext): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ templateId: schema.campaigns.templateId })
    .from(schema.campaigns)
    .where(
      and(
        wsEq(ctx, schema.campaigns),
        isNull(schema.campaigns.deletedAt),
        ne(schema.campaigns.status, 'draft'),
      ),
    );
  return new Set(rows.map((row) => row.templateId).filter((id): id is string => id !== null));
}

/**
 * Převleče uložené e-maily projektu do barev značky.
 *
 * Volá se z uložení značky, tedy z místa, kde je k dispozici i ta PŘEDCHOZÍ
 * značka; bez ní by nešlo poznat zděděné písmo od ručně nastaveného.
 *
 * `updated_at` se ZÁMĚRNĚ neposouvá, stejně jako u `restoreTemplateRow`
 * a u migrací 0019 a 0021: převlečení není úprava od uživatele a knihovna
 * řazená podle „Změněno" by se po změně značky celá přerovnala, jako by v noci
 * někdo sáhl na všechny šablony.
 *
 * Odkazy na obrázky se nesynchronizují, a je to správně: mění se barvy, písmo
 * a rádius, tedy nic, co by mohlo přidat nebo ubrat `assetId`.
 */
export async function redressTemplatesToBrand(
  tx: Tx,
  ctx: WorkspaceContext,
  input: {
    /** Značka platná PŘED uložením. `null`, když projekt žádnou neměl. */
    previous: BrandProfileSummary | null;
    next: BrandProfileSummary;
    fields: FieldCatalog;
  },
): Promise<RedressResult> {
  const next = brandProfileTheme(input.next);
  const previous = input.previous === null ? null : brandProfileTheme(input.previous);
  const locked = await lockedByCampaign(tx, ctx);

  const rows = await tx
    .select()
    .from(schema.templates)
    .where(and(wsEq(ctx, schema.templates), isNull(schema.templates.deletedAt)));

  let changed = 0;
  for (const row of rows) {
    if (locked.has(row.id)) continue;

    const document = row.design as Document;
    const parts = brandThemeParts(document.theme, next, previous);
    const updated: Document = { ...document, theme: { ...document.theme, ...parts } };

    // Otisk je jediná spolehlivá odpověď na otázku „změnilo se něco".
    // Bez něj by se přepisovaly i řádky, které už v barvách značky jsou,
    // a druhé uložení téže značky by vypadalo jako hromadná změna.
    const hash = designHash(updated);
    if (row.designHash.equals(hash)) continue;

    /*
     * Stav validace se PŘEPOČÍTÁVÁ, není to nadpráce. Kontrast se počítá
     * z motivu dokumentu (`checkSemanticFields`), takže po změně barev by
     * uložený stav přestal platit. Knihovna by hlásila „v pořádku" a přitom
     * by odcházely nečitelné e-maily, a nic by to nechytilo, protože
     * převlečení není zápis od uživatele, který by přepočet spustil.
     */
    const assets = await loadAssetRefs(tx, ctx, assetIdsInDocument(updated));
    const validation = validateTemplateDocument(updated, {
      templateKind: validationProfileFor(row.kind),
      fields: input.fields,
      assetIds: new Set(Object.keys(assets)),
    });

    await redressTemplateRow(tx, ctx, row.id, {
      design: updated,
      designHash: hash,
      state: validation.state,
      errors: validation.issues,
    });
    changed += 1;
  }

  return { scanned: rows.length, changed };
}
