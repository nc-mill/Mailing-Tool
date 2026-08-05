import { describe, expect, it } from 'vitest';
import { updateWorkspace } from '../../../identity/workspace-service';
import { enqueueRefingerprint } from '../../../ops/rotate-credentials';
import { withWorkspace } from '../../../tx';
import { recomputeGreeting, type RecomputeGreetingPayload } from '../../jobs/recompute-greeting';
import { refingerprintContacts } from '../../jobs/refingerprint';
import { writeContact } from '../../repo/contacts';
import { enqueuedJobs, findByEmail, testContext } from '../support/db';

/**
 * Producenti obou front, které je NEMĚLY.
 *
 * Zapojit konzumenta u fronty, do které nikdo nic nezařazuje, vypadá jako hotová
 * práce a přitom se nestane nic: úloha nevznikne, job nikdy neběží a chybějící
 * půlka není odnikud vidět. Tenhle soubor proto jde od doménové akce (změna
 * nastavení projektu, rotace klíče) přes řádek v `pgboss.job` až po zpracování
 * TÍMTO nákladem, aby se tvar nákladu nemohl rozejít s tím, co obsluha čeká.
 */

describe('producent contacts.recompute_greeting', () => {
  it('změna vykání na tykání zařadí přepočet a náklad sedí na obsluhu', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'jana@x.cz', firstName: 'Jana', attributes: {} });
    expect((await findByEmail(ctx, 'jana@x.cz')).greeting).toBe('Dobrý den, Jano');

    await withWorkspace(ctx, (tx) =>
      updateWorkspace(tx, ctx, { address_form: 'informal' }, 'test'),
    );

    const jobs = await enqueuedJobs('contacts.recompute_greeting');
    const mine = jobs.filter(
      (job) => (job.data as { workspaceId?: string }).workspaceId === ctx.workspaceId,
    );
    expect(mine).toHaveLength(1);

    // Náklad z fronty se pouští TAK, JAK V NÍ LEŽÍ. Kdyby producent psal
    // `workspace_id` a obsluha četla `workspaceId`, prošlo by to typovou
    // kontrolou i revizí a projevilo by se to až prázdným během.
    await recomputeGreeting(mine[0]!.data as RecomputeGreetingPayload);
    expect((await findByEmail(ctx, 'jana@x.cz')).greeting).toBe('Ahoj Jano');
  });

  /**
   * ZMĚNA JAZYKA PROJEKTU. Kontakty zdědily jazyk projektu při vzniku, takže po
   * přepnutí na češtinu měly dál `locale = 'en'`, ve sloupci vokativu nominativ
   * a v oslovení anglickou předlohu. Bez tohohle producenta byla jediná náprava
   * otevřít každý kontakt zvlášť.
   */
  it('změna jazyka projektu zařadí přepočet, který sjednotí i jazyk kontaktů', async () => {
    const ctx = await testContext();
    await withWorkspace(ctx, (tx) => updateWorkspace(tx, ctx, { locale: 'en' }, 'test'));
    await writeContact(ctx, { email: 'petr@x.cz', firstName: 'Petr', attributes: {} });
    expect((await findByEmail(ctx, 'petr@x.cz')).greeting).toBe('Hello Petr');

    await withWorkspace(ctx, (tx) => updateWorkspace(tx, ctx, { locale: 'cs' }, 'test'));

    const jobs = await enqueuedJobs('contacts.recompute_greeting');
    const mine = jobs.filter(
      (job) => (job.data as { workspaceId?: string }).workspaceId === ctx.workspaceId,
    );
    // Dva běhy: první za přepnutí na angličtinu, druhý za návrat k češtině.
    expect(mine).toHaveLength(2);
    expect(mine[1]!.data).toMatchObject({ alignLocale: { to: 'cs', from: 'en' } });

    await recomputeGreeting(mine[1]!.data as RecomputeGreetingPayload);
    const row = await findByEmail(ctx, 'petr@x.cz');
    expect(row.locale).toBe('cs');
    expect(row.first_name_vocative).toBe('Petře');
    expect(row.greeting).toBe('Dobrý den, Petře');
  });

  it('změna, která se oslovení netýká, úlohu nezařadí', async () => {
    const ctx = await testContext();
    await withWorkspace(ctx, (tx) => updateWorkspace(tx, ctx, { name: 'Jiné jméno' }, 'test'));

    const jobs = await enqueuedJobs('contacts.recompute_greeting');
    expect(
      jobs.filter((job) => (job.data as { workspaceId?: string }).workspaceId === ctx.workspaceId),
    ).toHaveLength(0);
  });

  it('nastavení téže hodnoty úlohu nezařadí', async () => {
    const ctx = await testContext();
    await withWorkspace(ctx, (tx) => updateWorkspace(tx, ctx, { address_form: 'formal' }, 'test'));

    const jobs = await enqueuedJobs('contacts.recompute_greeting');
    expect(
      jobs.filter((job) => (job.data as { workspaceId?: string }).workspaceId === ctx.workspaceId),
    ).toHaveLength(0);
  });
});

describe('producent contacts.refingerprint', () => {
  it('rotace klíče zařadí doplnění otisků s pokolením v nákladu', async () => {
    // Táž dvojice klíčů, jakou příkazu předává konfigurace po rotaci.
    await enqueueRefingerprint({
      secretKey: `2:${Buffer.alloc(32, 9).toString('base64url')}`,
      secretKeyPrevious: `1:${Buffer.alloc(32, 7).toString('base64url')}`,
    });

    const jobs = await enqueuedJobs('contacts.refingerprint');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({ keyId: 2 });

    // A náklad je ten, který obsluha umí přečíst. Pokolení 2 v prostředí
    // testu není, takže job musí NAHLAS říct, že běží se starou konfigurací;
    // právě to je jeho pojistka proti tichému doplnění pod starým klíčem.
    await expect(refingerprintContacts(jobs[0]!.data as { keyId: number })).rejects.toThrow(
      /pokolení klíče 2/,
    );
  });
});
