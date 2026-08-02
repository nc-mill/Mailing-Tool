'use client';

import { useState } from 'react';
import { useRouter } from '@mlain/i18n/navigation';
import { AddProviderDialog } from './add-provider-dialog';
import { SendingSettings, type DomainView, type ProviderView } from './sending-settings';
import type { GuardLimits, GuardSettings } from './guard-thresholds';
import {
  createProviderAction,
  saveGuardsAction,
  setDefaultProviderAction,
  testProviderAction,
} from './actions';

/** Klientský obal nastavení odesílání: přes hranici serverových komponent nejdou funkce. */
export function SendingScreen({
  providers,
  domains,
  guards,
  limits,
  basePath,
  workspaceId,
}: {
  providers: ProviderView[];
  domains: DomainView[];
  guards: GuardSettings;
  limits: GuardLimits;
  basePath: string;
  workspaceId: string;
}) {
  const router = useRouter();
  // Dialog se mountuje až při otevření, ne trvale se `open={false}`: jinak by
  // si po zavření podržel rozepsaný obsah včetně hesla.
  const [addingProvider, setAddingProvider] = useState(false);

  return (
    <>
      <SendingSettings
        providers={providers}
        domains={domains}
        guards={guards}
        limits={limits}
        basePath={basePath}
        onSaveGuards={async (next) => {
          const result = await saveGuardsAction({ workspaceId, settings: next });
          if (result.status === 'success') router.refresh();
          return result;
        }}
        onAddProvider={() => setAddingProvider(true)}
        onTestProvider={(providerId) => testProviderAction({ workspaceId, providerId })}
        onMakeDefault={async (providerId) => {
          const result = await setDefaultProviderAction({ workspaceId, providerId });
          // Nový výchozí okamžitě nahradí předchozí: obnova stránky je jediný způsob,
          // jak seznam ukáže odznak Výchozí na správném řádku.
          if (result.status === 'success') router.refresh();
          return result;
        }}
      />

      {addingProvider && (
        <AddProviderDialog
          open
          onOpenChange={setAddingProvider}
          onSubmit={async (provider) => {
            const result = await createProviderAction({ workspaceId, provider });
            // `revalidatePath` v akci sám o sobě seznam nepřekreslí, protože se
            // akce volá mimo formulář. Nový účet je vidět až po `router.refresh()`.
            if (result.status === 'success') router.refresh();
            return result;
          }}
        />
      )}
    </>
  );
}
