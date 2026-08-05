import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { WorkspaceContext } from '../identity/types';
import { withWorkspace, type Tx } from '../tx';

/**
 * Nastavení projektu vlastněná doménou kontaktů. Ukládá se do workspaces.settings.contacts,
 * Vlastní jen větev `contacts`; větve `privacy` a ostatní vlastní jejich domény.
 * Klíče jsou snake_case, protože nastavení jde ven přes API (konvence 4.1 části 1).
 *
 * Vykání a tykání zde NENÍ. Čte se ze sloupce workspaces.address_form, který vlastní část 1.
 * Výchozí jazyk kontaktu zde také není, bere se z workspaces.locale.
 */
export const ContactsWorkspaceSettingsSchema = z
  .object({
    /** Podle čeho se skládá oslovení: křestním jménem, nebo příjmením. */
    salutation_by: z.enum(['first_name', 'surname']).default('first_name'),
    /**
     * strict: vokativ se použije jen při jistotě 'high'.
     * balanced: použije se i při jistotě 'low'.
     *
     * Výchozí hodnota je 'strict' podle rozhodnutí zadavatele
     * (ROZHODNUTI-PRO-ZADAVATELE.md, kapitola 3c, "Odpovědi na otázky části 2"):
     * "Při nízké jistotě neutrální Dobrý den." Otevřená otázka O1 části 2 je tím uzavřená.
     */
    vocative_policy: z.enum(['strict', 'balanced']).default('strict'),
    /** Výchozí země pro normalizaci telefonních čísel, ISO 3166-1 alpha-2. */
    default_country: z.string().length(2).nullable().default('CZ'),
    number_format: z.enum(['auto', 'cs', 'en']).default('auto'),
    date_format: z.enum(['auto', 'cs', 'en']).default('cs'),
    export_encoding: z.enum(['utf-8-bom', 'utf-8', 'windows-1250']).default('utf-8-bom'),
    export_delimiter: z.enum([';', ',']).default(';'),
    /** Strop počtu kontaktů v projektu. null znamená bez stropu. */
    contact_limit: z.number().int().positive().nullable().default(null),
    require_consent_on_import: z.boolean().default(true),
    /**
     * Nabízí se příjemcům veřejné centrum předvoleb `/p/{token}`?
     *
     * Když je vypnuté, zmizí odkaz „Nastavit předvolby" z patičky e-mailu i ze stránky
     * odhlášení a samotná stránka `/p/{token}` nabídne JEN odhlášení. Je to výslovné
     * přání zadavatele: „někdy to prostě nechci nabízet, jen možnost odhlásit se, pak
     * se to nesmí objevit ani v patičce mailu."
     *
     * Výchozí hodnota je `true`, a je to jiné rozhodnutí než u `lists.public_visible`.
     * Bezpečnostní vada byla v tom, že se KDOKOLI mohl sám přihlásit do libovolného
     * seznamu; tu zavírá výchozí `false` u seznamu. Samotné centrum předvoleb žádné
     * oprávnění neuděluje, jen dovoluje příjemci upravit jazyk, jméno, frekvenci
     * a požádat o svá data, takže jeho vypnutí příjemci škodí, ne pomáhá. Vypnout ho
     * je proto vědomá volba správce, ne výchozí stav.
     *
     * ODHLÁŠENÍ TENHLE PŘEPÍNAČ NEŘÍDÍ. Odkaz na odhlášení v patičce ani stránka
     * `/u/{token}` se jím neovlivňují a ovlivňovat nesmí: je to zákonná povinnost.
     */
    public_preference_center: z.boolean().default(true),
  })
  .strict();

export type ContactsWorkspaceSettings = z.infer<typeof ContactsWorkspaceSettingsSchema>;

/** Výchozí podoba nastavení. Počítá se jednou, protože je to čistá konstanta. */
const DEFAULT_SETTINGS: ContactsWorkspaceSettings = ContactsWorkspaceSettingsSchema.parse({});

