/**
 * BRANDING VEŘEJNÝCH STRÁNEK: co se smí ukázat cizímu člověku.
 *
 * Veřejné stránky (děkovací po formuláři, potvrzení souhlasu, odhlášení, centrum
 * předvoleb) vidí kdokoli, kdo dostane odkaz. Jediné jméno, které se na nich smí
 * objevit, je jméno ODESÍLATELE, tedy to, co příjemce už zná z pole Od ve schránce.
 *
 * Jméno projektu je proti tomu interní popisek do postranního menu. Lidé si tam píšou
 * věci jako „Petr Osobní mail" nebo „Klient Novák, faktury" a nepočítají s tím, že to
 * uvidí kdokoli, kdo si otevře formulář. Do 7. 8. 2026 se přesto bralo právě ono,
 * včetně titulku okna prohlížeče.
 *
 * Testy jsou dva a druhý je ten důležitý: kontroluje stav BEZ identity odesílatele,
 * kdy je svůdné „aspoň něco" doplnit z projektu. Právě tou úvahou vada vznikla.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  seedProvider,
  withTestWorkspace,
  type TestWorkspace,
} from '../../../campaigns/test/harness';
import { rawSql } from '../../../campaigns/repo/raw-sql';
import { withWorkspace } from '../../../tx';
import { publicScope } from '../context';

async function workspaceName(ctx: TestWorkspace): Promise<string> {
  const { rows } = await withWorkspace(ctx.workspace, (tx) =>
    tx.execute<{ name: string }>(
      rawSql(`SELECT name FROM workspaces WHERE id = $1`, [ctx.workspaceId]),
    ),
  );
  return rows[0]!.name;
}

async function seedIdentity(
  ctx: TestWorkspace,
  input: { fromName: string; isDefault: boolean },
): Promise<void> {
  const providerId = await seedProvider(ctx, {});
  const domainId = randomUUID();
  await withWorkspace(ctx.workspace, async (tx) => {
    await tx.execute(
      rawSql(
        `INSERT INTO sender_domains (id, workspace_id, provider_id, domain, verified_at)
         VALUES ($1, $2, $3, $4, now())`,
        [domainId, ctx.workspaceId, providerId, `d-${domainId.slice(0, 8)}.cz`],
      ),
    );
    await tx.execute(
      rawSql(
        `INSERT INTO sender_identities
           (workspace_id, name, from_name, from_email, provider_id, sender_domain_id, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.workspaceId,
          `Predvolba ${input.fromName}`,
          input.fromName,
          `pošta@d-${domainId.slice(0, 8)}.cz`,
          providerId,
          domainId,
          input.isDefault,
        ],
      ),
    );
  });
}

describe('branding veřejné stránky', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('ukazuje jméno odesílatele, ne jméno projektu', async () => {
    await seedIdentity(ctx, { fromName: 'Kolo Shop', isDefault: true });

    const scope = await publicScope(ctx.workspaceId, 'test');
    expect(scope?.branding.senderName).toBe('Kolo Shop');
    expect(scope?.branding.senderName).not.toBe(await workspaceName(ctx));
  });

  /**
   * Projekt bez identity odesílatele NEDOSTANE náhradní jméno. Prázdno je záměr:
   * stránka pak jméno nekreslí vůbec a v titulku zůstane název produktu. Doplnit
   * sem jméno projektu je přesně ta oprava, kvůli které vada vznikla.
   */
  it('bez identity odesílatele zůstane jméno PRÁZDNÉ, projekt se nepůjčuje', async () => {
    const scope = await publicScope(ctx.workspaceId, 'test');
    expect(scope?.branding.senderName).toBe('');
  });

  /**
   * Výchozí předvolba vyhrává nad starší. Bez `is_default DESC` v řazení by na
   * veřejné stránce svítila ta, kterou člověk založil první, kdežto v e-mailu by
   * stálo jméno jiné, a ta dvě jména mají být tatáž.
   */
  it('vyhrává VÝCHOZÍ předvolba, ne nejstarší', async () => {
    await seedIdentity(ctx, { fromName: 'Stará', isDefault: false });
    await seedIdentity(ctx, { fromName: 'Výchozí', isDefault: true });

    const scope = await publicScope(ctx.workspaceId, 'test');
    expect(scope?.branding.senderName).toBe('Výchozí');
  });
});
