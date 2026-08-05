import { describe, expect, it, vi } from 'vitest';
import {
  credentialsRefreshHandler,
  type CredentialsRefreshDeps,
  type CredentialsRefreshPayload,
} from './credentials-refresh';

const PAYLOAD: CredentialsRefreshPayload = {
  workspace_id: '019fc763-7184-72dd-a48d-3cf3ec306179',
  provider_id: '019fc799-e0de-7d04-aa3a-0a29b64cda4e',
};

const STARA = 'enc:v1:stara-obalka-pod-pokolenim-1';
const NOVA = 'enc:v1:nova-obalka-pod-pokolenim-2';

function harness(over: Partial<CredentialsRefreshDeps> = {}): {
  deps: CredentialsRefreshDeps;
  store: ReturnType<typeof vi.fn>;
  reencrypt: ReturnType<typeof vi.fn>;
} {
  const store = vi.fn(async () => {});
  const reencrypt = vi.fn(() => NOVA);
  const deps: CredentialsRefreshDeps = {
    loadStored: async () => STARA,
    keyIdOf: () => 1,
    currentKeyId: () => 2,
    knowsKey: () => true,
    reencrypt,
    store,
    ...over,
  };
  return { deps, store, reencrypt };
}

describe('obnova pristupovych udaju odesilaciho uctu', () => {
  it('presifruje obalku pod starym pokolenim klice', async () => {
    const { deps, store, reencrypt } = harness();

    const result = await credentialsRefreshHandler(deps, PAYLOAD);

    expect(result).toEqual({ outcome: 'refreshed', fromKeyId: 1, toKeyId: 2 });
    expect(reencrypt).toHaveBeenCalledWith({
      stored: STARA,
      workspaceId: PAYLOAD.workspace_id,
    });
    expect(store).toHaveBeenCalledWith({
      ...PAYLOAD,
      stored: NOVA,
      storedBefore: STARA,
    });
  });

  /**
   * IDEMPOTENCE. Úlohu zařazuje hlídač a pg-boss ji při selhání opakuje, takže
   * druhý průchod nad už přešifrovaným účtem musí být bez zápisu. Přešifrovat
   * znovu by dalo tentýž obsah, ale s jiným nonce, takže by se sloupec měnil
   * při každém tiku a nešlo by poznat, kdy se opravdu něco stalo.
   */
  it('nezapisuje, kdyz je obalka uz pod aktualnim klicem', async () => {
    const { deps, store, reencrypt } = harness({ keyIdOf: () => 2 });

    expect(await credentialsRefreshHandler(deps, PAYLOAD)).toEqual({
      outcome: 'already_current',
      keyId: 2,
    });
    expect(store).not.toHaveBeenCalled();
    expect(reencrypt).not.toHaveBeenCalled();
  });

  it('ucet, ktery mezitim zmizel, konci stavem gone, ne chybou', async () => {
    const { deps, store } = harness({ loadStored: async () => null });

    expect(await credentialsRefreshHandler(deps, PAYLOAD)).toEqual({ outcome: 'gone' });
    expect(store).not.toHaveBeenCalled();
  });

  /**
   * Chybějící staré pokolení je jediný stav, kde se nedá nic udělat, a proto se
   * hlásí NAHLAS. Ticho by tady bylo nejhorší možná odpověď: kampaň zůstane
   * pozastavená na credentials_undecryptable a úloha by se tvářila jako hotová.
   */
  it('bez stareho pokoleni v keyringu spadne a rekne, co doplnit', async () => {
    const { deps, store } = harness({ knowsKey: () => false });

    await expect(credentialsRefreshHandler(deps, PAYLOAD)).rejects.toThrow(/SECRET_KEY_PREVIOUS/);
    expect(store).not.toHaveBeenCalled();
  });

  it('nectitelna obalka spadne s vysvetlenim, ne s holym crypto_envelope_malformed', async () => {
    const { deps, store } = harness({
      keyIdOf: () => {
        throw new Error('crypto_envelope_malformed');
      },
    });

    await expect(credentialsRefreshHandler(deps, PAYLOAD)).rejects.toThrow(/config_encrypted/);
    expect(store).not.toHaveBeenCalled();
  });

  /**
   * Pořadí je podstatné: pokolení se čte z hlavičky obálky, tedy BEZ dešifrování
   * a bez klíče. Kdyby se nejdřív dešifrovalo, spadl by účet pod neznámým
   * pokolením na chybě kryptografie místo na srozumitelné hlášce.
   */
  it('nedesifruje driv, nez zjisti pokoleni klice', async () => {
    const poradi: string[] = [];
    const { deps } = harness({
      keyIdOf: () => {
        poradi.push('keyIdOf');
        return 1;
      },
      reencrypt: () => {
        poradi.push('reencrypt');
        return NOVA;
      },
    });

    await credentialsRefreshHandler(deps, PAYLOAD);
    expect(poradi).toEqual(['keyIdOf', 'reencrypt']);
  });
});
