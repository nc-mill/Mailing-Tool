import { z } from 'zod';

/**
 * Popisek v libovolném počtu jazyků s povinným en.
 *
 * Pevná dvojice { cs, en } tu byla dřív a porušovala slib, že přidání jazyka nevyžaduje
 * změnu kódu ani migraci: zod.strict() by odmítl tělo s klíčem de, takže by projekt
 * v němčině nemohl popisek vůbec uložit. Klíč en zůstává povinný, protože na něm
 * stojí fallback při vykreslení.
 */
export const LocalizedTextSchema = z
  .object({ en: z.string().min(1).max(200) })
  .catchall(z.string().max(200));

export const FormFieldSchema = z
  .object({
    target: z.union([
      z.enum(['email', 'first_name', 'last_name', 'full_name', 'locale']),
      z.object({ attribute: z.string() }).strict(),
    ]),
    label: LocalizedTextSchema,
    placeholder: LocalizedTextSchema.optional(),
    required: z.boolean(),
    /**
     * Značka vstupu, tedy JAK se pole vykreslí. NENÍ to typ hodnoty: co se s hodnotou
     * stane, řídí definice vlastního pole v `contact_fields` a `coerceValue`.
     *
     * Rozšířeno o `textarea`, `url`, `tel` a `datetime`, aby měl protějšek každý typ
     * vlastního pole, který jde formulářem sbírat. Bez nich by se dlouhý text sbíral
     * jednořádkovým polem a datum s časem by přišlo jako text; obojí by uživatel zjistil
     * až z chybějících dat. Zbývá `multi_enum`, který protějšek NEMÁ a nemá ho schválně:
     * viz `FORM_FIELD_TYPE_FOR`.
     */
    type: z.enum([
      'text',
      'textarea',
      'email',
      'url',
      'tel',
      'select',
      'checkbox',
      'date',
      'datetime',
      'number',
      'hidden',
    ]),
    options: z
      .array(z.object({ value: z.string(), label: LocalizedTextSchema }).strict())
      .optional(),
    defaultValue: z.string().max(1000).optional(),
  })
  .strict();

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ ZOD 4. Plán píše `z.string().uuid()` a `z.string().url()`,
 * tedy tvar ze zodu 3. Repozitář jede na zodu 4.4.3, kde jsou obě metody přesunuté na
 * kořen (`z.uuid()`, `z.url()`) a řetězcová varianta je zastaralá. Chování je stejné,
 * mění se jen zápis; stejný tvar má i `api/schemas.ts`, kde je `export const Uuid = z.uuid()`.
 */
export const FormDefinitionSchema = z
  .object({
    name: z.string().min(1).max(200),
    fields: z.array(FormFieldSchema).max(15).default([]),
    design: z.record(z.string(), z.unknown()).default({}),
    custom_css: z.string().max(20000).nullable().default(null),
    list_ids: z.array(z.uuid()).default([]),
    tag_ids: z.array(z.uuid()).default([]),
    /**
     * Ve výchozím stavu ZAPNUTÉ. Vypnutí vyžaduje potvrzení dialogu s vysvětlením,
     * že bez potvrzovacího e-mailu může kdokoliv přihlásit cizí adresu.
     */
    double_opt_in: z.boolean().default(true),
    consent_text: z.string().max(2000).nullable().default(null),
    consent_required: z.boolean().default(true),
    legal_basis: z
      .enum(['consent', 'legitimate_interest', 'contract', 'soft_opt_in'])
      .default('consent'),
    honeypot_field: z.string().min(1).max(50).default('website'),
    min_fill_seconds: z.number().int().min(0).max(60).default(2),
    /** Prázdný seznam znamená libovolný původ, ale rozhraní u toho zobrazí varování. */
    allowed_origins: z.array(z.url()).default([]),
    /**
     * Ve výchozím stavu vypnutá a v rozhraní výslovně označená, protože posílá data
     * návštěvníka třetí straně. Do výchozího buildu se nepřidává žádná závislost,
     * integrace je jen HTTP volání na ověřovací endpoint.
     */
    captcha_provider: z.enum(['none', 'turnstile', 'hcaptcha']).default('none'),
    captcha_config: z.record(z.string(), z.unknown()).nullable().default(null),
    /**
     * Šablona e-mailu, který přijde člověku po vyplnění formuláře. Skládá se
     * v editoru e-mailů, takže do ní jde dát cokoliv, typicky odkaz ke stažení
     * slíbeného souboru. `null` znamená, že formulář žádný e-mail neposílá.
     */
    delivery_template_id: z.uuid().nullable().default(null),
    redirect_url: z.url().nullable().default(null),
    /**
     * Veřejné stránky, které formulář ukáže návštěvníkovi. Jsou to odkazy na
     * `templates` s `kind = 'page'`, tedy dokumenty z téhož editoru jako e-maily.
     *
     * `null` ZNAMENÁ VESTAVĚNÝ TEXT, tedy dnešní chování, a je to výchozí stav.
     * Formulář, který o stránky nepožádal, se nezmění.
     *
     * VÝBĚR JE U KAŽDÉHO FORMULÁŘE ZVLÁŠŤ (požadavek zadavatele z oddílu 0.3
     * plánu). Šablona je sdílená, odkaz na ni ne: dva formuláře můžou ukazovat
     * na tutéž stránku i na dvě různé a přehození u jednoho se druhého nedotkne.
     * Proto je to trojice klíčů tady, ne jedno nastavení projektu.
     *
     * `thanks_template_id` vlastní VÝHRADNĚ formulář, protože děkovací stránka
     * je cíl přesměrování bez tokenu a seznam o ní nemá jak rozhodnout. Zbylé
     * dvě má formulář jen jako PRVNÍ volbu; když je nemá, sáhne se na seznam
     * a teprve pak na vestavěný text (pořadí hledání v `public/page-template.ts`).
     * Stránka po odhlášení tady schválně není: chodí se na ni z odkazu
     * v e-mailu, takže není podle čeho určit, který formulář by ji vlastnil.
     *
     * CIZÍ KLÍČ TO MÍT NEMŮŽE, je to jsonb. Platnost proto ověřuje doména při
     * čtení: smazaná i neplatná šablona spadne na vestavěný text a zaloguje se.
     * Nikdy nesmí přihlášení skončit chybou proto, že si někdo smazal návrh.
     */
    thanks_template_id: z.uuid().nullable().default(null),
    confirmed_template_id: z.uuid().nullable().default(null),
    already_subscribed_template_id: z.uuid().nullable().default(null),
    success_message: LocalizedTextSchema.partial().default({}),
    active: z.boolean().default(true),
  })
  .strict();

