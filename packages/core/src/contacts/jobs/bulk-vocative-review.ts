import { createSystemContext } from '../../identity/context';
import { BULK_BATCH_SIZE } from '../constants';
import type { Gender } from '../naming/types';
import {
  applyGroupActionBatch,
  assertGroupActionInput,
  type GroupAction,
  type GroupActionInput,
} from '../vocative-review/actions';

/**
 * Náklad zapisuje producent `enqueueJobDetached` ve `vocative-review/actions.ts`.
 * Tvar je proto opsaný z něj, ne z registru front: registr u téhle fronty vypisuje
 * `payloadFields: ['operation_id', 'workspace_id']`, což neodpovídá ničemu, co se
 * do fronty doopravdy zařazuje. Registr vlastní P01 a `payloadFields` je popis pro
 * test zákazu osobních údajů, ne serializační formát.
 */
export type BulkVocativeReviewPayload = {
  workspaceId: string;
  nameKey: string;
  kind: 'first' | 'last';
  action: GroupAction;
  /** Producent posílá `null`, když se hodnota netýká zvolené akce. */
  vocative?: string | null;
  gender?: Gender | null;
  saveOverride: boolean;
  /** Kolik kontaktů měla skupina v okamžiku zařazení. Jen pro ukazatel průběhu. */
  expected?: number;
};

/**
 * Hromadné vyřízení jedné skupiny fronty ke kontrole oslovení, po dávkách 5 000.
 *
 * KDY VZNIKÁ ÚLOHA. Akce nad skupinou běží synchronně do
 * `VOCATIVE_REVIEW_SYNC_LIMIT` kontaktů. Nad tím by jedna transakce držela zámek
 * `FOR UPDATE` nad desítkami tisíc řádků po celou dobu požadavku, takže rozhraní
 * vrátí 202 a zbytek dodělá tenhle job.
 *
 * PRÁCE SE NEOPISUJE. Job volá `applyGroupActionBatch`, tedy TUTÉŽ funkci, kterou
 * používá synchronní cesta. Vlastní SQL by se rozešlo přesně v těch místech, na
 * kterých ta funkce stojí: u akce `set_gender` se vokativ musí přepočítat PO
 * ŘÁDCÍCH (skupinu drží pohromadě klíč bez diakritiky, takže "Tomáš" i "Tomas"
 * jsou v jedné skupině, ale jejich vokativ se liší) a oslovení se musí přepočítat
 * v téže transakci, aby nemohl vzniknout stav se zamčeným vokativem a starým
 * oslovením.
 *
 * `applyGroupAction` job volat NESMÍ a nevolá: nad pěti tisíci kontaktů by si
 * zařadil sám sebe znovu a fronta by se plnila donekonečna.
 *
 * Idempotence: výběr dávky je podmíněný na `vocative_locked = false` a zápis ten
 * příznak nastavuje, takže druhý běh nemá co měnit. Přesně to tvrdí
 * `CONTACTS_QUEUES['contacts.bulk_vocative_review']`. Ze stejného důvodu cyklus
 * skončí: každá dávka zmenší množinu, ze které se vybírá.
 *
 * Kontext projektu se vyrábí z payloadu jedinou povolenou továrnou
 * `createSystemContext`. Aktérem je tedy `system` a `vocative_reviewed_by`
 * zůstane prázdné, na rozdíl od synchronní cesty, kde je v něm uživatel. Je to
 * poctivější než dosadit uživatele z nákladu: úlohu vykonal worker, klidně
 * o hodinu později, a auditní řádek `contact.vocative_bulk_confirmed` nese
 * jméno jobu.
 */
export async function bulkVocativeReview(
  payload: BulkVocativeReviewPayload,
): Promise<{ affected: number; batches: number }> {
  const ctx = createSystemContext(payload.workspaceId, 'contacts.bulk_vocative_review');

  const base: GroupActionInput = {
    nameKey: payload.nameKey,
    kind: payload.kind,
    action: payload.action,
    ...(payload.vocative === null || payload.vocative === undefined
      ? {}
      : { vocative: payload.vocative }),
    ...(payload.gender === null || payload.gender === undefined ? {} : { gender: payload.gender }),
    saveOverride: payload.saveOverride,
  };

  // Kontrola nákladu PŘED prvním zápisem. Náklad může být starší než dnešní
  // podoba rozhraní a prázdný vokativ by zamkl celé skupině prázdnou hodnotu.
  assertGroupActionInput(base);

  let affected = 0;
  let batches = 0;

  for (;;) {
    const written = await applyGroupActionBatch(
      ctx,
      {
        ...base,
        // Přepis jména se zapisuje JEN v první dávce. Je to jeden řádek
        // `name_overrides` na celou skupinu, ne na dávku, a jeho hodnota se
        // u akce `confirm` odvozuje z prvního kontaktu dávky. Zápis v každé
        // dávce by tedy tentýž přepis přepisoval hodnotami z různých řádků,
        // což je u skupiny s "Tomáš" i "Tomas" pokaždé jiný vokativ.
        saveOverride: base.saveOverride && batches === 0,
      },
      BULK_BATCH_SIZE,
    );
    if (written === 0) break;
    affected += written;
    batches += 1;
  }

  return { affected, batches };
}
