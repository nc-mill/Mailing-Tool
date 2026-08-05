import { STALL_WATCH_QUIET_SECONDS } from '../constants';

export const STALL_WATCH_JOB = {
  queue: 'outbox.stall_watch' as const,
  cron: '* * * * *',
  retryLimit: 3,
  expireInSeconds: 60,
};

/**
 * Zaseknutá dávka v outboxu, tedy kampaň, která se tváří, že odesílá, a přitom
 * se v ní nic nehýbe.
 *
 * PROČ TO NEUZAVÍRÁ ANI NEPOZASTAVUJE. Uzavírání kampaní vlastní `campaign.watchdog`
 * a ten se ptá na opačnou otázku: jestli je outbox PRÁZDNÝ. Tahle úloha se ptá,
 * jestli v něm něco ZBÝVÁ a nikdo si to nebere. To se hlásí, ne opravuje: příčina
 * je vždycky mimo databázi (sender neběží, nemá přístup k databázi, běží s jiným
 * SECRET_KEY, nebo mu provider odmítá každou zprávu) a pozastavení kampaně by
 * zakrylo skutečný problém a přidalo k němu druhý.
 *
 * Přesně tenhle stav stál čtyři dny: sender vůbec neběžel, kampaň zůstala ve stavu
 * `sending` s čekajícími zprávami a nikde se to neprojevilo, protože jediné místo,
 * kde se `stalled` počítalo, byl dotaz obrazovky na průběh. Kdo se na obrazovku
 * nedíval, nedozvěděl se nic.
 */
export type StalledCampaign = {
  workspaceId: string;
  campaignId: string;
  pending: number;
  quietSeconds: number;
};

export type StallWatchDeps = {
  /** Kampaně ve stavu `queueing`, `sending` nebo `paused` napříč projekty. */
  listRunning(): Promise<Array<{ workspaceId: string; campaignId: string; status: string }>>;
  /**
   * Počet nevyřízených zpráv a čas POSLEDNÍ ZMĚNY ZPRÁVY.
   *
   * Čas se bere z `max(messages.updated_at)`, NIKDY z `campaigns.updated_at`.
   * Hlídač kampaní totiž každých patnáct sekund bezpodmínečně přepočítá čítače,
   * což je `UPDATE campaigns`, takže `campaigns.updated_at` je čerstvé pořád
   * a zaseknutí by se podle něj nepoznalo NIKDY. Tutéž past má dnes výpočet
   * `stalled` v trase na průběh kampaně; tahle úloha ji neopakuje.
   */
  outboxState(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ pending: number; lastChangeAt: Date } | null>;
  report(stalled: StalledCampaign[]): void;
  now(): Date;
  quietSeconds?: number;
};

export async function stallWatchHandler(deps: StallWatchDeps): Promise<StalledCampaign[]> {
  const quietSeconds = deps.quietSeconds ?? STALL_WATCH_QUIET_SECONDS;
  const stalled: StalledCampaign[] = [];

  for (const c of await deps.listRunning()) {
    // Pozastavená kampaň se nehýbe schválně a hlásit ji jako zaseknutou by bylo
    // hlášení o vlastním nastavení. `queueing` se taky přeskakuje: v té fázi se
    // publikum teprve materializuje a zprávy ještě nikdo brát nemá.
    if (c.status !== 'sending') continue;

    const state = await deps.outboxState(c.workspaceId, c.campaignId);
    // Kampaň zmizela mezi skenem a čtením. Není co hlásit.
    if (state === null) continue;
    if (state.pending === 0) continue;

    const quietFor = (deps.now().getTime() - state.lastChangeAt.getTime()) / 1000;
    if (quietFor < quietSeconds) continue;

    stalled.push({
      workspaceId: c.workspaceId,
      campaignId: c.campaignId,
      pending: state.pending,
      quietSeconds: Math.round(quietFor),
    });
  }

  // Hlásí se JEDNÍM voláním, i když je seznam prázdný. Volající tak pozná rozdíl
  // mezi „hlídač proběhl a nic nenašel" a „hlídač vůbec neběžel".
  deps.report(stalled);
  return stalled;
}
