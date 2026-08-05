// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';

/**
 * PROČ TENHLE SOUBOR EXISTUJE
 *
 * Vada „tlačítko Přepnout nic nedělá" byla v PROPOJENÍ, ne v komponentě.
 * Komponentní testy vedle (`address-form-section.test.tsx`,
 * `danger-zone.test.tsx`, `general-form.test.tsx`) si akci dodávají propem
 * (`action={vi.fn()}`), takže ověřují jen to, že pohled něco zavolá. Kdyby
 * obrazovka akci nepředala, nepředala ji do prázdna nebo ji předala v jiném
 * tvaru, ani jeden z nich by si toho nevšiml. Přesně tak vada prošla.
 *
 * Tady se proto NIC nedodává propem. Renderují se OBALY, které používá
 * `app/[locale]/w/[workspaceSlug]/settings/general/page.tsx`, uvnitř nich běží
 * SKUTEČNÉ serverové akce z `./actions` a jediné, co je podvržené, je poslední
 * článek řetězu: HTTP klient, hodiny cache a přesměrování. Řetěz
 * obrazovka → obal → akce → tělo požadavku → překreslení tedy drží celý.
 *
 * Tvar odpovědi API se NEVYMÝŠLÍ. Bere se z `packages/contracts/openapi.json`,
 * protože druhá vada téže obrazovky (uložení skončilo na
 * `/w/undefined/settings/general`) vznikla právě tím, že kód i test věřily
 * tvrzení `apiMutate<{ slug: string }>` místo kontraktu, podle kterého je
 * odpověď zabalená do `{ workspace: … }`.
 */

const mutate = vi.fn();
const fetchApi = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn();

