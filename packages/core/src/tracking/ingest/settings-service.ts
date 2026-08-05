import { sql } from 'drizzle-orm';
import { PUBLIC_KEY_SCOPES, generatePublicKey } from '../../identity/api-key';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { recordPublicKeyCreated } from '../audit';
import { TRACKING_DOMAIN_LIMIT } from '../config';
import { normalizeHost } from '../domains/domain-cache';
import { selectAllowedOrigins, type AllowedOrigin } from '../repo/tracking-domains.repo';
import { resetPublicKeyCache } from './public-key';

/**
 * Data pro obrazovku „Nastavení → Měření".
 *
 * DOPLNĚK NAD RÁMEC PLÁNU. Plán dodával celou serverovou cestu, ale obrazovku,
 * na které si uživatel měřicí kód vezme, nechával na jindy. Bez ní je to
 * napsané a nezapojené: v databázi nebyl ani jeden veřejný klíč a ani jedna
 * měřicí doména, takže `/e/track` odpovídalo 401 a 403 úplně správně
 * a úplně každému.
 *
 * Funkce nechodí přes API vrstvu schválně. Nová veřejná API cesta by znamenala
 * zápis do `apps/web/src/lib/api/openapi.ts` a do specifikace, tedy povrch,
 * který nikdo z venku nepotřebuje. Obrazovka je serverová komponenta a volá
 * doménu přímo, stejně jako obrazovka značky projektu.
 *
 * ROZSAH SE PŘEDÁVÁ KONTEXTEM, ne řetězcem. Funkce si samy otevírají transakci,
 * takže dokud braly `workspaceId: string`, rozhodovaly o izolaci podle hodnoty,
 * které nikdo neručil, a kdokoliv je zavolal s cizím identifikátorem dostal
 * cizí data. `WorkspaceContext` je branded typ z jediné továrny, takže rozsah
 * je vidět z podpisu a podstrčit ho nejde. Hlídá to `identity/scope.test.ts`.
 */

export type { AllowedOrigin };

/** Jméno klíče. Konstanta, protože musí sedět v INSERTu i v auditním záznamu. */
const PUBLIC_KEY_NAME = 'Měřicí kód na web';

export type PublicTrackingKey = {
  apiKeyId: string;
  /** Celý klíč, tedy `ml_pub_` a prefix. Veřejná hodnota, nic se nezakrývá. */
  key: string;
  createdAt: Date;
};

/**
 * Vrátí veřejný klíč projektu, a když žádný nemá, vyrobí ho.
 *
 * Veřejný klíč se na rozdíl od tajného NEUKLÁDÁ jako hash: celá jeho hodnota
 * je prefix a ten je v tabulce v otevřené podobě. Klíč jde proto ukázat
 * kdykoli znovu, což je přesně to, co obrazovka s úryvkem potřebuje.
 */
export async function ensurePublicTrackingKey(
  ctx: WorkspaceContext,
  createdBy: string | null,
  /**
   * Popis aktéra do auditu. Nepovinný schválně: volající, který ho nezná
   * (test, budoucí systémová cesta), nemá kvůli auditu shánět e-mail navíc.
   */
  actorLabel = 'obrazovka Měření webu',
): Promise<PublicTrackingKey> {
  const existing = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string; prefix: string; created_at: Date }>(sql`
        SELECT id, prefix, created_at
          FROM api_keys
         WHERE workspace_id = ${ctx.workspaceId}
           AND kind = 'public'
           AND revoked_at IS NULL
         ORDER BY created_at
         LIMIT 1
      `);
    return rows[0] ?? null;
  });

  if (existing !== null) {
    return {
      apiKeyId: existing.id,
      key: `ml_pub_${existing.prefix}`,
      createdAt: new Date(existing.created_at),
    };
  }

  const generated = generatePublicKey();
  const created = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string; created_at: Date }>(sql`
        INSERT INTO api_keys (workspace_id, name, kind, prefix, scopes, created_by)
        VALUES (
          ${ctx.workspaceId},
          ${PUBLIC_KEY_NAME},
          'public',
          ${generated.prefix},
          ${sql.param([...PUBLIC_KEY_SCOPES])}::text[],
          ${createdBy}
        )
        RETURNING id, created_at
      `);
    const row = rows[0]!;

    /**
     * Audit VE STEJNÉ TRANSAKCI jako vznik klíče. Kdyby se zapisoval zvlášť,
     * rollback by klíč zahodil a záznam o něm nechal, nebo naopak.
     */
    await recordPublicKeyCreated(tx, {
      ctx,
      actorLabel,
      apiKeyId: row.id,
      name: PUBLIC_KEY_NAME,
      scopes: PUBLIC_KEY_SCOPES,
    });

    return row;
  });

  // Bez tohohle by minutu platila nakešovaná záporná odpověď a uživatel by po
  // nasazení úryvku viděl 401, přestože klíč právě vznikl.
  resetPublicKeyCache();

  return {
    apiKeyId: created.id,
    key: generated.key,
    createdAt: new Date(created.created_at),
  };
}

export type TrackingDomainRow = {
  id: string;
  host: string;
  includeSubdomains: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
};

export async function listTrackingDomains(ctx: WorkspaceContext): Promise<TrackingDomainRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      host: string;
      include_subdomains: boolean;
      verified_at: Date | null;
      created_at: Date;
    }>(sql`
      SELECT id, host, include_subdomains, verified_at, created_at
        FROM tracking_domains
       WHERE workspace_id = ${ctx.workspaceId}
       ORDER BY host
    `);
    return rows.map((row) => ({
      id: row.id,
      host: row.host,
      includeSubdomains: row.include_subdomains,
      verifiedAt: row.verified_at === null ? null : new Date(row.verified_at),
      createdAt: new Date(row.created_at),
    }));
  });
}

