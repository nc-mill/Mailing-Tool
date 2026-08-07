import { createTextEngine } from '@mlain/contracts/liquid/engine';
import { isPresent } from '@mlain/contracts/liquid/prepare-render-data';
import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../tx';

/**
 * Kořeny `campaign` a `workspace`, tedy hodnoty za merge tagy
 * `{{ campaign.name }}`, `{{ campaign.subject }}`, `{{ workspace.name }}`
 * a `{{ workspace.sender_address }}`.
 *
 * DO `messages.render_data` SE NESNAPSHOTUJÍ, a je to záměr. Jsou konstantní
 * pro celou kampaň, kdežto render_data je na zprávu a má strop
 * `RENDER_DATA_MAX_BYTES`; u milionové kampaně by kopie názvu, předmětu,
 * názvu projektu a poštovní adresy do každého řádku znamenala stovky
 * megabajtů kvůli údaji, který se v rámci kampaně nemění. Odesílač je proto
 * čte z hlavičky kampaně (`apps/sender/internal/campaign/header.go`) a doplňuje
 * je před interpolací, stejně jako odhlašovací odkaz.
 *
 * TENHLE MODUL JE DRUHÁ POLOVINA TÉHOŽ. Web renderuje uloženou zprávu ještě na
 * dvou místech: „Zobrazit v prohlížeči" (`contacts/public/webview.ts`) a sekce
 * reportu „Co se doopravdy rozeslalo" (`reports/sent-content/read.ts`). Obě
 * berou `compiled_html` a `render_data`, takže bez tohohle doplnění by
 * v prohlížeči chyběla poštovní adresa v patičce, kterou příjemce v e-mailu
 * VIDĚL. Rozdíl mezi tím, co se odeslalo, a tím, co ukazuje aplikace, je
 * v tomhle produktu nejzávažnější třída vad, ne kosmetika.
 */
export type CampaignRenderRoots = {
  campaign: { name: string; subject: string; preheader: string };
  workspace: { name: string; sender_address: string };
};

/** Syrové hodnoty z databáze. Předmět a preheader jsou ZDROJE, ne hotový text. */
export type CampaignRootsSource = {
  campaignName: string;
  subjectSource: string;
  preheaderSource: string;
  workspaceName: string;
  postalAddress: string;
};

/**
 * Načte podklad pro kořeny z kampaně a projektu.
 *
 * Poštovní adresa žije v `workspaces.settings.campaigns.postal_address`, tedy
 * na PROJEKTU, ne na kampani: je to poštovní adresa firmy, kterou musí obchodní
 * sdělení nést, a ta se mezi kampaněmi nemění. Tentýž výraz čte odesílač ve
 * `StmtCampaignHeader`.
 */
export async function readCampaignRootsSource(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignRootsSource | null> {
  const { rows } = await tx.execute<{
    campaign_name: string;
    subject: string | null;
    preheader: string | null;
    workspace_name: string;
    postal_address: string | null;
  }>(sql`
    SELECT c.name AS campaign_name, c.subject, c.preheader,
           w.name AS workspace_name,
           w.settings #>> '{campaigns,postal_address}' AS postal_address
      FROM campaigns c
      JOIN workspaces w ON w.id = c.workspace_id
     WHERE c.id = ${campaignId}::uuid
       AND c.workspace_id = ${ctx.workspaceId}::uuid
       AND c.deleted_at IS NULL
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    campaignName: row.campaign_name,
    subjectSource: row.subject ?? '',
    preheaderSource: row.preheader ?? '',
    workspaceName: row.workspace_name,
    postalAddress: row.postal_address ?? '',
  };
}

/**
 * Klíč do mapy `_present`: cesta s tečkami nahrazenými dvěma podtržítky.
 * Tvar určuje `emitter/visibility-tags.ts`, tady se jen čte zpátky.
 */
const PRESENCE_ROOT_PREFIXES = ['campaign__', 'workspace__'] as const;

/**
 * Přepočítá `_present` pro kořeny, které se dodávají až tady.
 *
 * Mapu plní `prepareRenderData` při materializaci, jenže tam hodnoty ještě
 * nejsou, takže každý blok podmíněný vyplněností poštovní adresy vyšel jako
 * nepravda a TIŠE SE SKRYL. Odesílač dělá totéž ve `refreshPresence`
 * (`apps/sender/internal/app/worker.go`); obě strany musí dojít ke stejnému
 * výsledku, jinak se prohlížeč rozejde s e-mailem.
 */
function withPresence(
  data: Record<string, unknown>,
  roots: CampaignRenderRoots,
): Record<string, unknown> {
  const present = data['_present'];
  if (present === null || typeof present !== 'object') return data;

  const next: Record<string, unknown> = { ...(present as Record<string, unknown>) };
  for (const key of Object.keys(next)) {
    const prefix = PRESENCE_ROOT_PREFIXES.find((p) => key.startsWith(p));
    if (prefix === undefined) continue;
    const root = prefix.slice(0, -2) as 'campaign' | 'workspace';
    const field = key.slice(prefix.length).replace(/__/g, '.');
    next[key] = isPresent((roots[root] as Record<string, unknown>)[field]);
  }
  return { ...data, _present: next };
}

/**
 * Předmět a preheader se RENDERUJÍ, nedosazují se jako zdroj.
 *
 * Předmět bývá personalizovaný („Ahoj {{ contact.first_name }}"), takže dosadit
 * do těla jeho zdroj by ukázalo syrový Liquid výraz. Odesílač je proto
 * renderuje jako první a hotovou podobu teprve dává do kořene `campaign`.
 *
 * Sám na sebe merge tag v předmětu nedosáhne: při jeho renderu je hodnota ještě
 * prázdná. Rekurze v Liquidu nemá konec a sebeodkaz nedává smysl.
 */
export async function buildCampaignRenderRoots(
  data: Record<string, unknown>,
  source: CampaignRootsSource,
): Promise<CampaignRenderRoots> {
  const engine = createTextEngine();
  const seed: CampaignRenderRoots = {
    campaign: { name: source.campaignName, subject: '', preheader: '' },
    workspace: { name: source.workspaceName, sender_address: source.postalAddress },
  };
  const base = { ...data, ...seed };

  // Předmět, který se nezparsuje, tuhle stránku nesmí položit. Odesílač na něm
  // zprávu odmítne a kampaň se pozastaví; náhledu stačí prázdná hodnota, jinak
  // by report o odeslané kampani skončil chybou kvůli údaji vedle obsahu.
  const render = async (src: string): Promise<string> => {
    if (src === '') return '';
    try {
      return await engine.parseAndRender(src, base);
    } catch {
      return '';
    }
  };

  return {
    campaign: {
      name: source.campaignName,
      subject: await render(source.subjectSource),
      preheader: await render(source.preheaderSource),
    },
    workspace: seed.workspace,
  };
}

/** Data zprávy doplněná o kořeny odesílatele včetně opravené mapy `_present`. */
export async function withCampaignRoots(
  data: Record<string, unknown>,
  source: CampaignRootsSource,
): Promise<{ data: Record<string, unknown>; roots: CampaignRenderRoots }> {
  const roots = await buildCampaignRenderRoots(data, source);
  return { data: withPresence({ ...data, ...roots }, roots), roots };
}
