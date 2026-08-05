export const CREDENTIALS_REFRESH_JOB = {
  queue: 'sender.credentials_refresh' as const,
  retryLimit: 3,
  expireInSeconds: 30 * 60,
  singletonKey: (providerId: string) => providerId,
};

export type CredentialsRefreshPayload = {
  workspace_id: string;
  provider_id: string;
};

/**
 * Výsledek jednoho běhu. Rozlišuje TŘI stavy, ne dva, protože každý znamená
 * něco jiného pro toho, kdo se ptá, proč kampaň pořád stojí.
 */
export type CredentialsRefreshResult =
  /** Obálka byla pod starým pokolením klíče a přešifrovala se. */
  | { outcome: 'refreshed'; fromKeyId: number; toKeyId: number }
  /** Obálka už je pod aktuálním klíčem. Není co dělat a není to chyba. */
  | { outcome: 'already_current'; keyId: number }
  /** Odesílací účet mezitím zmizel. */
  | { outcome: 'gone' };

export type CredentialsRefreshDeps = {
  /** Šifrovaná obálka odesílacího účtu, nebo `null`, když účet neexistuje. */
  loadStored(input: CredentialsRefreshPayload): Promise<string | null>;
  /** Pokolení klíče přečtené z hlavičky obálky, BEZ dešifrování. */
  keyIdOf(stored: string): number;
  /** Nejvyšší pokolení, které tenhle proces zná. */
  currentKeyId(): number;
  /** Zná keyring tohohle procesu tohle pokolení? */
  knowsKey(keyId: number): boolean;
  /** Dešifruje starým pokolením a zašifruje aktuálním. */
  reencrypt(input: { stored: string; workspaceId: string }): string;
  /**
   * Zapíše novou obálku zpět.
   *
   * `storedBefore` je hodnota, kterou úloha přečetla. Zápis se smí provést jen
   * tehdy, když se sloupec mezitím nezměnil: `mlain rotate-credentials` sahá na
   * tentýž sloupec a bez téhle podmínky by dva souběžné zápisy tiše přepsaly
   * jeden druhého.
   */
  store(input: CredentialsRefreshPayload & { stored: string; storedBefore: string }): Promise<void>;
};

/**
 * Přešifruje přístupové údaje jednoho odesílacího účtu pod aktuální klíč.
 *
 * K ČEMU TO JE. Sender dešifruje `sending_providers.config_encrypted` sám, svým
 * keyringem. Když se otočí SECRET_KEY a sender se restartuje BEZ
 * `SECRET_KEY_PREVIOUS`, přestane starou obálku umět otevřít: každé zprávě zapíše
 * `credentials_undecryptable` a po `SENDER_CREDENTIALS_MAX_RETRIES` pokusech
 * pozastaví kampaň. Tahle úloha je cesta ven, která nevyžaduje ani restart
 * senderu, ani spuštění CLI: přepíše obálku pod pokolení, které sender zná.
 *
 * PROČ NE PROSTĚ `mlain rotate-credentials`. Ten příkaz projde VŠECHNY šifrované
 * sloupce v instalaci pod rolí migrátora a je to plánovaná údržba. Tohle je
 * oprava JEDNOHO účtu, kterou umí zařadit aplikace sama v okamžiku, kdy problém
 * zjistí. Obojí sahá na týž sloupec, ale nikdy zároveň: singleton klíč fronty je
 * `provider_id`, takže víc úloh na týž účet nevznikne.
 *
 * IDEMPOTENCE je podmínka, ne vlastnost navíc. Úloha se opakuje při selhání
 * a zařazuje ji hlídač, který tiká každých patnáct sekund. Účet už přešifrovaný
 * se proto pozná z pokolení v hlavičce obálky a druhý zápis se NEPROVEDE:
 * přešifrovat znovu by sice dalo tentýž obsah, ale s jiným nonce, takže by se
 * sloupec měnil při každém tiku a nešlo by poznat, kdy se opravdu něco stalo.
 *
 * CHYBĚJÍCÍ STARÝ KLÍČ SE HLÁSÍ NAHLAS. Když obálka nese pokolení, které keyring
 * tohohle procesu nezná, není co dělat: obsah se nedá otevřít ani přepsat. Ticho
 * by tady bylo nejhorší možná odpověď, protože kampaň zůstane pozastavená a
 * úloha by se tvářila jako hotová. Východisko je vrátit staré pokolení do
 * `SECRET_KEY_PREVIOUS` a přesně to ta hláška říká.
 */
export async function credentialsRefreshHandler(
  deps: CredentialsRefreshDeps,
  payload: CredentialsRefreshPayload,
): Promise<CredentialsRefreshResult> {
  const stored = await deps.loadStored(payload);
  if (stored === null) return { outcome: 'gone' };

  const targetKeyId = deps.currentKeyId();

  let keyId: number;
  try {
    keyId = deps.keyIdOf(stored);
  } catch (cause) {
    throw new Error(
      `Obálku přístupových údajů účtu ${payload.provider_id} nejde přečíst. ` +
        'Hodnota ve sloupci config_encrypted není platná obálka enc:v1:.',
      { cause },
    );
  }

  if (keyId === targetKeyId) return { outcome: 'already_current', keyId };

  if (!deps.knowsKey(keyId)) {
    throw new Error(
      `Přístupové údaje účtu ${payload.provider_id} jsou pod pokolením klíče ${keyId}, ` +
        `které tenhle proces nezná (aktuální je ${targetKeyId}). Vraťte to pokolení do ` +
        'SECRET_KEY_PREVIOUS a spusťte úlohu znovu; bez něj se obálka nedá otevřít ' +
        'a kampaň zůstane pozastavená na credentials_undecryptable.',
    );
  }

  const next = deps.reencrypt({ stored, workspaceId: payload.workspace_id });
  await deps.store({ ...payload, stored: next, storedBefore: stored });
  return { outcome: 'refreshed', fromKeyId: keyId, toKeyId: targetKeyId };
}
