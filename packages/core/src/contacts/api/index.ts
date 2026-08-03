import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';
import { toFieldErrors } from './schemas';

/**
 * Prostředí všech route souborů této domény.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán zaváděl vlastní
 * `ContactsEnv = { Variables: { ctx: WorkspaceContext } }` a handlery četly `c.get('ctx')`.
 * Autentizační middleware, který vlastní P04, ale plní proměnnou `auth` tvaru
 * `{ ctx, label }` a další proměnné (`requestId`, `clientIp`, `runIdempotent`).
 * Vlastní typ prostředí by znamenal, že `c.get('ctx')` je za běhu `undefined`.
 * `ContactsEnv` je proto alias na `ApiEnv` a handlery čtou `c.get('auth').ctx`.
 */
export type ContactsEnv = ApiEnv;

/**
 * Jednotné chování při selhání validace. Bez něj vrací @hono/zod-openapi holý výpis zod chyb,
 * který neodpovídá RFC 9457 obálce z kapitoly 4.8 části 1.
 *
 * Proti výchozímu hooku kostry aplikace (`apps/web/src/lib/api/app.ts`) se liší tím, že
 * zod kódy překládá na doménové kódy z `CONTACTS_FIELD_ERROR_CODES`, takže klient dostane
 * `unknown_field_key` místo `unrecognized_keys` a nemusí znát vnitřnosti zod.
 */
export const validationHook: Hook<unknown, ContactsEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', { errors: toFieldErrors(result.error) });
};

/**
 * Router domény kontaktů. Mountuje ho `apps/web/src/lib/api/openapi.ts` (vlastní P04)
 * voláním `registerContactsRoutes(app)`, viz kapitola 2.1. Graf závislostí z 3.11 části 1
 * nedovoluje opačný směr: packages/core nesmí importovat z apps/web, takže cesty musí být
 * tady a mount tam.
 */
export const contactsApi = new OpenAPIHono<ContactsEnv>({ defaultHook: validationHook });

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerContactsRoutes`.
 * Kdyby se cesty registrovaly až tam, druhé volání `buildApp()` (generátor OpenAPI,
 * testy) by je do téhož routeru přidalo podruhé a dokument by měl každou cestu dvakrát.
 *
 * POŘADÍ JE VÝZNAMNÉ. `tags.routes.ts` vlastní `/contacts/tags:bulk` a `consents.routes.ts`
 * vlastní `/contacts/{contact_id}/consents`, takže statické segmenty musí být dřív
 * než `/contacts/{id}` z `contacts.routes.ts`. Uvnitř každého souboru platí totéž znovu.
 *
 * Importy jsou až tady, pod definicí `contactsApi`: route soubory si z tohohle modulu
 * berou jen TYP prostředí (`import type`), takže cyklus za běhu nevzniká.
 */
import { registerConsentRoutes } from './consents.routes';
import { registerContactEditRoutes } from './contact-edit.routes';
import { registerContactFieldRoutes } from './contact-fields.routes';
import { registerContactRoutes } from './contacts.routes';
import { registerGdprRoutes } from './gdpr.routes';
import { registerListRoutes } from './lists.routes';
import { registerNameOverrideRoutes } from './name-overrides.routes';
import { registerRetentionRoutes } from './retention.routes';
import { registerSuppressionRoutes } from './suppressions.routes';
import { registerTagRoutes } from './tags.routes';
import { registerVocativeReviewRoutes } from './vocative-review.routes';

registerTagRoutes(contactsApi);
registerContactRoutes(contactsApi);
registerConsentRoutes(contactsApi);
registerContactFieldRoutes(contactsApi);
registerListRoutes(contactsApi);
registerSuppressionRoutes(contactsApi);
registerGdprRoutes(contactsApi);
registerRetentionRoutes(contactsApi);
registerVocativeReviewRoutes(contactsApi);
registerNameOverrideRoutes(contactsApi);
// Až za `registerContactRoutes`: PUT /contacts/{id} je jiná metoda,
// /contacts/{id}/cancel-snooze má o segment navíc a /name-preview je vlastní kořen,
// takže tady na pořadí nezáleží. Zdůvodnění je u definic v contact-edit.routes.ts.
registerContactEditRoutes(contactsApi);

/**
 * Registrace do hlavní aplikace. Stejný tvar jako `registerApiKeyRoutes` a spol., aby
 * `buildApp()` skládal všechny domény jedním způsobem.
 *
 * Prefix `/api/v1` se přidává tady, ne v každé definici cesty: route soubory téhle domény
 * píšou cesty relativně (`/contacts`), jak je má plán.
 */
export function registerContactsRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', contactsApi);
}
