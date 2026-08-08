import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { isSetupAvailable } from '@mlain/core/identity/setup';
import { setupAction } from '@/features/auth/actions';
import {
  ConfigStatus,
  configStatusItems,
  type ConfigStatusItem,
} from '@/features/auth/config-status';
import { SetupForm } from '@/features/auth/setup-form';
import { failed } from '@/lib/feedback/action-result';
import { getConfig } from '@/lib/runtime';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ, a je to vynucené politikou obsahu.
 *
 * Proxy razítkuje inline skripty Nextu nonce, který vzniká PRO KAŽDÝ POŽADAVEK.
 * Předrenderované HTML ale vzniká při stavbě image, kdy žádný požadavek
 * neexistuje, takže do něj nonce nemá jak vstoupit. Za běhu pak prohlížeč
 * dostane přísnou politiku a skripty bez nonce, a zablokuje je:
 *
 *   Executing inline script violates the following Content Security Policy
 *   directive 'script-src 'self' 'nonce-...''. The action has been blocked.
 *
 * Devětkrát na stránku. React se nenamountuje a **nefunguje nic**: stránka se
 * vykreslí, vypadá hotově, a žádné tlačítko ani formulář nereaguje. U průvodce
 * prvním spuštěním je to obzvlášť zlé, protože je to úplně první obrazovka,
 * kterou uživatel po instalaci uvidí.
 *
 * Per-request nonce a předrenderování se vylučují z principu, ne shodou
 * okolností. Hlídá to brána `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('setup.title') };
}

/**
 * Stav instalace se zjišťuje NA SERVERU, dřív než se cokoliv vykreslí.
 *
 * Bez toho stránka tvrdila „Instalace zatím nemá žádného uživatele." i tehdy,
 * když uživatele měla, a pravdu řekla teprve potom, co člověk vyplnil pět polí
 * a odeslal je. Odpovědí bylo 409, které formulář sice zobrazí správně, ale to
 * už je pozdě: uživatel vyplňoval formulář, který nikdy nemohl projít.
 *
 * Naměřeno na produkční image při běhu zlaté cesty:
 *   POST /api/v1/setup: 1× 201, 4× 409
 * a všechny čtyři čtyřistadevítky vyrobily šestiminutové čekání na přesměrování,
 * které nemohlo přijít.
 */
/**
 * Stav konfigurace se čte NA SERVERU a ven jde jen to, co panel vypisuje.
 *
 * `null` se vrací tehdy, když se konfigurace přečíst nedá. Tenhle stav se
 * v běžícím webu stát nemá, protože bez platné konfigurace by proces vůbec
 * nenaběhl, ale mlčet o tom by znamenalo tvrdit „vše je v pořádku" tam, kde
 * kontrola vůbec neproběhla. Panel to proto rozlišuje.
 */
function readConfigStatus(): ConfigStatusItem[] | null {
  try {
    return configStatusItems(getConfig());
  } catch {
    return null;
  }
}

export default async function SetupPage() {
  const available = await isSetupAvailable();
  return (
    <SetupForm
      action={setupAction}
      locales={SUPPORTED_LOCALES}
      configStatus={<ConfigStatus items={readConfigStatus()} />}
      {...(available
        ? {}
        : {
            initialState: failed('inlineBlock', {
              type: 'about:blank',
              title: 'Setup already completed',
              status: 409,
              detail: '',
              instance: '/setup',
              code: 'setup_already_completed',
              request_id: '',
            }),
          })}
    />
  );
}
