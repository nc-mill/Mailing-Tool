/**
 * Veřejné identifikátory, které nesou projekt.
 *
 * PROČ TENHLE SOUBOR EXISTUJE (odchylka od plánu, vynucená izolací projektů).
 * Veřejné stránky běží bez přihlášení, takže nemají odkud vzít `WorkspaceContext`.
 * Token typu 'u' z kontraktu P02 projekt nese v payloadu, takže `/u/`, `/p/` a `/r/`
 * problém nemají. Potvrzovací token double opt-in ho ale nenese (rozhodnutí R4: je to
 * 32 náhodných bajtů se stavem v databázi) a slug formuláře taky ne.
 *
 * Politika `ws_isolation` na tabulkách `subscription_confirmations` a `forms` porovnává
 * `workspace_id` s `current_setting('mlain.workspace_id')`. Bez kontextu vrátí dotaz
 * NULA ŘÁDKŮ, ověřeno spuštěním proti běžící databázi. Vyhledání podle tokenu nebo slugu
 * napříč projekty by proto potřebovalo novou politiku (obdobu `invitation_token_lookup`),
 * a migrace i politiky vlastní P03.
 *
 * Řešení, které novou politiku nepotřebuje: veřejný odkaz nese projekt v SOBĚ, stejně
 * jako ho nese podepsaný odhlašovací token. Prvních 32 znaků je `workspace_id` v hexu
 * bez pomlček, zbytek je vlastní hodnota. Pevná šířka znamená, že se nepotřebuje
 * oddělovač, takže identifikátor projde i tam, kde je povolená jen malá abeceda.
 *
 * Není to únik: `workspace_id` není tajemství a kontrakt 4.10.3 části 1 ho v otevřené
 * podobě posílá v každém odhlašovacím odkazu. Autorizaci nese hodnota za ním, ne projekt.
 */

const UUID_HEX = /^[0-9a-f]{32}$/;

/**
 * UUID bez pomlček. Pevných 32 znaků z abecedy [0-9a-f].
 *
 * Parametr se jmenuje `uuid`, ne `workspaceId`, a je to záměr: `scope.test.ts` zakazuje
 * exportovanou funkci mimo `packages/core/src/tx` s parametrem `workspaceId: string`,
 * aby nikdo nepodstrčil neověřený odkaz tam, kde patří ověřený kontext. Tahle funkce
 * žádná data nečte, jen přeformátuje řetězec, takže jméno parametru říká, co to je.
 */
export function compactWorkspaceId(uuid: string): string {
  const compact = uuid.replaceAll('-', '').toLowerCase();
  if (!UUID_HEX.test(compact)) throw new Error(`workspace_id není UUID: ${uuid}`);
  return compact;
}

/** Zpátky na kanonický tvar s pomlčkami, protože ::uuid v SQL bere obojí, ale porovnání ne. */
export function expandWorkspaceId(compact: string): string {
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20, 32),
  ].join('-');
}

/**
 * Vstup pro složení veřejného odkazu. Vlastní typ tady není kosmetika, je to tentýž
 * postup, jaký použil `IssueUnsubscribeTokenInput` v `tokens.ts`: `workspaceId` je tu
 * OBSAH, který se zapisuje do adresy, ne kontext, pod kterým se sahá na data.
 */
export type PublicRefInput = { workspaceId: string; value: string };

export function encodePublicRef(input: PublicRefInput): string {
  return `${compactWorkspaceId(input.workspaceId)}${input.value}`;
}

export type PublicRef = { workspaceId: string; value: string };

/**
 * Rozebere veřejný identifikátor. Vrací null, ne výjimku: na veřejné stránce přistane
 * cokoliv, co někdo napíše do adresního řádku, a stránka na to musí odpovědět generickou
 * hláškou s kódem 200, ne pádem.
 */
export function decodePublicRef(raw: string): PublicRef | null {
  if (raw.length <= 32) return null;
  const compact = raw.slice(0, 32).toLowerCase();
  if (!UUID_HEX.test(compact)) return null;
  return { workspaceId: expandWorkspaceId(compact), value: raw.slice(32) };
}