vi.mock('@/lib/api-client/mutate', () => ({ apiMutate: (...args: unknown[]) => mutate(...args) }));
vi.mock('@/lib/api-client/fetch', () => ({ apiFetch: (...args: unknown[]) => fetchApi(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('next/navigation', () => ({ redirect: (...args: unknown[]) => redirect(...args) }));

const { AddressFormSection } = await import('./address-form-section');
const { DangerZone } = await import('./danger-zone');
const { GeneralForm } = await import('./general-form');
const { updateWorkspaceAction } = await import('./actions');

const REPO = join(import.meta.dirname, '../../../../..');
const CONTRACT = JSON.parse(
  readFileSync(join(REPO, 'packages/contracts/openapi.json'), 'utf8'),
) as ContractDocument;

type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

type ContractDocument = {
  paths: Record<
    string,
    Record<
      string,
      { responses: Record<string, { content?: Record<string, { schema: JsonSchema }> }> }
    >
  >;
  components: { schemas: Record<string, JsonSchema> };
};

function resolve(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  const target = CONTRACT.components.schemas[name];
  if (!target) throw new Error(`Kontrakt nezná schéma ${name}`);
  return resolve(target);
}

/**
 * Ukázková odpověď POSTAVENÁ PODLE KONTRAKTU, ne podle představy testu.
 * `overrides` doplní hodnoty podle NÁZVU pole v libovolné hloubce, takže
 * o zanoření rozhoduje kontrakt: když se odpověď přestane balit do
 * `{ workspace: … }`, změní se i tvar, který sem přijde.
 */
function sampleFor(schema: JsonSchema, overrides: Record<string, unknown>): unknown {
  const node = resolve(schema);
  const types = Array.isArray(node.type) ? node.type : [node.type];

  if (node.enum) return node.enum[0];
  if (types.includes('object')) {
    const value: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      value[key] = key in overrides ? overrides[key] : sampleFor(child, overrides);
    }
    return value;
  }
  if (types.includes('array')) return [];
  if (types.includes('null')) return null;
  if (types.includes('number') || types.includes('integer')) return 0;
  if (types.includes('boolean')) return false;
  if (node.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
  if (node.format === 'date-time') return '2026-01-01T00:00:00.000Z';
  return 'vzorek';
}

function responseSchema(path: string, method: string, status: string): JsonSchema {
  const schema = CONTRACT.paths[path]?.[method]?.responses[status]?.content?.['application/json']
    ?.schema as JsonSchema | undefined;
  if (!schema) throw new Error(`Kontrakt nepopisuje ${method.toUpperCase()} ${path} → ${status}`);
  return schema;
}

/** Odpověď PATCH /api/v1/workspaces/{id} přesně tak, jak ji popisuje kontrakt. */
function patchResponse(overrides: Record<string, unknown>): unknown {
  return sampleFor(responseSchema('/api/v1/workspaces/{id}', 'patch', '200'), overrides);
}

/**
 * Kód schválně NENÍ v `SETTINGS_ERROR_KEYS`. Test tím zároveň ověřuje pravidlo
 * z kritéria 76: neznámý kód spadne na `detail` ze serveru, ne na prázdno.
 * Kód z katalogu by se přeložil na větu s proměnnými, které tenhle Problem
 * nenese, a test by měřil katalog místo propojení.
 */
const PROBLEM = {
  type: 'https://docs.mlain.dev/errors/workspace_locked',
  title: 'Workspace locked',
  status: 409,
  detail: 'Projekt je zamčený, změnu jsme neuložili.',
  instance: '/api/v1/workspaces/ws-1',
  code: 'workspace_locked',
  request_id: 'req_1',
};

const WORKSPACE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  created_at: '2026-01-01T00:00:00.000Z',
};

const messages = { settings: csSettings };

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      {node}
    </NextIntlClientProvider>,
  );
}

/** Cesta SOUBORU stránky. Kdyby se obrazovka přestěhovala, spadne to tady. */
const PAGE_FILE = 'apps/web/src/app/[locale]/w/[workspaceSlug]/settings/general/page.tsx';

/**
 * Cesta pro `revalidatePath` se ODVOZUJE ze skutečného umístění souboru, ne
 * opisuje. Kdyby se obrazovka přestěhovala a akce zůstala u staré cesty,
 * překreslení by tiše přestalo fungovat a test by to i tak přehlédl, kdyby
 * měl obě hodnoty napsané zvlášť.
 */
const PAGE_ROUTE = PAGE_FILE.replace('apps/web/src/app', '').replace('/page.tsx', '');

beforeEach(() => {
  mutate.mockReset();
  fetchApi.mockReset();
  revalidatePath.mockReset();
  redirect.mockReset();
  mutate.mockResolvedValue({ ok: true, data: undefined });
});

describe('Obrazovka obecného nastavení drží pohled i akci pohromadě', () => {
  it('stránka vykresluje obaly s akcí, ne holé pohledy, které si obsluhu žádají propem', () => {
    // Vada „komponenta je hotová, ale nikdo jí nepředá obsluhu" se pozná právě
    // tady: `*View` bez propu `action` se nezkompiluje, ale `*View` s akcí
    // vymyšlenou na stránce by tiše obešel obal, který akci dodává.
    const source = readFileSync(join(REPO, PAGE_FILE), 'utf8');
    expect(source).toContain('<AddressFormSection');
    expect(source).toContain('<DangerZone');
    expect(source).toContain('<GeneralForm');
    expect(source).not.toContain('AddressFormSectionView');
    expect(source).not.toContain('DangerZoneView');
  });

  it('cesta k překreslení míří na stránku, která na disku opravdu je', async () => {
    expect(existsSync(join(REPO, PAGE_FILE))).toBe(true);

    withIntl(<AddressFormSection workspace={WORKSPACE} canWrite contactCount={3} />);
    await userEvent.click(screen.getByLabelText(/Tykání/));
    await userEvent.click(screen.getByRole('button', { name: 'Přepnout na tykání' }));

    // Doslovná adresa z prohlížeče (`/w/eshop-kolo/settings/general`) tu
    // NESTAČÍ: next-intl ji přepisuje na `/cs/w/…`, takže by se netrefila do
    // žádného záznamu, a cesta s dynamickými segmenty navíc bez druhého
    // argumentu `'page'` neudělá vůbec nic.
    await waitFor(() => expect(revalidatePath).toHaveBeenCalledWith(PAGE_ROUTE, 'page'));
  });

  it('přepnutí oslovení dojde až do těla požadavku, včetně identifikátoru projektu', async () => {
    withIntl(<AddressFormSection workspace={WORKSPACE} canWrite contactCount={3} />);

    await userEvent.click(screen.getByLabelText(/Tykání/));
    await userEvent.click(screen.getByRole('button', { name: 'Přepnout na tykání' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(`/api/v1/workspaces/${WORKSPACE.id}`, {
      method: 'PATCH',
      body: { address_form: 'informal' },
      workspaceId: WORKSPACE.id,
    });
  });

  it('po přepnutí se dialog zavře a sekce to řekne slovy, ne mlčením', async () => {
    withIntl(<AddressFormSection workspace={WORKSPACE} canWrite contactCount={3} />);

    await userEvent.click(screen.getByLabelText(/Tykání/));
    await userEvent.click(screen.getByRole('button', { name: 'Přepnout na tykání' }));

    // Tohle je přesně to, co uživatel nahlásil jako „klikám a nic se nestane":
    // dialog zůstával viset otevřený a žádná hláška se neobjevila.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      screen.getByText('Oslovení jsme přepnuli a přepočítáváme kontakty.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Tykání/)).toBeChecked();
  });

  it('odmítnuté přepnutí se ukáže a přepínač se vrátí k pravdě', async () => {
    mutate.mockResolvedValue({ ok: false, problem: PROBLEM });
    withIntl(<AddressFormSection workspace={WORKSPACE} canWrite contactCount={3} />);

    await userEvent.click(screen.getByLabelText(/Tykání/));
    await userEvent.click(screen.getByRole('button', { name: 'Přepnout na tykání' }));

    await waitFor(() => expect(screen.getByText(PROBLEM.detail)).toBeInTheDocument());
    expect(screen.getByLabelText(/Vykání/)).toBeChecked();
  });

  it('odmítnuté smazání projektu neskončí mlčky', async () => {
    mutate.mockResolvedValue({ ok: false, problem: PROBLEM });
    withIntl(<DangerZone workspace={WORKSPACE} />);

    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    await userEvent.type(
      screen.getByLabelText('Pro potvrzení opište název projektu'),
      WORKSPACE.name,
    );
    await userEvent.click(screen.getByRole('button', { name: `Smazat projekt ${WORKSPACE.name}` }));

    await waitFor(() => expect(screen.getByText(PROBLEM.detail)).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('Uložení obecného formuláře čte odpověď podle kontraktu', () => {
  it('kontrakt odpověď PATCH balí, slug na nejvyšší úrovni nemá', () => {
    const schema = responseSchema('/api/v1/workspaces/{id}', 'patch', '200');
    // Kdyby se `slug` opravdu vracel na nejvyšší úrovni, byl by tvar
    // `apiMutate<{ slug: string }>` správně a vada by neexistovala.
    expect(Object.keys(schema.properties ?? {})).toEqual(['workspace']);
    expect(schema.properties?.['workspace']).toBeDefined();
  });

  it('uložení beze změny adresy nepřesměrovává nikam', async () => {
    mutate.mockResolvedValue({ ok: true, data: patchResponse({ slug: WORKSPACE.slug }) });

    withIntl(
      <GeneralForm
        action={updateWorkspaceAction}
        workspace={WORKSPACE}
        locales={['cs', 'en']}
        timezones={['Europe/Prague', 'UTC']}
        canWrite
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    // Se starým čtením `result.data.slug` tu bylo `undefined`, podmínka
    // „slug se změnil" platila vždycky a uživatel skončil na
    // `/w/undefined/settings/general`, tedy na 404.
    expect(redirect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Uloženo')).toBeInTheDocument());
    expect(revalidatePath).toHaveBeenCalledWith(PAGE_ROUTE, 'page');
  });

  it('změna adresy přesměruje na novou adresu, ne na undefined', async () => {
    mutate.mockResolvedValue({ ok: true, data: patchResponse({ slug: 'nova-adresa' }) });

    withIntl(
      <GeneralForm
        action={updateWorkspaceAction}
        workspace={WORKSPACE}
        locales={['cs', 'en']}
        timezones={['Europe/Prague', 'UTC']}
        canWrite
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));

    await waitFor(() => expect(redirect).toHaveBeenCalledWith('/w/nova-adresa/settings/general'));
    // Překreslení musí proběhnout PŘED přesměrováním, protože `redirect()`
    // vyhazuje výjimku a všechno za ním by se ztratilo.
    expect(revalidatePath).toHaveBeenCalledWith(PAGE_ROUTE, 'page');
  });
});
