import { validateLiquid } from '@mlain/contracts/liquid';
import { rootsForTemplateKind } from '@mlain/contracts/liquid/grammar';
import { ApiError, type ValidationIssue } from '../errors/api-error';

/**
 * Validace Liquidu v předmětu a preheaderu kampaně.
 *
 * PROČ TENHLE SOUBOR EXISTUJE (nález N1, 8. 8. 2026). Předmět a preheader byly
 * jediná uživatelská pole, která šla do renderu BEZ VALIDÁTORU: schéma bylo jen
 * `z.string().max(255)`. Sender ani prohlížeč přitom obojí renderují jako
 * plnohodnotnou Liquid šablonu, takže `{% include "../../../../app/.env" %}`
 * v předmětu doručilo obsah souboru do hlavičky Subject. Uniklo by tím
 * `SECRET_KEY`, kterým se podepisují tokeny všech projektů instalace.
 *
 * Uzavřený seznam tagů v obou enginech tuhle konkrétní cestu zavírá i bez téhle
 * validace. OBĚ VRSTVY JSOU PŘESTO POTŘEBA: seznam tagů chrání i data, která
 * v databázi už leží, tahle validace chrání i případ, kdy někdo v budoucnu
 * přidá třetí engine nebo vymění knihovnu. Jedna vrstva sama je jen tolerovaný
 * jednobodový výpadek.
 *
 * ÚROVEŇ JE `compiled`, NE `authored`, a je to schválně. Předmět není bloková
 * šablona z editoru: uživatel ho píše rovnou jako text a sender ho dostává
 * doslova, tedy je zároveň autorský i kompilovaný. Kdyby se validoval jako
 * autorský, spadl by na literálech ve filtrech a
 * `{{ contact.first_name | default: "kolego" }}`, který sender bez potíží
 * vyrenderuje, by se přestal dát uložit.
 *
 * `fields` se ZÁMĚRNĚ nepředává. Katalog polí projektu tady k dispozici není
 * a kdyby se doplnil neúplný, odmítl by legitimní vlastní atribut. Kontroluje
 * se tedy gramatika, tagy, filtry a kořeny, ne existence konkrétního pole; to
 * je přesně ta hranice, kde leží bezpečnost.
 */

/** Pole, která se validují, a jméno cesty v odpovědi. */
const INBOX_FIELDS = ['subject', 'preheader'] as const;

type InboxField = (typeof INBOX_FIELDS)[number];

/** Vstup je částečný: PATCH pošle jen to, co se opravdu mění. */
export type CampaignInboxInput = Partial<Record<InboxField, string | undefined>>;

function issuesFor(field: InboxField, source: string): ValidationIssue[] {
  const result = validateLiquid(source, {
    level: 'compiled',
    template_kind: 'campaign',
    roots: rootsForTemplateKind('campaign'),
    pointer: `/${field}`,
  });
  return result.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      path: field,
      code: issue.code,
      // Souřadnice se do zprávy píší proto, že u předmětu delšího než pár slov
      // je jinak z kódu chyby nepoznat, které místo ji způsobilo.
      message: `${issue.code} na řádku ${issue.span.line}, sloupci ${issue.span.col}`,
    }));
}

/**
 * Ověří předmět a preheader. Prázdný řetězec je platný stav (kampaň bez
 * předmětu existuje a předletová kontrola ji stejně nepustí), takže se
 * nevaliduje: `validateLiquid('')` je sice v pořádku, ale volání navíc mlží.
 */
export function assertCampaignInboxLiquid(input: CampaignInboxInput): void {
  const errors: ValidationIssue[] = [];
  for (const field of INBOX_FIELDS) {
    const value = input[field];
    if (value === undefined || value === '') continue;
    errors.push(...issuesFor(field, value));
  }
  if (errors.length > 0) throw new ApiError('validation_failed', { errors });
}