export type AddDomainResult =
  | { ok: true; domain: TrackingDomainRow }
  | { ok: false; code: 'tracking_domain_invalid' | 'tracking_domain_limit_reached' };

/**
 * Přidá měřicí doménu.
 *
 * Vstup se normalizuje stejnou funkcí, kterou pak používá kontrola `Origin`.
 * Kdyby se lišily, uživatel by doménu zadal, obrazovka by ji ukázala jako
 * uloženou a `/e/track` by ji dál odmítalo. To je nejhorší možný výsledek:
 * vypadá to, že je nastaveno, a přitom nic nechodí.
 */
export async function addTrackingDomain(
  ctx: WorkspaceContext,
  rawHost: string,
  includeSubdomains: boolean,
): Promise<AddDomainResult> {
  /**
   * `normalizeHost` sundá schéma, cestu i port, takže uživatel smí vložit
   * celou adresu z prohlížeče. Jméno bez tečky se POVOLUJE schválně:
   * `localhost` je platný Origin a bez něj by nešlo měření vyzkoušet na
   * vývojovém stroji. Že je to jen vnitřní adresa, řekne obrazovka zvlášť.
   */
  const host = normalizeHost(rawHost);
  if (host === '' || !/^[a-z0-9.-]{1,253}$/.test(host)) {
    return { ok: false, code: 'tracking_domain_invalid' };
  }

  return withWorkspace(ctx, async (tx) => {
    const { rows: counted } = await tx.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM tracking_domains WHERE workspace_id = ${ctx.workspaceId}
    `);
    if (Number(counted[0]?.count ?? '0') >= TRACKING_DOMAIN_LIMIT) {
      return { ok: false, code: 'tracking_domain_limit_reached' as const };
    }

    const { rows } = await tx.execute<{
      id: string;
      host: string;
      include_subdomains: boolean;
      verified_at: Date | null;
      created_at: Date;
    }>(sql`
      INSERT INTO tracking_domains (workspace_id, host, include_subdomains)
      VALUES (${ctx.workspaceId}, ${host}, ${includeSubdomains})
      ON CONFLICT (workspace_id, host)
        DO UPDATE SET include_subdomains = EXCLUDED.include_subdomains
      RETURNING id, host, include_subdomains, verified_at, created_at
    `);
    const row = rows[0]!;
    return {
      ok: true as const,
      domain: {
        id: row.id,
        host: row.host,
        includeSubdomains: row.include_subdomains,
        verifiedAt: row.verified_at === null ? null : new Date(row.verified_at),
        createdAt: new Date(row.created_at),
      },
    };
  });
}

export async function removeTrackingDomain(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      DELETE FROM tracking_domains WHERE workspace_id = ${ctx.workspaceId} AND id = ${id}
    `);
  });
}

/**
 * Povolené domény JEDNOHO projektu, načtené v jeho kontextu.
 *
 * ODCHYLKA OD PLÁNU, A JE TO OPRAVA VADY, KTEROU JSEM NAŠEL AŽ NA DATECH.
 *
 * Plán chtěl kontrolu `Origin` proti `TrackingDomainCache`, tedy proti mapě,
 * kterou plnil dotaz NAPŘÍČ PROJEKTY, tedy bez `mlain.workspace_id`. Tabulka
 * `tracking_domains` má jedinou politiku `ws_isolation`, která bez toho
 * nastavení porovnává `workspace_id` s NULL, takže dotaz vracel VŽDY NULA
 * ŘÁDKŮ. Nic přitom nespadlo a cache vypadala v pořádku. Navenek to bylo
 * „doménu mám v seznamu a `/e/track` mi vrací 403". Ověřeno proti běžící
 * instalaci: doména `localhost` byla v tabulce a odpověď byla
 * `403 origin_not_allowed`.
 *
 * Cross-workspace čtení tady navíc není potřeba. Veřejný klíč se ověřuje DŘÍV
 * než `Origin`, takže projekt v tu chvíli známe a stačí se zeptat na jeho
 * řádky v jeho vlastním kontextu.
 *
 * `TrackingDomainCache` je dnes opravená stejným způsobem a čte přes tentýž
 * dotaz v repozitáři, takže obě cesty vidí totéž.
 */
export function readAllowedOrigins(ctx: WorkspaceContext): Promise<AllowedOrigin[]> {
  return selectAllowedOrigins(ctx);
}

export type WebTrackingStatus = {
  /** Počet webových událostí za posledních 30 dní. */
  recentEvents: number;
  lastEventAt: Date | null;
  /** Kolik prohlížečů se za 30 dní ozvalo. Nula znamená „zatím nic". */
  recentVisitors: number;
};

/**
 * Odpověď na jedinou otázku, kterou uživatel po nasazení úryvku má:
 * „přišlo už nám odsud něco?"
 */
export async function readWebTrackingStatus(ctx: WorkspaceContext): Promise<WebTrackingStatus> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      events: string;
      last_at: Date | null;
      visitors: string;
    }>(sql`
      SELECT count(*)::text AS events,
             max(occurred_at) AS last_at,
             count(DISTINCT coalesce(anonymous_id, contact_id))::text AS visitors
        FROM web_events
       WHERE workspace_id = ${ctx.workspaceId}
         AND source IN ('web', 'server')
         AND received_at >= now() - interval '30 days'
    `);
    const row = rows[0];
    return {
      recentEvents: Number(row?.events ?? '0'),
      lastEventAt: row?.last_at == null ? null : new Date(row.last_at),
      recentVisitors: Number(row?.visitors ?? '0'),
    };
  });
}
