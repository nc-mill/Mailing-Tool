import { maintainPartitions, type RetentionReport } from '../partition-retention';

/**
 * ÚDRŽBA ODDÍLŮ JAKO NOČNÍ ÚLOHA WORKERU.
 *
 * PROČ TO VŮBEC VZNIKLO. Do 7. 8. 2026 uměl úklid odeslané pošty jedině
 * `mlain partitions` z plánovače hostitele. Dodávaná instalace ho tedy
 * NESPOUŠTĚLA VŮBEC: ani `docker/compose.yml`, ani `compose.scale.yml` žádný
 * plánovač nemají, jediný návod bylo „založte si cron na hostiteli" a na PaaS,
 * kde provozovatel k hostiteli přístup nemá, to nejde ani udělat. Důsledek není
 * kosmetický: `messages.render_data` s personalizačními údaji příjemce leželo
 * přes lhůtu danou `MESSAGE_RETENTION_DAYS` a po čtyřech měsících by instalace
 * přestala přijímat zápisy, protože se nezaloží další oddíl. Nález doktoru
 * `no_partition_maintenance_yet` to od téhož dne vidí, ale vidět vadu není
 * totéž co ji opravit; každá instalace z našeho compose by ho hlásila napořád.
 *
 * PROČ CRONOVÁ FRONTA, A NE KONTEJNER S CRONEM V COMPOSE. Pravidelnou práci
 * v tomhle produktu dělá worker přes pg-boss, a je to jediný mechanismus, který
 * funguje na všech třech způsobech nasazení (MODE=all, rozdělený compose, PaaS).
 * Kontejner s cronem by byl čtvrtý způsob, jak se v produktu spouští pravidelná
 * práce, a na PaaS by stejně nepomohl.
 *
 * PROČ TO SMÍ SÁHNOUT NA MIGRÁTORSKÉ URL. Odpojení oddílu je DDL a aplikační
 * role `mlain_app` schéma nevlastní. Job proto NEBĚŽÍ pod aplikační rolí:
 * `maintainPartitions()` si otevře vlastní spojení pod
 * `DATABASE_URL_MIGRATOR`, přesně jako `mlain partitions`. Aplikační role
 * žádné nové právo nedostává, takže padá i původní námitka „pak by kterákoli
 * chyba v kterékoli obsluze mohla zahodit tabulku". Není to ani nová výjimka:
 * `platform.backup` v témhle souboru vedle běží pod migrátorem od P16, protože
 * pod aplikační rolí by `pg_dump` narazil na row level security.
 *
 * BEZ `DATABASE_URL_MIGRATOR` ÚLOHA SPADNE, a je to úmysl, ne opomenutí. Tichý
 * návrat by znamenal, že fronta každou noc reportuje úspěch a neuklízí nic,
 * tedy přesně ten stav, kvůli kterému tahle práce vznikla. Chová se to stejně
 * jako `platform.backup`, který na chybějící proměnnou padá taky.
 */
export type PartitionJobContext = {
  config: {
    DATABASE_URL_MIGRATOR: string | undefined;
  };
};

/** Fronta `platform.maintain_partitions`, cron `5 2 * * *`. */
export async function partitionMaintenanceJob(ctx: PartitionJobContext): Promise<RetentionReport> {
  const url = ctx.config.DATABASE_URL_MIGRATOR;
  if (!url) {
    throw new Error(
      'Údržba oddílů vyžaduje DATABASE_URL_MIGRATOR. Aplikační role mlain_app schéma ' +
        'nevlastní, takže ALTER TABLE ... DETACH PARTITION jí skončí na „permission denied", ' +
        'a kvůli row level security by navíc neviděla zprávy, podle kterých se rozhoduje, ' +
        'jestli je oddíl zbytný. Do doplnění proměnné neběží retence odeslané pošty a ' +
        'nezakládají se oddíly dopředu.',
    );
  }

  const { report, auditError } = await maintainPartitions({
    migratorUrl: url,
    // Totéž okno, jaké zakládá migrační runner. Kratší okno by znamenalo, že
    // instalace, kde worker týden stál, nemá kam zapisovat.
    ensureMonths: 4,
    actorLabel: 'platform.maintain_partitions',
  });

  /**
   * NEZAPSANÝ AUDIT SE TADY VYHAZUJE, na rozdíl od CLI. Rozdíl je v tom, kdo
   * se dívá: u příkazu je čtenářem plánovač hostitele a chybový výstup se mu
   * doručí, kdežto ve workeru je jediné trvalé místo tabulka úloh. Selhaná
   * úloha je tedy jediný způsob, jak se o ztraceném záznamu vůbec dozvědět,
   * a bez něj by `mlain doctor` do dvou dnů hlásil, že údržba neběží, přestože
   * běžela. Úklid sám je idempotentní, takže opakování ničemu neublíží:
   * oddíly dopředu se zakládají přes IF NOT EXISTS a plán úklidu se počítá
   * ze skutečného stavu katalogu, ne z předchozího běhu.
   */
  if (auditError !== null) {
    throw new Error(
      `Údržba oddílů proběhla, ale nepodařilo se ji zapsat do auditu: ${auditError.message}. ` +
        'Bez toho záznamu začne mlain doctor do dvou dnů hlásit, že údržba neběží.',
      { cause: auditError },
    );
  }
  return report;
}
