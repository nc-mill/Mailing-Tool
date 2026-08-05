import { issueFormNonce, loadPublicForm } from '@mlain/core/contacts';
import { sanitizePublicSlug } from '@mlain/core/net/public-link';
import { requestIp } from '@/features/public/request';

/**
 * Výdej nonce pro VLOŽENÝ formulář, `GET /f/{ref}/nonce`.
 *
 * PROČ VZNIKL. Druhá vrstva ochrany (`checkProtection`) vyžaduje nonce u každého
 * odeslání a bez něj odeslání TIŠE ZAHODÍ. Hostovaná stránka `/f/{ref}` si ho vydává
 * sama při vykreslení, vkládací skript ale žádný neměl, takže formulář na cizím webu
 * sbíral prázdno: odpověď byla `{"ok":true}`, kontakt nevznikl a jediná stopa byl
 * řádek v `form_submissions` se stavem `dropped` a kódem `missing_nonce`. Naměřeno
 * na instalaci, doslova tímhle požadavkem:
 *
 *   POST /f/{ref}/submit  {"email":"…"}   → 200 {"ok":true,"double_opt_in":true}
 *   form_submissions      → dropped, missing_nonce
 *
 * PROČ SAMOSTATNÁ CESTA A NE HODNOTA VE SKRIPTU. Nonce je vázaný na formulář
 * a na IP odesílatele a nese čas vydání, ze kterého se počítá časová past. Skript
 * se cachuje pět minut (`cache-control: public, max-age=300`), takže zapečený nonce
 * by se sdílel mezi návštěvníky a nesl cizí IP; ověření by ho pak zahodilo úplně
 * stejně jako když chybí. Tahle odpověď se proto NECACHUJE.
 *
 * ČAS SE POČÍTÁ OD VYDÁNÍ, což je celý smysl časové pasti: skript si nonce vyžádá
 * při vykreslení formuláře, ne až při odeslání, takže mezi vydáním a odesláním leží
 * doba, po kterou člověk formulář vyplňoval.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const ref = sanitizePublicSlug(slug);

  const form = await loadPublicForm(ref);
  if (form === null || !form.active) {
    // Strojové rozhraní, takže prázdná 404, ne stránka pro člověka.
    return new Response(null, { status: 404 });
  }

  const nonce = issueFormNonce({ formId: form.id, ip: requestIp(request) });

  return Response.json(
    { nonce: nonce.value },
    {
      headers: {
        // Formulář z definice běží na cizí doméně.
        'access-control-allow-origin': '*',
        // Každý návštěvník musí dostat vlastní nonce s vlastním časem vydání.
        'cache-control': 'no-store',
      },
    },
  );
}

/** Předletový dotaz. Skript si nonce bere z cizí domény. */
export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '600',
    },
  });
}
