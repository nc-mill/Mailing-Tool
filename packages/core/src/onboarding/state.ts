import { sql } from 'drizzle-orm';
import { DEMO_SOURCE_REF } from '../demo/manifest';
import type { Tx } from '../tx';
import { ONBOARDING_STEP_IDS, type OnboardingState, type OnboardingStep } from './types';

type Flags = {
  hasProvider: boolean;
  hasRealContacts: boolean;
  hasTemplate: boolean;
  hasTestSend: boolean;
  hasSentCampaign: boolean;
};

/**
 * VŠECHNY funkce v tomhle souboru berou `tx: Tx`, ne URL databáze.
 *
 * Je to jediná bezpečná varianta a plyne přímo z izolace projektů: každá
 * tabulka, na kterou se tady sahá, má politiku `ws_isolation` a `workspaces`
 * má `ws_isolation_self`. Bez nastaveného `mlain.workspace_id` vrátí dotaz
 * NULA ŘÁDKŮ, exit 0 a žádnou chybu, takže by panel onboardingu ukazoval
 * pět neodškrtnutých kroků i v projektu, kde je hotovo všechno, a nikdo by
 * se nedozvěděl proč.
 *
 * Kontext nastavuje volající přes `withWorkspace(ctx, tx => ...)`, tedy tatáž
 * obálka, kterou používá zbytek aplikace.
 *
 * Ukázkové kontakty krok „Přidejte kontakty" schválně neodškrtávají. Ukázková
 * data mají ukázat, jak produkt vypadá, ne předstírat, že je nastavení hotové.
 * Kdyby se krok odškrtl, uživatel by dostal zelenou fajfku za práci,
 * kterou neudělal, a přišel by o jediné vodítko, co ještě chybí.
 */
async function loadFlags(tx: Tx, workspaceId: string): Promise<Flags | null> {
  const { rows: ws } = await tx.execute<{ id: string }>(
    sql`SELECT id FROM workspaces WHERE id = ${workspaceId} AND deleted_at IS NULL`,
  );
  if (ws.length === 0) return null;

  // Zkušební odeslání se pozná podle outboxu, ne podle sloupce na kampani:
  // `campaigns.last_test_sent_at` ve schématu NEEXISTUJE. P03 má pro tenhle
  // účel `messages.kind` s hodnotami 'campaign' a 'test' a částečný index nad
  // pending testy. Zavádět kvůli tomu nový sloupec by znamenalo migraci,
  // kterou vlastní P03, a sender by do něj stejně nesměl zapsat: na
  // `campaigns` má jen sloupcový UPDATE na status a pause_reason.
  const { rows } = await tx.execute<{
    providers: number;
    real_contacts: number;
    templates: number;
    test_sends: number;
    sent_campaigns: number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM sending_providers WHERE workspace_id = ${workspaceId})::int
        AS providers,
      (SELECT count(*) FROM contacts
        WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
          AND source_ref IS DISTINCT FROM ${DEMO_SOURCE_REF})::int AS real_contacts,
      (SELECT count(*) FROM templates
        WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL)::int AS templates,
      (SELECT count(*) FROM messages
        WHERE workspace_id = ${workspaceId} AND kind = 'test'
          AND sent_at IS NOT NULL)::int AS test_sends,
      (SELECT count(*) FROM campaigns
        WHERE workspace_id = ${workspaceId}
          AND status IN ('sending','sent'))::int AS sent_campaigns`);

  const row = rows[0]!;
  return {
    hasProvider: row.providers > 0,
    hasRealContacts: row.real_contacts > 0,
    hasTemplate: row.templates > 0,
    hasTestSend: row.test_sends > 0,
    hasSentCampaign: row.sent_campaigns > 0,
  };
}

async function loadPanelFlags(
  tx: Tx,
  workspaceId: string,
): Promise<{ hidden: boolean; finishedDismissed: boolean }> {
  const { rows } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`SELECT settings FROM workspaces WHERE id = ${workspaceId}`,
  );
  const onboarding = (rows[0]?.settings['onboarding'] ?? {}) as {
    hidden?: boolean;
    finishedDismissed?: boolean;
  };
  return {
    hidden: onboarding.hidden === true,
    finishedDismissed: onboarding.finishedDismissed === true,
  };
}

export async function loadOnboardingState(
  tx: Tx,
  workspaceId: string,
): Promise<OnboardingState | null> {
  const flags = await loadFlags(tx, workspaceId);
  if (flags === null) return null;
  const panel = await loadPanelFlags(tx, workspaceId);

  const done: Record<(typeof ONBOARDING_STEP_IDS)[number], boolean> = {
    sending: flags.hasProvider,
    contacts: flags.hasRealContacts,
    template: flags.hasTemplate,
    testSend: flags.hasTestSend,
    firstCampaign: flags.hasSentCampaign,
  };
  const href: Record<(typeof ONBOARDING_STEP_IDS)[number], string> = {
    sending: 'settings/sending',
    contacts: 'contacts/import',
    template: 'templates/new',
    testSend: 'campaigns',
    firstCampaign: 'campaigns',
  };

  const steps: OnboardingStep[] = ONBOARDING_STEP_IDS.map((id) => ({
    id,
    done: done[id],
    href: href[id],
    secondaryHref: id === 'contacts' ? 'contacts?demo=1' : null,
  }));

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: steps.length,
    finished: flags.hasSentCampaign,
    hidden: panel.hidden,
    finishedDismissed: panel.finishedDismissed,
  };
}

/**
 * POZOR na `jsonb_set` a chybějící mezistupeň:
 *
 *   jsonb_set('{}', '{onboarding,hidden}', to_jsonb(true), true)  ->  {}
 *
 * Čtvrtý argument `create_missing` vytvoří jen **poslední** klíč cesty, ne
 * mezilehlé objekty. Na čerstvém projektu je `settings` prázdný objekt, takže
 * by skrytí panelu **tiše neudělalo nic**: UPDATE by proběhl, ovlivnil jeden
 * řádek, vrátil nulový kód a hodnota by se neuložila. Uživatel by panel skryl,
 * po prvním načtení stránky by se vrátil a nikde by nebyla chyba.
 *
 * Správný tvar sloučí podobjekt operátorem `||` a chybějící mezistupeň
 * nahradí prázdným objektem. Sourozence (`demoData`, `finishedDismissed`)
 * to zachová.
 */
async function mergeOnboardingSettings(
  tx: Tx,
  workspaceId: string,
  patch: Record<string, boolean>,
): Promise<void> {
  await tx.execute(sql`
    UPDATE workspaces
       SET settings = jsonb_set(
             settings,
             '{onboarding}',
             coalesce(settings -> 'onboarding', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
             true),
           updated_at = now()
     WHERE id = ${workspaceId}`);
}

export async function hideOnboardingPanel(
  tx: Tx,
  workspaceId: string,
  hidden: boolean,
): Promise<void> {
  await mergeOnboardingSettings(tx, workspaceId, { hidden });
}

export async function dismissFinishedBanner(tx: Tx, workspaceId: string): Promise<void> {
  await mergeOnboardingSettings(tx, workspaceId, { finishedDismissed: true });
}
