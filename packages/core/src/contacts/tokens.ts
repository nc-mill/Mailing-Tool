import {
  GLOBAL_LIST_ID,
  TokenError,
  buildToken,
  verifyToken,
  type TokenErrorCode,
} from '@mlain/contracts/token';
// currentKeyId a typ Keyring bydlí v keyring.ts, ne v token.ts. Kontrakt je mezi
// ně dělí schválně: klíče žijí déle než formát tokenu.
import { currentKeyId, keyringFromEnv, type Keyring } from '@mlain/contracts/keyring';
import { sanitizePublicToken } from '../net/public-link';

/**
 * Povolené typy tokenů per endpoint (rozhodnutí R3 plánu).
 *
 * Kontrakt 4.10.3 části 1 je zmrazený a zná čtyři typy: 'o', 'c', 'i', 'u'. Typ 'p' pro
 * stránku předvoleb, o kterém mluví 4.9.3 části 2, v něm NENÍ a nebude se zavádět. Stránka
 * předvoleb i reaktivační odkaz proto nesou token typu 'u'.
 *
 * Je to bezpečné, protože držitel odhlašovacího odkazu a držitel odkazu na předvolby mají
 * tentýž rozsah oprávnění: obojí přišlo v e-mailu na tutéž adresu a obojí smí spravovat
 * odběr téhož kontaktu.
 *
 * Endpoint `/v/**` (zobrazení zprávy v prohlížeči) je na tom stejně a není to volba webu:
 * odesílač skládá `webview_url` z TÉHOŽ odhlašovacího tokenu jako `preferences_url`
 * (`apps/sender/internal/app/worker.go`, `urls.go`). Web tedy jiný typ ani dostat nemůže.
 *
 * Krok 4 ověření z kontraktu ("type odpovídá endpointu") se tím NEVYPOUŠTÍ, jen se povolený
 * typ deklaruje tady a explicitně. Bez něj by šel token pro otevření podstrčit jako token
 * pro odhlášení, což je zranitelnost, ne teorie.
 */
export const ENDPOINT_TOKEN_TYPES = {
  '/u/**': ['u'],
  '/p/**': ['u'],
  '/r/**': ['u'],
  '/v/**': ['u'],
} as const;

export type PublicEndpoint = keyof typeof ENDPOINT_TOKEN_TYPES;

export type UnsubscribeTokenData = {
  workspaceId: string;
  messageId: string;
  contactId: string;
  /** null znamená globální rozsah. */
  listId: string | null;
  messageCreatedAt: Date;
  keyId: number;
};

export type ReadTokenResult =
  { ok: true; data: UnsubscribeTokenData } | { ok: false; code: TokenErrorCode };

/**
 * Přečte veřejný token a ověří, že jeho typ patří na tenhle endpoint.
 *
 * Kritická logika (výpočet MAC, výběr pokolení klíče, porovnání v konstantním čase, pořadí
 * osmi ověřovacích kroků) zůstává v kodeku z `@mlain/contracts/token`, který vlastní P02.
 * Tenhle soubor je tenký adaptér a nesmí kryptografii duplikovat: dvě implementace téhož
 * MAC se dřív nebo později rozejdou a rozejdou se tiše (rozhodnutí R7 plánu).
 *
 * Adaptér dělá právě dvě věci, které kodek dělat nemůže:
 *
 *  1. **Převádí výjimku na výsledek.** `verifyToken` hází `TokenError`, protože je to
 *     kontrakt sdílený s Go stranou. Veřejná stránka ale musí umět ukázat "odkaz už
 *     neplatí", ne spadnout na neošetřené výjimce.
 *  2. **Překládá `list_id` samých nul na `null`**, tedy binární tvar na doménový.
 *  3. **Uřízne přílepek poštovního klienta.** Gmail připojuje `&source=gmail&ust=…&usg=…`
 *     naivním spojením, bez ohledu na to, že odkaz `/u/<token>` žádné `?` nemá, takže se
 *     celý přílepek stane součástí segmentu cesty a tím i tokenu. Podrobně v
 *     `packages/core/src/net/public-link.ts`. Čistí se TADY, a ne v kodeku: kontrakt 3 je
 *     zmrazený a má zlaté vektory sdílené s Go stranou.
 *
 * Typ 'u' nemá expiraci ani nonce, takže `now` a `isNonceUsed` jsou pro něj bez následku;
 * kontrakt je i tak vyžaduje, protože jeho signatura je společná pro všechny čtyři typy.
 */
