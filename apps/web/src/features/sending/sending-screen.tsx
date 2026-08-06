'use client';

import { useState } from 'react';
import { useRouter } from '@mlain/i18n/navigation';
import { useTranslations } from 'next-intl';
import { SettingsPageShell, SettingsStack } from '@/features/settings/settings-page-shell';
import { AddDomainDialog } from './add-domain-dialog';
import { AddProviderDialog } from './add-provider-dialog';
import { DeleteDomainDialog } from './delete-domain-dialog';
import { DeleteProviderDialog, EditProviderDialog } from './edit-provider-dialog';
import { ProductionAccessDialog, VerifyIdentityDialog } from './identity-dialogs';
import {
  SendingSettings,
  type DomainView,
  type ProviderVerification,
  type ProviderView,
} from './sending-settings';
import { TrialModePanel, type TrialView } from './trial-mode-panel';
import type { GuardLimits, GuardSettings } from './guard-thresholds';
import {
  addTrialAddressAction,
  createDomainAction,
  createProviderAction,
  deleteDomainAction,
  deleteProviderAction,
  identityStatusAction,
  removeTrialAddressAction,
  requestProductionAccessAction,
  saveGuardsAction,
  setDefaultProviderAction,
  setTrialModeAction,
  testProviderAction,
  updateProviderAction,
  verifyIdentityAction,
} from './actions';