export type FormDefinition = z.infer<typeof FormDefinitionSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;

export type FieldValidation = { ok: true } | { ok: false; code: 'unknown_field_key'; path: string };

/**
 * Formulář smí zapisovat JEN do polí, která existují v contact_fields, plus do pevných
 * polí kontaktu. Kontrola běží už při UKLÁDÁNÍ formuláře, ne až při odeslání.
 *
 * Bez tohohle pravidla by se formulář stal libovolným úložištěm dat bez schématu
 * a uživatel by na chybu přišel teprve tím, že by mu chyběla data.
 */
export function validateFormFields(
  fields: readonly FormField[],
  catalogKeys: readonly string[],
): FieldValidation {
  for (const [index, field] of fields.entries()) {
    if (typeof field.target === 'object' && !catalogKeys.includes(field.target.attribute)) {
      return { ok: false, code: 'unknown_field_key', path: `fields.${index}.target` };
    }
  }
  return { ok: true };
}

/**
 * Značka vstupu pro daný typ vlastního pole kontaktu.
 *
 * VZNIKLO Z NESOULADU, KTERÝ SE MUSEL ROZHODNOUT. `contact_fields` zná jedenáct typů,
 * formulář jich vykresluje deset. Chybí protějšek pro `multi_enum` a vrací se pro něj
 * `null`, což znamená „tímhle formulářem se sbírat NEDÁ".
 *
 * Proč zrovna `multi_enum` vypadl: je to jediný typ, jehož hodnota je POLE. Odeslání
 * formuláře přenáší dvojice klíč a hodnota, takže by se buď přenesla jen poslední
 * vybraná položka (tichá ztráta dat), nebo by se musel zavést vlastní tvar zápisu
 * a rozumět mu na obou stranách. Tichá ztráta je nepřijatelná a vlastní tvar je práce,
 * která si zaslouží vlastní rozhodnutí, ne přílepek. Rozhraní proto takové pole
 * v nabídce vůbec nenabídne a řekne proč; nikdy nevznikne formulář, který se tváří,
 * že sbírá víc hodnot, a uloží jednu.
 *
 * `long_text` míří na `textarea`, `datetime` na `datetime`, `url` na `url`,
 * `phone` na `tel`. Všechny čtyři byly dřív obyčejný `text`.
 */
export function formFieldTypeFor(fieldType: string): FormField['type'] | null {
  switch (fieldType) {
    case 'text':
      return 'text';
    case 'long_text':
      return 'textarea';
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'enum':
      return 'select';
    case 'url':
      return 'url';
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    // `multi_enum` schválně chybí, viz hlavička.
    default:
      return null;
  }
}

/** Jméno pole ve formuláři, tedy klíč, pod kterým hodnota přijde v těle požadavku. */
export function formFieldName(field: FormField): string {
  return typeof field.target === 'object' ? `attr_${field.target.attribute}` : field.target;
}

/**
 * Popisek v jazyce stránky s fallbackem na en. Klíč `en` je ve schématu povinný právě
 * proto, aby fallback nikdy nespadl na prázdný řetězec.
 */
export function localizedText(text: Record<string, string> | undefined, locale: string): string {
  if (text === undefined) return '';
  return text[locale] ?? text[locale.split('-')[0] ?? locale] ?? text['en'] ?? '';
}