export function readPublicToken(
  raw: string,
  endpoint: PublicEndpoint,
  keyring: Keyring = keyringFromEnv(),
): ReadTokenResult {
  const allowed = ENDPOINT_TOKEN_TYPES[endpoint];
  try {
    const verified = verifyToken({
      token: sanitizePublicToken(raw),
      endpointType: allowed[0],
      keyring,
      now: Math.floor(Date.now() / 1000),
      isNonceUsed: () => false,
    });
    const listId = String(verified.fields['list_id']);
    return {
      ok: true,
      data: {
        workspaceId: String(verified.fields['workspace_id']),
        messageId: String(verified.fields['message_id']),
        contactId: String(verified.fields['contact_id']),
        listId: listId === GLOBAL_LIST_ID ? null : listId,
        messageCreatedAt: new Date(Number(verified.fields['message_created_at']) * 1000),
        keyId: verified.keyId,
      },
    };
  } catch (error) {
    if (error instanceof TokenError) return { ok: false, code: error.code };
    throw error;
  }
}

/**
 * Vstup pro vydání odhlašovacího tokenu.
 *
 * `workspaceId` je tu OBSAH, který se zapisuje do payloadu tokenu, ne kontext,
 * pod kterým se sahá na data. Proto je to řetězec a ne `WorkspaceContext`.
 * Vlastní typ tady není kosmetika: `scope.test.ts` zakazuje exportovanou funkci
 * mimo `packages/core/src/tx` s parametrem `workspaceId: string` právě proto,
 * aby nikdo nepodstrčil neověřený odkaz tam, kde patří ověřený kontext.
 * Pojmenování vstupu nutí u každé takové výjimky napsat, co ta hodnota je.
 * Stejný postup použil P04 u `RestoreWorkspaceRequest`.
 */
export type IssueUnsubscribeTokenInput = {
  workspaceId: string;
  messageId: string;
  contactId: string;
  listId: string | null;
  messageCreatedAt: Date;
  keyring: Keyring;
};

/**
 * Vydá odhlašovací token. Používá ho část 4 při skládání zprávy a tenhle plán na stránce
 * předvoleb, když skládá reaktivační odkaz.
 *
 * Globální rozsah se zapisuje jako list_id samých nul, ne jako vynechané pole: payload typu
 * 'u' má pevnou délku 68 bajtů a kratší payload kodek odmítne jako token_malformed.
 *
 * Podepisuje se vždy AKTUÁLNÍM pokolením klíče. Starší odkazy zůstávají platné, dokud je
 * jejich pokolení v keyringu, což je celý smysl toho, že se SECRET_KEY_PREVIOUS nevyprazdňuje.
 */
export function issueUnsubscribeToken(input: IssueUnsubscribeTokenInput): string {
  return buildToken({
    type: 'u',
    keyId: currentKeyId(input.keyring),
    keyring: input.keyring,
    fields: {
      workspace_id: input.workspaceId,
      message_id: input.messageId,
      contact_id: input.contactId,
      list_id: input.listId ?? GLOBAL_LIST_ID,
      // u32 nese SEKUNDY. Milisekundy by přetekly rozsah a token by nesl jiný čas.
      message_created_at: Math.floor(input.messageCreatedAt.getTime() / 1000),
    },
  }).token;
}