/** Klientský obal nastavení odesílání: přes hranici serverových komponent nejdou funkce. */
export function SendingScreen({
  providers,
  domains,
  guards,
  limits,
  trial,
  basePath,
  workspaceId,
}: {
  providers: ProviderView[];
  domains: DomainView[];
  guards: GuardSettings;
  limits: GuardLimits;
  trial: TrialView;
  basePath: string;
  workspaceId: string;
}) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  // Dialog se mountuje až při otevření, ne trvale se `open={false}`: jinak by
  // si po zavření podržel rozepsaný obsah včetně hesla.
  const [addingProvider, setAddingProvider] = useState(false);
  const [addingDomain, setAddingDomain] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDomainId, setDeletingDomainId] = useState<string | null>(null);
  /** Ověření adresy u Amazonu a žádost o produkční přístup, obojí u jednoho účtu. */
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [productionId, setProductionId] = useState<string | null>(null);
  /**
   * Výsledky ověření drží obrazovka, ne seznam. Ověření spouštějí tři místa
   * (tlačítko u účtu, dokončené založení, dokončená úprava) a ukazuje se na
   * jednom, takže stav musí být nad nimi všemi.
   */
  const [verification, setVerification] = useState<Record<string, ProviderVerification>>({});

  const editing = providers.find((p) => p.id === editingId) ?? null;
  const deleting = providers.find((p) => p.id === deletingId) ?? null;
  const deletingDomain = domains.find((d) => d.id === deletingDomainId) ?? null;
  const identityProvider = providers.find((p) => p.id === identityId) ?? null;
  const productionProvider = providers.find((p) => p.id === productionId) ?? null;

  /**
   * Region, ve kterém se bude ověřovat. Přednost má region ZAPSANÝ PŘI OVĚŘENÍ
   * (`status_detail.region`), protože ten Amazon potvrdil; uložená konfigurace
   * je až druhá volba a používá se u účtu, který se ještě neověřoval.
   */
  function regionOf(p: ProviderView): string | null {
    return p.status_detail?.region ?? p.config?.region ?? null;
  }
  /**
   * Ověřená je doména, která má `verified_at`. Když je jediná, odebráním se projekt
   * vrátí do zkušebního režimu (`resolveTrialMode` počítá `trial_mode ?? !hasVerifiedDomain`),
   * a to musí být v potvrzení vidět předem, ne až podle chování odesílání.
   */
  const verifiedCount = domains.filter((d) => d.verified_at !== null).length;

  /**
   * Ověření, že údaje opravdu fungují. Běží samo po založení i po úpravě, protože
   * přesně tam se pozná překlep v klíči, a uživatel se to nemá jak dozvědět jinak
   * než při první odeslané kampani.
   */
  async function verify(providerId: string): Promise<void> {
    setVerification((prev) => ({ ...prev, [providerId]: { state: 'running' } }));
    const result = await testProviderAction({ workspaceId, providerId });
    setVerification((prev) => ({
      ...prev,
      [providerId]:
        result.status === 'success'
          ? {
              state: 'ok',
              detail: result.detail,
              sandbox: result.sandbox,
              providerStatus: result.providerStatus,
              blockers: result.blockers,
              region: result.region,
              verifiedIdentities: result.verifiedIdentities,
              verifiedIdentityCount: result.verifiedIdentityCount,
            }
          : {
              state: 'failed',
              code: result.code,
              reason: result.reason,
              detail: result.detail,
              providerStatus: result.providerStatus,
              blockers: result.blockers,
              region: result.region,
              verifiedIdentities: result.verifiedIdentities,
              verifiedIdentityCount: result.verifiedIdentityCount,
            },
    }));
    // Test u SES ukládá čerstvý stav účtu (kvóty, sandbox, stav účtu), takže se
    // seznam po ověření překreslí ze serveru, ne jen o odstavec s výsledkem.
    // Odznak přitom čekat nemusí: kreslí se z `providerStatus` v odpovědi výš,
    // takže mezi testem a obnovou nevznikne okno, ve kterém by si odznak
    // a výsledek protiřečily.
    router.refresh();
  }

  return (
    // Obrazovka do 5. 8. 2026 NEMĚLA název vůbec: začínala rovnou mezinadpisem
    // „Odesílací účty“, takže se v levém menu Nastavení nedalo poznat, kde
    // člověk je. Hlavičku teď dodává `SettingsPageShell` jako všem ostatním.
    <SettingsPageShell title={t('sending.title')} lead={t('sending.lead')}>
      <SettingsStack>
        <SendingSettings
          providers={providers}
          domains={domains}
          guards={guards}
          limits={limits}
          basePath={basePath}
          verification={verification}
          onSaveGuards={async (next) => {
            const result = await saveGuardsAction({ workspaceId, settings: next });
            if (result.status === 'success') router.refresh();
            return result;
          }}
          onAddProvider={() => setAddingProvider(true)}
          onAddDomain={() => setAddingDomain(true)}
          onTestProvider={(providerId) => void verify(providerId)}
          onEditProvider={(providerId) => setEditingId(providerId)}
          onDeleteProvider={(providerId) => setDeletingId(providerId)}
          onDeleteDomain={(domainId) => setDeletingDomainId(domainId)}
          onVerifyIdentity={(providerId) => setIdentityId(providerId)}
          onRequestProductionAccess={(providerId) => setProductionId(providerId)}
          onMakeDefault={async (providerId) => {
            const result = await setDefaultProviderAction({ workspaceId, providerId });
            // Nový výchozí okamžitě nahradí předchozí: obnova stránky je jediný způsob,
            // jak seznam ukáže odznak Výchozí na správném řádku.
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />

        {/* Zkušební režim patří na tuhle obrazovku, ne na vlastní: rozhoduje o tom,
            komu se odešle, stejně jako odesílací účet a doména nad ním.
            Odstup dodává `SettingsStack`, dřív to byl `mt-10` z výchozí škály. */}
        <TrialModePanel
          trial={trial}
          onToggle={async (enabled) => {
            const result = await setTrialModeAction({ workspaceId, enabled });
            // Bez obnovy by odznak stavu i popisek tlačítka zůstaly na staré hodnotě:
            // stav přichází ze serveru, komponenta si ho nedrží.
            if (result.status === 'success') router.refresh();
            return result;
          }}
          onAddAddress={async (email) => {
            const result = await addTrialAddressAction({ workspaceId, email });
            if (result.status === 'success') router.refresh();
            return result;
          }}
          onRemoveAddress={async (email) => {
            const result = await removeTrialAddressAction({ workspaceId, email });
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      </SettingsStack>

      {addingProvider && (
        <AddProviderDialog
          open
          onOpenChange={setAddingProvider}
          onSubmit={async (provider) => {
            const result = await createProviderAction({ workspaceId, provider });
            // `revalidatePath` v akci sám o sobě seznam nepřekreslí, protože se
            // akce volá mimo formulář. Nový účet je vidět až po `router.refresh()`.
            if (result.status === 'success') {
              router.refresh();
              void verify(result.providerId);
            }
            return result;
          }}
        />
      )}

      {addingDomain && (
        <AddDomainDialog
          open
          onOpenChange={setAddingDomain}
          providers={providers.map((p) => ({ id: p.id, name: p.name, is_default: p.is_default }))}
          onSubmit={async (input) => {
            const result = await createDomainAction({
              workspaceId,
              domain: input.domain,
              providerId: input.providerId,
            });
            // Po založení se jde ROVNOU na detail domény, ne zpátky do seznamu:
            // doména sama o sobě nic neřeší, dokud uživatel nevloží DNS záznamy,
            // a ty jsou právě tam. Druhá cesta k témuž obsahu se nezakládá.
            if (result.status === 'success') {
              router.push(`${basePath}/settings/sending/domains/${result.domainId}`);
            }
            return result;
          }}
        />
      )}

      {deletingDomain && (
        <DeleteDomainDialog
          domain={deletingDomain}
          lastVerified={verifiedCount === 1 && deletingDomain.verified_at !== null}
          open
          onOpenChange={(open) => {
            if (!open) setDeletingDomainId(null);
          }}
          onConfirm={async () => {
            const result = await deleteDomainAction({
              workspaceId,
              domainId: deletingDomain.id,
            });
            // Bez obnovy by odebraná doména zůstala v seznamu viset: seznam
            // přichází ze serveru a komponenta si ho nedrží.
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      )}

      {editing && (
        <EditProviderDialog
          provider={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditingId(null);
          }}
          onSubmit={async (patch) => {
            const result = await updateProviderAction({
              workspaceId,
              providerId: editing.id,
              patch,
            });
            if (result.status === 'success') {
              router.refresh();
              // Ověřuje se po KAŽDÉ úpravě, ne jen po výměně klíče: špatný region
              // nebo port účet rozbije stejně spolehlivě jako špatné tajemství.
              void verify(editing.id);
            }
            return result;
          }}
        />
      )}

      {identityProvider && (
        <VerifyIdentityDialog
          providerName={identityProvider.name}
          region={regionOf(identityProvider)}
          open
          onOpenChange={(open) => {
            if (!open) {
              setIdentityId(null);
              // Ověřená adresa mění, co všechno účet v regionu má, takže se
              // obrazovka po zavření načte znovu. Bez toho by panel regionu
              // ukazoval stav z doby před ověřením.
              router.refresh();
            }
          }}
          onSubmit={(email) =>
            verifyIdentityAction({ workspaceId, providerId: identityProvider.id, email })
          }
          onRefresh={(email) =>
            identityStatusAction({ workspaceId, providerId: identityProvider.id, email })
          }
        />
      )}

      {productionProvider && (
        <ProductionAccessDialog
          providerName={productionProvider.name}
          region={regionOf(productionProvider)}
          open
          onOpenChange={(open) => {
            if (!open) {
              setProductionId(null);
              router.refresh();
            }
          }}
          onSubmit={(input) =>
            requestProductionAccessAction({
              workspaceId,
              providerId: productionProvider.id,
              mailType: input.mailType,
              websiteUrl: input.websiteUrl,
              additionalContactEmails: input.additionalContactEmails,
            })
          }
        />
      )}

      {deleting && (
        <DeleteProviderDialog
          provider={deleting}
          open
          onOpenChange={(open) => {
            if (!open) setDeletingId(null);
          }}
          onConfirm={async () => {
            const result = await deleteProviderAction({
              workspaceId,
              providerId: deleting.id,
            });
            if (result.status === 'success') {
              // Výsledek ověření smazaného účtu by jinak zůstal viset v paměti
              // a objevil by se u nového účtu, kdyby dostal totéž id.
              setVerification((prev) => {
                const next = { ...prev };
                delete next[deleting.id];
                return next;
              });
              router.refresh();
            }
            return result;
          }}
        />
      )}
    </SettingsPageShell>
  );
}
