import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';

/**
 * Společný základ všech veřejných stránek: kdo je odesílatel, v jakém jazyce se stránka
 * vykreslí a jakou barvu má tlačítko.
 *
 * Jazyk se bere z KONTAKTU, ne z prohlížeče (kapitola 8.9 části 6). Příjemce dostal
 * e-mail v češtině, takže čeká českou stránku; hlavička Accept-Language patří prohlížeči,
 * ne člověku, a na sdíleném počítači je úplně mimo.
 */
export type PublicBranding = {
  /**
   * Jméno ODESÍLATELE, tedy `sender_identities.from_name`. NIKDY `workspaces.name`.
   *
   * Je v tom skutečný rozdíl, ne slovíčkaření. Jméno projektu si člověk zakládá pro
   * sebe do postranního menu („Petr Osobní mail", „Klient Novák, faktury") a čeká, že
   * ho nikdo cizí neuvidí. Jméno odesílatele je naopak to, co příjemci UŽ VIDÍ ve
   * schránce v poli Od, takže na veřejné stránce nic neprozradí a navíc ji spojí
   * s e-mailem, kvůli kterému na ni člověk klikl.
   *
   * Do 7. 8. 2026 se sem bralo `workspaces.name` a svítilo na děkovací stránce
   * formuláře, na odhlašovací stránce i v titulku okna. Nahlásil to zadavatel větou
   * „to je moje osobní věc a ne že to budu zobrazovat na webu formuláře".
   *
   * Když projekt identitu odesílatele ještě nemá, zůstává prázdné a stránka
   * jméno nekreslí vůbec. Prázdno je tu správně: vymyslet náhradu by znamenalo
   * vrátit se k tomu, co se právě opravilo.
   */
  senderName: string;
  locale: string;
  brandColor: string | null;
};

export type PublicScope = {
  ctx: WorkspaceContext;
  branding: PublicBranding;
  /**
   * Nabízí projekt veřejné centrum předvoleb? Čte se z `settings.contacts`
   * (`public_preference_center`, výchozí zapnuto) a rozhoduje o tom, jestli stránka
   * odhlášení vůbec smí na předvolby odkázat. Odhlášení samo se tím NEŘÍDÍ.
   */
  preferenceCenter: boolean;
};

const FALLBACK_BRANDING: PublicBranding = {
  senderName: '',
  locale: 'cs',
  brandColor: null,
};

/**
 * Systémový kontext projektu z veřejného odkazu plus branding.
 *
 * Kontext vyrábí `createSystemContext` z P04, tedy jediná legitimní továrna mimo
 * přihlašovací cestu. Autorizaci nese podepsaný token nebo neuhodnutelný slug,
 * který volající ověřil DŘÍV, než sem sáhl.
 */
export async function publicScope(
  workspaceRef: string,
  job: string,
  contactLocale: string | null = null,
): Promise<PublicScope | null> {
  const ctx = createSystemContext(workspaceRef, job);
  const branding = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      from_name: string | null;
      locale: string;
      settings: unknown;
    }>(sql`
      SELECT si.from_name, w.locale, w.settings
        FROM workspaces w
        LEFT JOIN LATERAL (
          SELECT s.from_name
            FROM sender_identities s
           WHERE s.workspace_id = w.id
           ORDER BY s.is_default DESC, s.created_at ASC
           LIMIT 1
        ) si ON true
       WHERE w.id = ${ctx.workspaceId}::uuid AND w.deleted_at IS NULL
    `);
    return rows[0] ?? null;
  });
  if (branding === null) return null;

  const settings = (branding.settings ?? {}) as {
    branding?: { color?: unknown };
    contacts?: { public_preference_center?: unknown };
  };
  const color = settings.branding?.color;
  // Číst se musí přímo tady, ne přes `readContactsSettings`: veřejná stránka má na
  // ruce jen tenhle jeden dotaz a druhé kolo do databáze kvůli jednomu booleanu by
  // zaplatil každý příjemce, který klikne na odhlášení. Zapnuto je výchozí stav,
  // takže poškozené nebo starší nastavení nabídku předvoleb nesebere.
  const preferenceCenter = settings.contacts?.public_preference_center;

  return {
    ctx,
    branding: {
      senderName: branding.from_name ?? '',
      locale: contactLocale ?? branding.locale ?? FALLBACK_BRANDING.locale,
      brandColor: typeof color === 'string' ? color : null,
    },
    preferenceCenter: preferenceCenter !== false,
  };
}

/** Branding pro stránku, na které se projekt nepodařilo určit. Nesmí nic prozradit. */
export function anonymousBranding(): PublicBranding {
  return { ...FALLBACK_BRANDING };
}

export type ContactSnapshot = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  locale: string;
  attributes: Record<string, unknown>;
};

export async function loadContact(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<ContactSnapshot | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      locale: string;
      attributes: Record<string, unknown>;
    }>(sql`
      SELECT id, email::text AS email, first_name, last_name, locale, attributes
        FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      locale: row.locale,
      attributes: row.attributes ?? {},
    };
  });
}
