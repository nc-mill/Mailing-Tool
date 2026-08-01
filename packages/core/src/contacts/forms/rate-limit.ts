/**
 * Doménový limiter formulářů: pátá vrstva ochrany (rozhodnutí R10 plánu).
 *
 * PROČ TENHLE SOUBOR VŮBEC EXISTUJE. Plán psal u páté vrstvy jen komentář „rate limit
 * se aplikuje mimo tuhle funkci, v middleware endpointu". Ochrana, jejíž jediné vynucení
 * je věta v komentáři, není ochrana: první endpoint, který si na limiter nevzpomene,
 * ji tiše vypne a nic nezčervená. Limiter je proto POVINNÝ PARAMETR `checkProtection`,
 * takže cesta, která ho nepředá, se nepřeloží.
 *
 * Čísla jsou z kapitoly 7.4 části 2 a leží NAD obecným limitem povrchu `/f/**`
 * z části 1 (20 za 10 minut na IP), který vlastní P04. Vyhrává ten, který se naplní dřív;
 * přísnější strop nikdy neporuší volnější.
 *
 * Okno je pevné (fixed window), ne klouzavé. Je to vědomá volba: klouzavé okno vyžaduje
 * uchovávat časy jednotlivých požadavků, což u sta tisíc IP znamená sto tisíc polí v paměti
 * procesu. Cena pevného okna je, že na jeho hranici projde až dvojnásobek limitu; u ochrany
 * proti botům je to bez následku, protože druhá vrstva (nonce) je na čase nezávislá.
 */

export type FormRateLimitConfig = {
  /** Kolik odeslání smí projít z jedné adresy za minutu. */
  perIpMinute: number;
  /** Kolik odeslání smí projít z jedné adresy za hodinu. */
  perIpHour: number;
  /** Kolik odeslání smí projít do jednoho formuláře za minutu, ze všech adres dohromady. */
  perFormMinute: number;
};

export const DEFAULT_FORM_RATE_LIMIT: FormRateLimitConfig = {
  perIpMinute: 5,
  perIpHour: 30,
  perFormMinute: 100,
};

/**
 * Konfigurace z prostředí. Proměnnou `FORM_RATE_LIMIT_PER_IP_MINUTE` má plán výslovně
 * jako konfigurovatelnou; ostatní dvě hodnoty se dopočítají poměrem, aby se nedaly
 * nastavit nekonzistentně (hodinový strop nižší než minutový).
 */
export function formRateLimitFromEnv(
  env: Record<string, string | undefined> = process.env,
): FormRateLimitConfig {
  const raw = Number(env['FORM_RATE_LIMIT_PER_IP_MINUTE']);
  if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_FORM_RATE_LIMIT;
  return {
    perIpMinute: raw,
    perIpHour: Math.max(raw, raw * 6),
    perFormMinute: DEFAULT_FORM_RATE_LIMIT.perFormMinute,
  };
}

export type FormRateLimitVerdict =
  | { allowed: true }
  | { allowed: false; scope: 'ip_minute' | 'ip_hour' | 'form_minute'; retryAfterSeconds: number };

export type FormRateLimiter = {
  consume(input: { formId: string; ip: string }): FormRateLimitVerdict;
};

type Bucket = { count: number; resetAt: number };

/**
 * Limiter v paměti procesu. Pro jednoinstanční nasazení, které tenhle produkt cílí,
 * je to celý příběh; při běhu ve víc instancích se strop znásobí počtem instancí,
 * což je bezpečná strana chyby (limit povolí víc, nikdy míň).
 */
export function createFormRateLimiter(
  config: FormRateLimitConfig = DEFAULT_FORM_RATE_LIMIT,
  now: () => number = Date.now,
): FormRateLimiter {
  const buckets = new Map<string, Bucket>();

  function hit(key: string, limit: number, windowMs: number): number | null {
    const time = now();
    const bucket = buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= time) {
      buckets.set(key, { count: 1, resetAt: time + windowMs });
      return null;
    }
    if (bucket.count >= limit) return Math.ceil((bucket.resetAt - time) / 1000);
    bucket.count += 1;
    return null;
  }

  return {
    consume({ formId, ip }) {
      // Nejdřív se uklidí, co doběhlo, aby mapa nerostla donekonečna u instalace,
      // která běží měsíce bez restartu.
      if (buckets.size > 10_000) {
        const time = now();
        for (const [key, bucket] of buckets) if (bucket.resetAt <= time) buckets.delete(key);
      }

      const ipMinute = hit(`ip:m:${ip}`, config.perIpMinute, 60_000);
      if (ipMinute !== null)
        return { allowed: false, scope: 'ip_minute', retryAfterSeconds: ipMinute };

      const ipHour = hit(`ip:h:${ip}`, config.perIpHour, 3_600_000);
      if (ipHour !== null) return { allowed: false, scope: 'ip_hour', retryAfterSeconds: ipHour };

      const formMinute = hit(`form:m:${formId}`, config.perFormMinute, 60_000);
      if (formMinute !== null) {
        return { allowed: false, scope: 'form_minute', retryAfterSeconds: formMinute };
      }

      return { allowed: true };
    },
  };
}

/**
 * Limiter sdílený celým procesem. Endpoint si vlastní instanci nezakládá, jinak by měl
 * každý požadavek svůj vlastní strop, tedy žádný.
 */
let shared: FormRateLimiter | null = null;

export function sharedFormRateLimiter(): FormRateLimiter {
  shared ??= createFormRateLimiter(formRateLimitFromEnv());
  return shared;
}

/** Jen pro testy: zahodí sdílený limiter, aby jeden test neovlivnil druhý. */
export function resetSharedFormRateLimiter(): void {
  shared = null;
}
