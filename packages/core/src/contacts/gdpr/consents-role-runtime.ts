import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { gdprConfigured, withGdpr } from '../../tx';
import { registerConsentEraser } from './consents-role';

/**
 * PRODUKČNÍ zapojení portu z `consents-role.ts`. Ten port popisuje, co chybí;
 * tenhle soubor to dodává.
 *
 * PROČ TO NEBYLO. `registerConsentEraser` volaly do téhle chvíle JEDINĚ testy
 * (`contacts/test/support/phase-c.ts`), takže produkční cesta k roli
 * `mlain_gdpr` neexistovala a výmaz podle článku 17 v režimu `anonymize`, tedy
 * ve VÝCHOZÍM režimu, selhal pokaždé. Selhal hlasitě a se srozumitelným kódem
 * `gdpr_role_unavailable`, takže to nebylo tiché; nedoběhla ale zákonná
 * povinnost, a ta se hlasitým selháním nesplní.
 *
 * TVAR JE OPSANÝ z `platform/maintenance-scan.ts` a role `mlain_maintenance`,
 * protože je to čerstvý a ověřený vzor téhož problému: vyhrazená role, vlastní
 * VOLITELNÉ připojení (`DATABASE_URL_GDPR`), a když ho operátor nenastaví,
 * úloha ODMÍTNE BĚŽET s vysvětlením, místo aby tiše přeskočila.
 *
 * JEDEN ROZDÍL PROTI ÚDRŽBĚ, a je podstatný. `withMaintenance` je transakce
 * BEZ kontextu, protože ta role má politiky `maintenance_*` s `USING (true)`.
 * `withGdpr` je transakce V KONTEXTU PROJEKTU: `consents` má jedinou politiku
 * `ws_isolation`, žádnou výjimku, takže bez nastaveného `mlain.workspace_id`
 * by `DELETE` smazal NULA ŘÁDKŮ A NEVRÁTIL CHYBU. To je přesně ta tichá
 * varianta selhání, kterou tenhle produkt nikde nepřipouští.
 *
 * Registrace je idempotentní: druhé volání jen přepíše tutéž funkci, takže
 * volání z víc kompozičních kořenů (worker, CLI) nevadí.
 */
export function installConsentEraser(): void {
  registerConsentEraser(async ({ workspaceId, contactId }) => {
    const ctx = createSystemContext(workspaceId, 'gdpr.erase');
    return withGdpr(ctx, async (tx) => {
      /**
       * `workspace_id` je v podmínce ZÁMĚRNĚ, přestože ho vynucuje i politika.
       * Politika je bezpečnostní vrstva, ne dotaz: kdyby ji někdo v budoucnu
       * změnil, tenhle příkaz nesmí začít mazat napříč projekty. Je to týž
       * postup jako u ostatních dotazů domény.
       */
      const result = await tx.execute(sql`
        DELETE FROM consents
         WHERE workspace_id = ${workspaceId}::uuid
           AND contact_id = ${contactId}::uuid
      `);
      return { deleted: result.rowCount ?? 0 };
    });
  });
}

/**
 * Reexport pro kompoziční kořeny, aby si kvůli jedné podmínce při startu
 * nemusely tahat adaptér transakcí. Vrací `false`, když `DATABASE_URL_GDPR`
 * chybí, tedy když výmaz doběhnout NEMŮŽE.
 */
export { gdprConfigured };