/**
 * Přečte větev `contacts` z `workspaces.settings` a doplní výchozí hodnoty.
 *
 * PROČ TADY A NE V SDÍLENÉM SCHÉMATU. Sloupec `workspaces.settings` je `jsonb` bez
 * zod schématu a P03 ho jako celek nevaliduje. Dřívější znění tohohle plánu tvrdilo,
 * že se větev „slučuje do `WorkspaceSettingsSchema` v `packages/db`"; taková konstanta
 * ale neexistuje. Každá doména proto parsuje **jen svou větev** a cizí větve nechává
 * být, což je i jediný tvar, který nevyžaduje, aby se čtyři plány dohodly na jednom
 * souboru.
 *
 * `.catch()` je tu schválně: poškozená nebo starší podoba nastavení nesmí shodit
 * zápis kontaktu. Vrátí se výchozí hodnoty a nekonzistence se řeší v nastavení
 * projektu, ne uprostřed importu.
 */
export async function readContactsSettings(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<ContactsWorkspaceSettings> {
  const { rows } = await tx.execute<{ contacts: unknown }>(sql`
    SELECT settings -> 'contacts' AS contacts
      FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
  `);
  return ContactsWorkspaceSettingsSchema.catch(DEFAULT_SETTINGS).parse(rows[0]?.contacts ?? {});
}

// Obálka `systemContext(workspaceId, job)` tady bývala, ale neměla jediného
// volajícího a byla to jen delegace na `createSystemContext` z P04.
//
// Smazaná je schválně, ne kvůli zelenému testu. Kontext izolace projektu se
// z holého řetězce smí vyrobit na JEDINÉM místě, protože branded typ je jedna
// ze dvou vrstev té izolace. Každý další vstup je místo, kde se dá vyrobit
// kontext, který nikdo neověřil. Systémové běhy téhle domény si ho vezmou
// přímo z `createSystemContext` v `packages/core/src/identity/context.ts`.
//
// Hlídá to test `scope.test.ts`, který zakazuje exportovanou funkci mimo
// `packages/core/src/tx` s parametrem `workspaceId: string`.

/** Tvar oslovení je kombinace workspaces.address_form a settings.contacts.salutation_by. */
export type AddressForm = 'formal' | 'informal';

/**
 * ŘEŠÍ PROJEKT OSLOVENÍ A 5. PÁD VŮBEC?
 *
 * Sloupec, ne větev v `settings`, a je to schválně: čte ho i doména identity,
 * která ho vydává v `GET /api/v1/workspaces/{id}`, a ta podle pravidla nahoře
 * tohohle souboru nesmí parsovat větev `contacts`. Podrobné zdůvodnění je
 * v migraci `0020_workspaces_greeting_enabled.sql`.
 *
 * VYPNUTO NEZNAMENÁ NEPOČÍTAT. `resolveName` běží dál při každém zápisu
 * kontaktu, sloupce `greeting`, `first_name_vocative` a `vocative_locked`
 * zůstávají naplněné. Kdyby se přestalo počítat, znamenalo by zapnutí zpátky
 * přepočet celé databáze, ručně potvrzené tvary by se ztratily a šablona
 * s `{{ contact.greeting }}` by mezitím posílala prázdno.
 *
 * Chybějící řádek projektu se čte jako `true`: raději nabídnout víc, než
 * potichu schovat data, o kterých uživatel ví, že je má.
 */
export async function readGreetingEnabled(tx: Tx, ctx: WorkspaceContext): Promise<boolean> {
  const { rows } = await tx.execute<{ greeting_enabled: boolean }>(sql`
    SELECT greeting_enabled FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
  `);
  return rows[0]?.greeting_enabled ?? true;
}

/** Totéž pro volající, kteří vlastní transakci nemají. */
export async function isGreetingEnabled(ctx: WorkspaceContext): Promise<boolean> {
  return withWorkspace(ctx, (tx) => readGreetingEnabled(tx, ctx));
}
