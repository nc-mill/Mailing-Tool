import { sql } from 'drizzle-orm';
import { allowsMeasurement } from '../../contacts/repo/consents';
import { recordIdentityBind } from '../metrics';
import { enqueueIdentityMerge, type IdentityMergeJobData } from '../jobs/identity-merge';
import {
  countRecentBindings,
  insertBinding,
  selectContactGuard,
  selectIdentityForUpdate,
  upsertIdentity,
  type BindingSource,
} from '../repo/identities.repo';
import { withTrackingTx, type Tx } from '../repo/tx';

/**
 * Vazba anonymního ID na kontakt, viz plán P10 Task 29. Producent fronty
 * `identity.merge`.
 *
 * Tohle je nejchoulostivější algoritmus v celé části: chyba v něm znamená, že
 * se historie jednoho člověka přiřadí jinému. Dvě věci z něj nesmí zmizet.
 *
 * KROK 0 je omezení zpracování podle článku 18 GDPR. Kontakt s uplatněným
 * omezením se nemaže, ale nesmí se zpracovávat. Události se dál ukládají,
 * ale ANONYMNĚ.
 *
 * KROK 5 je jádro návrhu a je záměrně konzervativní. Když jeden `anonymous_id`
 * postupně odpovídá dvěma různým kontaktům, znamená to sdílený počítač,
 * přeposlaný e-mail otevřený někým jiným, nebo záměrné zneužití. Ve všech třech
 * případech je špatně přiřadit dosavadní historii nové osobě. HISTORIE SE PROTO
 * DOPLŇUJE VÝHRADNĚ PŘI PRVNÍ VAZBĚ anonymního ID. Je to zároveň odpověď na
 * otázku „co když se člověk vrátí po dvaceti minutách a klikne znovu": dostane
 * nový token, vazba skončí stavem `unchanged` a žádné druhé slučování se
 * nenaplánuje. Duplicita tak nevznikne ani při stém kliku.
 */

export type BindOutcome =
  | 'created'
  | 'bound'
  | 'unchanged'
  | 'rebound'
  | 'shared'
  | 'restricted'
  /** Kontakt má odvolaný souhlas s měřením, viz krok 0b. */
  | 'measurement_withdrawn'
  | 'contact_not_found';

/**
 * Kolik vazeb za 24 hodin dělá ze zařízení sdílené.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ SCHÉMATEM: plán držel příznak ve sloupci
 * `identities.shared`, který v migracích P03 neexistuje. Odvozuje se proto
 * z `identity_bindings`, viz `countRecentBindings`.
 */
const SHARED_DEVICE_THRESHOLD = 6;
const SHARED_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type BindIdentityInput = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  source: BindingSource;
  evidence: Record<string, unknown>;
  now: Date;
  /**
   * Zařazení slučování. Volá se VE STEJNÉ TRANSAKCI jako zápis vazby, takže
   * úloha nepřežije rollback. Testy si sem podstrčí špióna.
   */
  // `| undefined` je tu kvůli `exactOptionalPropertyTypes: true` v tsconfigu
  // monorepa: bez něj nejde volitelné pole předat z objektu, který ho může mít
  // nevyplněné.
  scheduleMerge?: ((tx: Tx, data: IdentityMergeJobData) => Promise<void>) | undefined;
};

export async function bindIdentity(input: BindIdentityInput): Promise<BindOutcome> {
  const scheduleMerge = input.scheduleMerge ?? enqueueIdentityMerge;

  const outcome = await withTrackingTx(
    { workspaceId: input.workspaceId, job: 'tracking.bind' },
    async (tx): Promise<BindOutcome> => {
      // Souběh: `FOR UPDATE` neexistující řádek nezamkne, takže tři současné
      // vazby téhož anonymního ID by jinak založily tři řádky `identities`.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.anonymousId}`}, 0))`,
      );

      // 0. omezení zpracování a existence kontaktu
      const guard = await selectContactGuard(tx, input.workspaceId, input.contactId);
      if (guard === null) return 'contact_not_found';
      if (guard.processingRestricted || guard.deletedAt !== null) return 'restricted';
      /**
       * 0b. odvolaný souhlas s měřením. Vazba se NEZALOŽÍ, protože právě ona
       * dělá z anonymní stopy stopu konkrétního člověka: bez ní se události dál
       * ukládají, ale bez `contact_id`. Zastavit to až o patro níž nestačí,
       * `identities.contact_id` by zůstalo nastavené a přiřadilo by kontaktu
       * všechno, co přijde potom.
       */
      if (!allowsMeasurement(guard.measurementConsent)) return 'measurement_withdrawn';

      // 1. aktuální stav vazby
      const identity = await selectIdentityForUpdate(tx, input.workspaceId, input.anonymousId);

      const writeBinding = async (): Promise<string> =>
        insertBinding(tx, {
          workspaceId: input.workspaceId,
          anonymousId: input.anonymousId,
          contactId: input.contactId,
          source: input.source,
          evidence: input.evidence,
          now: input.now,
        });

      const bindAndMerge = async (result: 'created' | 'bound'): Promise<BindOutcome> => {
        const bindingId = await writeBinding();
        await upsertIdentity(tx, {
          workspaceId: input.workspaceId,
          anonymousId: input.anonymousId,
          contactId: input.contactId,
          now: input.now,
        });
        await scheduleMerge(tx, {
          workspaceId: input.workspaceId,
          anonymousId: input.anonymousId,
          contactId: input.contactId,
          bindingId,
        });
        return result;
      };

      // 2. prohlížeč jsme ještě neviděli
      if (identity === null) return bindAndMerge('created');

      // 3. známý prohlížeč bez vazby: první vazba, historie se doplňuje
      if (identity.contactId === null) return bindAndMerge('bound');

      // 4. tatáž vazba podruhé: nic se nemění a NEplánuje se druhé slučování
      if (identity.contactId === input.contactId) {
        await tx.execute(sql`
          UPDATE identities SET last_seen = ${input.now}
           WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
        `);
        return 'unchanged';
      }

      // 5. převazba na jiný kontakt. Historie se NEslučuje.
      const recent = await countRecentBindings(
        tx,
        input.workspaceId,
        input.anonymousId,
        new Date(input.now.getTime() - SHARED_DEVICE_WINDOW_MS),
      );
      if (recent >= SHARED_DEVICE_THRESHOLD) return 'shared';

      await writeBinding();
      await upsertIdentity(tx, {
        workspaceId: input.workspaceId,
        anonymousId: input.anonymousId,
        contactId: input.contactId,
        now: input.now,
      });
      return 'rebound';
    },
  );

  recordIdentityBind(outcome);
  return outcome;
}
