import { envelopeKeyId } from '@mlain/contracts/crypto';
import { currentKeyId, keyringFromEnv } from '@mlain/contracts/keyring';
import { rawSql } from '../../campaigns/repo/raw-sql';
import { createSystemContext } from '../../identity/context';
import { reencryptProviderCredentials } from '../../providers/crypto';
import { getProviderSecret } from '../../providers/repo/provider';
import { withWorkspace } from '../../tx';
import type { CredentialsRefreshDeps } from './credentials-refresh';

/**
 * Kompoziční kořen domény senderu.
 *
 * Sender sám je proces v Go a pg-boss nepoužívá; tahle doména existuje kvůli
 * jediné frontě, kterou jeho provoz zakládá NA STRANĚ APLIKACE. Proto je tady
 * jeden soubor a ne obvyklá dvojice `deps.ts` plus `system-deps.ts`.
 *
 * Náklad nese `workspace_id`, takže se výčet projektů napříč instalací nepotřebuje
 * a všechno běží pod `mlain_app` v systémovém kontextu jednoho projektu, tedy
 * pod RLS stejně jako požadavek z API.
 *
 * KEYRING SE ČTE AŽ UVNITŘ funkcí, ne na úrovni modulu. Ze stejného důvodu jako
 * `loadConfig()` v doméně kampaní: na úrovni modulu by chybějící SECRET_KEY
 * shodil každý jednotkový test, který se souboru jen dotkne. A navíc by proces,
 * který běží od restartu, držel starý keyring i po změně prostředí.
 */
function keyring() {
  return keyringFromEnv();
}

export function systemCredentialsRefreshDeps(): CredentialsRefreshDeps {
  const job = 'sender.credentials_refresh';

  return {
    loadStored: (input) =>
      getProviderSecret(createSystemContext(input.workspace_id, job), input.provider_id),

    keyIdOf: (stored) => envelopeKeyId(stored),

    currentKeyId: () => currentKeyId(keyring()),

    knowsKey: (keyId) => keyring().has(keyId),

    reencrypt: (input) =>
      reencryptProviderCredentials({ stored: input.stored, workspaceId: input.workspaceId }),

    /**
     * Zápis nové obálky.
     *
     * SQL je tady, ne v repozitáři odesílacích účtů, a je to schválně: samostatná
     * funkce „přepiš config_encrypted" by byla v repozitáři dostupná komukoliv
     * a přesně takhle se dá tajemství přepsat omylem. Tenhle zápis smí existovat
     * jen v cestě rotace klíče, takže bydlí v ní.
     *
     * `config_public` se NEPŘEPISUJE. Je to odvozená kopie téhož obsahu a rotace
     * klíče obsah nemění, jen jeho obálku; přepsat ji by znamenalo dešifrovat
     * a znovu odvodit něco, co je už uložené správně.
     *
     * Podmínka na `config_encrypted` v `WHERE` je pojistka proti souběhu s
     * `mlain rotate-credentials`: kdyby mezitím přešifroval tentýž řádek, zápis
     * neprojde a úloha skončí jako opakovatelná, místo aby přepsala cizí výsledek.
     */
    store: async (input) => {
      const ctx = createSystemContext(input.workspace_id, job);
      const affected = await withWorkspace(ctx, async (tx) => {
        const r = await tx.execute(
          rawSql(
            `UPDATE sending_providers
                SET config_encrypted = $3, updated_at = now()
              WHERE id = $1 AND workspace_id = $2 AND config_encrypted = $4`,
            [input.provider_id, ctx.workspaceId, input.stored, input.storedBefore],
          ),
        );
        return r.rowCount ?? 0;
      });
      if (affected === 0) {
        throw new Error(
          `Přístupové údaje účtu ${input.provider_id} se mezitím změnily, zápis se neprovedl. ` +
            'Nejspíš je zároveň přešifroval mlain rotate-credentials. Úloha se zopakuje.',
        );
      }
    },
  };
}
